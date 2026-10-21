<script setup>
import { ref, onMounted } from 'vue'
import { supabase } from './supabase'

const session = ref(null)
const email = ref(''), password = ref(''), authMsg = ref('')
const kind = ref(null), note = ref(''), location = ref(''), secret = ref(''), file = ref(null)
const items = ref([]), board = ref([]), matches = ref([])
const busy = ref(false), err = ref(''), notice = ref('')
let started = false

const photo = (p) => (p ? supabase.storage.from('photos').getPublicUrl(p).data.publicUrl : null)
const matchesFor = (it) => matches.value.filter((m) => (it.kind === 'lost' ? m.lost_id : m.found_id) === it.id)
const other = (it, m) => (it.kind === 'lost' ? m.found : m.lost)

async function load() {
  const uid = session.value.user.id
  const [mine, found, mt] = await Promise.all([
    supabase.from('items').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    supabase.from('items').select('*').eq('kind', 'found').eq('status', 'open').order('created_at', { ascending: false }).limit(24),
    supabase.from('matches').select('*, lost:items!lost_id(*), found:items!found_id(*)').order('score', { ascending: false }),
  ])
  items.value = mine.data ?? []
  board.value = found.data ?? []
  matches.value = mt.data ?? []
}

function start() {
  load()
  if (started) return
  started = true
  supabase
    .channel('matches')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' }, () => {
      notice.value = 'New possible match found.'
      load()
      setTimeout(() => (notice.value = ''), 5000)
    })
    .subscribe()
}

onMounted(async () => {
  const { data } = await supabase.auth.getSession()
  session.value = data.session
  supabase.auth.onAuthStateChange((_e, s) => {
    session.value = s
    if (s) start()
  })
  if (data.session) start()
})

async function auth(mode) {
  authMsg.value = ''
  const fn = mode === 'up' ? supabase.auth.signUp : supabase.auth.signInWithPassword
  const { error } = await fn.call(supabase.auth, { email: email.value, password: password.value })
  if (error) authMsg.value = error.message
}

// Shrink photos before upload: faster, and inside the vision API's size limit.
function shrink(f, max = 1280) {
  return new Promise((ok, no) => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s)
      c.height = Math.round(img.height * s)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      c.toBlob((b) => (b ? ok(b) : no(new Error('Could not read that photo'))), 'image/jpeg', 0.85)
    }
    img.onerror = () => no(new Error('Could not read that photo'))
    img.src = URL.createObjectURL(f)
  })
}

