<script setup>
import { ref, onMounted } from 'vue'
import { supabase } from './supabase'

const session = ref(null)
const email = ref(''), password = ref(''), authMsg = ref(''), authNotice = ref('')
const authBusy = ref(false), canResendConfirmation = ref(false)
const kind = ref(null), note = ref(''), location = ref(''), secret = ref(''), file = ref(null)
const items = ref([]), board = ref([]), matches = ref([])
const busy = ref(false), err = ref(''), notice = ref('')
const deletingId = ref(null)
let started = false
const claims = ref([])
const answers = ref({})

const photo = (p) => (p ? supabase.storage.from('photos').getPublicUrl(p).data.publicUrl : null)
const matchesFor = (it) => matches.value.filter((m) => (it.kind === 'lost' ? m.lost_id : m.found_id) === it.id)
const other = (it, m) => (it.kind === 'lost' ? m.found : m.lost)
const claimFor = (m) => claims.value.find((c) => c.match_id === m.id)

// Call an Edge Function and surface its real error message.
async function call(name, body) {
  const r = await supabase.functions.invoke(name, { body })
  if (r.error) {
    const detail = await r.error.context?.json?.().catch(() => null)
    throw new Error(detail?.error || r.error.message)
  }
  return r.data
}

async function claim(m, answer) {
  err.value = ''
  try {
    await call('verify-claim', { match_id: m.id, answer })
    await load()
  } catch (e) {
    err.value = e.message
  }
}

async function load() {
  const uid = session.value.user.id
  const [mine, found, mt, cl] = await Promise.all([
    supabase.from('items').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    supabase.from('items').select('*').eq('kind', 'found').eq('status', 'open').order('created_at', { ascending: false }).limit(24),
    supabase.from('matches').select('*, lost:items!lost_id(*), found:items!found_id(*)').order('score', { ascending: false }),
    supabase.from('claims').select('*'),
  ])
  items.value = mine.data ?? []
  board.value = found.data ?? []
  matches.value = mt.data ?? []
  claims.value = cl.data ?? []
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'claims' }, load)
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
  authNotice.value = ''
  canResendConfirmation.value = false
  authBusy.value = true
  try {
    if (mode === 'up') {
      const { data, error } = await supabase.auth.signUp({ email: email.value.trim(), password: password.value })
      if (error) throw error
      if (!data.session) {
        authNotice.value = 'Check your inbox for a confirmation link before signing in.'
        canResendConfirmation.value = true
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value })
      if (error) throw error
    }
  } catch (error) {
    const message = error?.message || 'Could not complete authentication. Please try again.'
    if (/email_not_confirmed|email not confirmed/i.test(message)) {
      authMsg.value = 'This email is not confirmed yet. Check your inbox or resend the link below. For demo sign-in without email, disable Confirm email in Supabase Authentication settings.'
      canResendConfirmation.value = true
    } else if (/security purposes|rate.?limit|too many requests/i.test(message)) {
      authMsg.value = 'Signup emails are temporarily rate-limited. Wait at least 60 seconds before trying again.'
    } else {
      authMsg.value = message
    }
  } finally {
    authBusy.value = false
  }
}

async function resendConfirmation() {
  authMsg.value = ''
  authNotice.value = ''
  authBusy.value = true
  try {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.value.trim() })
    if (error) throw error
    authNotice.value = 'If this email needs confirmation, a new link has been sent. Check your inbox.'
  } catch (error) {
    const message = error?.message || 'Could not resend the confirmation email.'
    authMsg.value = /security purposes|rate.?limit|too many requests/i.test(message)
      ? 'A confirmation email was requested recently. Wait at least 60 seconds before trying again.'
      : message
  } finally {
    authBusy.value = false
  }
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

async function retryItem(id) {
  if (busy.value) return
  busy.value = true
  err.value = ''
  try {
    await call('process-item', { item_id: id })
    await load()
  } catch (e) {
    err.value = e.message
  } finally {
    busy.value = false
  }
}

