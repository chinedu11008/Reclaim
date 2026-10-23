// Posts demo "found" items through the real pipeline.  Run: npm run seed
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service } = process.env
if (!url || !anon || !service) throw new Error('Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env')

const email = 'finder@reclaim.demo'
const password = 'reclaim-demo-1'
await createClient(url, service).auth.admin.createUser({ email, password, email_confirm: true }) // errors if it already exists: fine

const sb = createClient(url, anon)
const { data: s, error: authError } = await sb.auth.signInWithPassword({ email, password })
if (authError) throw authError
const uid = s.user.id

for (const it of JSON.parse(readFileSync('seed/items.json', 'utf8'))) {
  let photo_path = `${uid}/${it.file}`
  try {
    const jpg = await sharp(`seed/photos/${it.file}`).resize({ width: 1280, height: 1280, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
    const { error } = await sb.storage.from('photos').upload(photo_path, jpg, { contentType: 'image/jpeg', upsert: true })
    if (error) throw error
  } catch {
    console.warn(`No usable photo for ${it.file}: posting the note only`)
    photo_path = null
  }
  const { data, error } = await sb.from('items').insert({ kind: 'found', note: it.note, location: it.location, photo_path }).select().single()
  if (error) throw error
  await sb.from('item_secrets').insert({ item_id: data.id, detail: it.secret })
  const r = await sb.functions.invoke('process-item', { body: { item_id: data.id } })
  console.log(r.error ? `FAILED ${it.file}: ${r.error.message}` : `Posted ${it.file}`)
}