async function submit() {
  busy.value = true
  err.value = ''
  try {
    let photo_path = null
    if (file.value) {
      photo_path = `${session.value.user.id}/${crypto.randomUUID()}.jpg`
      const up = await supabase.storage.from('photos').upload(photo_path, await shrink(file.value), { contentType: 'image/jpeg' })
      if (up.error) throw up.error
    }
    const { data, error } = await supabase.from('items')
      .insert({ kind: kind.value, note: note.value, location: location.value || null, photo_path })
      .select().single()
    if (error) throw error
    if (kind.value === 'found' && secret.value) await supabase.from('item_secrets').insert({ item_id: data.id, detail: secret.value })
    const r = await supabase.functions.invoke('process-item', { body: { item_id: data.id } })
    if (r.error) throw r.error
    note.value = location.value = secret.value = ''
    file.value = null
    kind.value = null
    await load()
  } catch (e) {
    err.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main v-if="!session" class="auth">
    <h1>Reclaim</h1>
    <p>Find what you lost on campus. Sign in to post or search.</p>
    <label>Email <input v-model="email" type="email" autocomplete="email" /></label>
    <label>Password <input v-model="password" type="password" autocomplete="current-password" /></label>
    <div class="row">
      <button class="primary" @click="auth('in')">Sign in</button>
      <button @click="auth('up')">Create account</button>
    </div>
    <p v-if="authMsg" class="err" role="alert">{{ authMsg }}</p>
  </main>

  <main v-else>
    <header>
      <h1>Reclaim</h1>
      <button @click="supabase.auth.signOut()">Sign out</button>
    </header>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>

    <section class="actions">
      <button :class="{ on: kind === 'lost' }" @click="kind = 'lost'">I lost something</button>
      <button :class="{ on: kind === 'found' }" @click="kind = 'found'">I found something</button>
    </section>

    <form v-if="kind" class="post" @submit.prevent="submit">
      <label>Photo <input type="file" accept="image/*" capture="environment" @change="file = $event.target.files[0]" /></label>
      <label>Describe it
        <textarea v-model="note" required rows="3" placeholder="What is it, and where did you last see it or find it?"></textarea>
      </label>
      <label>Place <input v-model="location" placeholder="Library, Block C, bus stop" /></label>
      <label v-if="kind === 'found'">A detail only the owner would know (kept private)
        <input v-model="secret" />
      </label>
      <button class="primary" :disabled="busy">{{ busy ? 'Matching…' : kind === 'lost' ? 'Post lost item' : 'Post found item' }}</button>
      <p v-if="err" class="err" role="alert">{{ err }}</p>
    </form>

    <section>
      <h2>Your items</h2>
      <p v-if="!items.length" class="empty">Nothing posted yet. Report a lost or found item above.</p>
      <article v-for="it in items" :key="it.id" class="item">
        <img v-if="photo(it.photo_path)" :src="photo(it.photo_path)" :alt="it.attrs?.summary || it.note" />
        <div class="grow">
          <h3>{{ it.attrs?.summary || it.note }}</h3>
          <p class="meta">{{ it.kind === 'lost' ? 'Lost' : 'Found' }} at {{ it.location || 'an unknown place' }}</p>
          <p v-if="!matchesFor(it).length" class="empty">No matches yet. We check every new post.</p>
          <div v-for="m in matchesFor(it)" :key="m.id" class="ticket">
            <div class="stub">{{ m.score }}%</div>
            <div class="body">
              <img v-if="other(it, m) && photo(other(it, m).photo_path)" :src="photo(other(it, m).photo_path)" alt="" />
              <p>{{ m.reason }}</p>
              <p v-if="other(it, m)" class="meta">Found at {{ other(it, m).location || 'an unknown place' }}</p>
              <p v-else class="meta">The owner has been notified.</p>
            </div>
          </div>
        </div>
      </article>
    </section>

    <section>
      <h2>Found board</h2>
      <p v-if="!board.length" class="empty">No found items yet.</p>
      <div class="grid">
        <figure v-for="b in board" :key="b.id">
          <img v-if="photo(b.photo_path)" :src="photo(b.photo_path)" :alt="b.attrs?.summary || b.note" />
          <figcaption>{{ b.attrs?.summary || b.note }}<br /><span class="meta">{{ b.location }}</span></figcaption>
        </figure>
      </div>
    </section>
  </main>
</template>

<style>
:root { --bg: #e9eef6; --ink: #14213d; --blue: #2b50e6; --tag: #ffd43b; --soft: #14213dbb; color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 'Bricolage Grotesque', system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 2.6rem; letter-spacing: -0.03em; margin: 0; }
h2 { font-size: 1.5rem; margin: 2.5rem 0 0.5rem; }
h3 { font-size: 1.05rem; margin: 0; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
button { font: inherit; padding: 0.6rem 1rem; border: 2px solid var(--ink); background: #fff; color: var(--ink); border-radius: 6px; cursor: pointer; }
button:disabled { opacity: 0.6; cursor: wait; }
.primary { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 700; }
:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
label { display: block; margin: 0.8rem 0; font-weight: 600; }
input, textarea { display: block; width: 100%; margin-top: 0.25rem; padding: 0.55rem 0.7rem; font: inherit; font-weight: 400; background: #fff; color: var(--ink); border: 2px solid var(--ink); border-radius: 6px; }
.row { display: flex; gap: 0.5rem; }
.actions { display: flex; gap: 0.75rem; }
.actions button { flex: 1; padding: 1.2rem; font-size: 1.35rem; font-weight: 700; text-align: left; }
.actions .on { background: var(--ink); color: #fff; }
.post { background: #fff; border: 2px solid var(--ink); border-radius: 6px; padding: 0.5rem 1rem 1rem; margin: 1rem 0; }
.item { display: flex; gap: 1rem; padding: 1rem 0; border-top: 1px solid #14213d33; }
.item > img { width: 96px; height: 96px; object-fit: cover; border-radius: 6px; }
.grow { flex: 1; min-width: 0; }
.ticket { display: flex; margin-top: 0.75rem; background: #fff; border: 2px solid var(--ink); border-radius: 6px; overflow: hidden; }
.stub { display: flex; align-items: center; padding: 0 1rem; background: var(--tag); border-right: 2px dashed var(--ink); font-size: 1.5rem; font-weight: 800; }
.ticket .body { padding: 0.6rem 0.8rem; }
.ticket .body img { width: 72px; height: 72px; object-fit: cover; border-radius: 4px; float: right; margin-left: 0.6rem; }
.ticket p { margin: 0 0 0.25rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
figure { margin: 0; }
figure img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; }
figcaption { font-size: 0.9rem; margin-top: 0.3rem; }
.meta { margin: 0; font-size: 0.9rem; color: var(--soft); }
.empty { color: var(--soft); }
.err { color: #b3261e; font-weight: 600; }
.notice { margin: 0 0 1rem; padding: 0.6rem 1rem; background: var(--tag); border-radius: 6px; font-weight: 700; }
</style>