async function removeItem(item) {
  const label = item.attrs?.summary || item.note
  if (!window.confirm(`Delete "${label}"? This also removes its photo and related matches. This cannot be undone.`)) return
  deletingId.value = item.id
  err.value = ''
  try {
    if (item.photo_path) {
      const { error: photoError } = await supabase.storage.from('photos').remove([item.photo_path])
      if (photoError) throw photoError
    }
    const { data: deleted, error } = await supabase.from('items').delete()
      .eq('id', item.id)
      .eq('user_id', session.value.user.id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!deleted) throw new Error('Item deletion was blocked. Run supabase/003_item_deletion.sql in your Supabase SQL Editor, then try again.')
    items.value = items.value.filter((it) => it.id !== item.id)
    matches.value = matches.value.filter((match) => match.lost_id !== item.id && match.found_id !== item.id)
    await load()
  } catch (e) {
    err.value = e.message
  } finally {
    deletingId.value = null
  }
}

async function submit() {
  busy.value = true
  err.value = ''
  let itemSaved = false
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
    itemSaved = true
    if (kind.value === 'found' && secret.value) await supabase.from('item_secrets').insert({ item_id: data.id, detail: secret.value })
    note.value = location.value = secret.value = ''
    file.value = null
    kind.value = null
    await call('process-item', { item_id: data.id })
    await load()
  } catch (e) {
    err.value = e.message
    if (itemSaved) await load()
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
      <button class="primary" :disabled="authBusy" @click="auth('in')">{{ authBusy ? 'Please wait…' : 'Sign in' }}</button>
      <button :disabled="authBusy" @click="auth('up')">Create account</button>
    </div>
    <button v-if="canResendConfirmation" :disabled="authBusy" @click="resendConfirmation">Resend confirmation email</button>
    <p v-if="authNotice" class="notice" role="status">{{ authNotice }}</p>
    <p v-if="authMsg" class="err" role="alert">{{ authMsg }}</p>
  </main>

  <main v-else>
    <header>
      <h1>Reclaim</h1>
      <button @click="supabase.auth.signOut()">Sign out</button>
    </header>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="err && !kind" class="err" role="alert">{{ err }}</p>

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
          <div class="item-heading">
            <h3>{{ it.attrs?.summary || it.note }}</h3>
            <button class="delete" :disabled="!!deletingId" @click="removeItem(it)">{{ deletingId === it.id ? 'Deleting…' : 'Delete' }}</button>
          </div>
          <p class="meta">{{ it.kind === 'lost' ? 'Lost' : 'Found' }} at {{ it.location || 'an unknown place' }}</p>
          <template v-if="!it.attrs">
            <p class="err">AI matching did not finish for this item.</p>
            <button :disabled="busy" @click="retryItem(it.id)">{{ busy ? 'Matching…' : 'Retry AI matching' }}</button>
          </template>
          <p v-if="!matchesFor(it).length" class="empty">No matches yet. We check every new post.</p>
          <div v-for="m in matchesFor(it)" :key="m.id" class="ticket">
            <div class="stub">{{ m.score }}%</div>
            <div class="body">
              <img v-if="other(it, m) && photo(other(it, m).photo_path)" :src="photo(other(it, m).photo_path)" alt="" />
              <p>{{ m.reason }}</p>
              <p v-if="other(it, m)" class="meta">Found at {{ other(it, m).location || 'an unknown place' }}</p>
              <p v-else class="meta">The owner has been notified.</p>
              <template v-if="it.kind === 'lost' && other(it, m)">
                <button v-if="!claimFor(m)" @click="claim(m)">This is mine</button>
                <div v-else class="verify">
                  <p><strong>{{ claimFor(m).question }}</strong></p>
                  <template v-if="!claimFor(m).verdict">
                    <input v-model="answers[m.id]" aria-label="Your answer" />
                    <button class="primary" @click="claim(m, answers[m.id])">Check my answer</button>
                  </template>
                  <p v-else :class="claimFor(m).verdict === 'verified' ? 'ok' : 'err'">
                    {{ claimFor(m).verdict === 'verified' ? 'Verified. Collect it at ' + (other(it, m).location || 'the place listed') + '.' : 'Not verified. ' + claimFor(m).note }}
                  </p>
                </div>
              </template>
              <p v-else-if="it.kind === 'found' && claimFor(m)?.verdict === 'verified'" class="ok">Owner verified. Hand the item over.</p>
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
.item-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
.delete { flex: 0 0 auto; padding: 0.25rem 0.55rem; border-color: #b3261e; color: #b3261e; font-size: 0.9rem; }
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
.ok { color: #1b6e3c; font-weight: 700; }
.verify { margin-top: 0.5rem; }
</style>
