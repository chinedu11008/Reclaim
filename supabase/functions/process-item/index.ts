// process-item: photo -> attributes (Gemini vision) -> embedding -> candidates -> AI re-rank -> matches
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Supabase: any // built into the Supabase Edge runtime

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })

async function ai(content: unknown[] | string, _maxTokens?: number) {
  // Gemini call. Accepts text blocks and base64 image blocks; returns parsed JSON.
  const blocks = (typeof content === 'string' ? [{ type: 'text', text: content }] : content) as any[]
  const parts = blocks.map((b) =>
    b.type === 'image'
      ? { inline_data: { mime_type: b.source.media_type, data: b.source.data } }
      : { text: b.text },
  )
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash'
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json' } }),
  })
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const out = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('')
  if (!out) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason ?? 'unknown'})`)
  return JSON.parse(out.replace(/```json|```/g, '').trim())
}

const b64 = (u8: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user } } = await asUser.auth.getUser()
    if (!user) return json({ error: 'Sign in first' }, 401)

    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { item_id } = await req.json()
    const { data: item } = await db.from('items').select('*').eq('id', item_id).single()
    if (!item || item.user_id !== user.id) return json({ error: 'Item not found' }, 404)

    // 1. Photo (and the note) -> structured attributes
    const ask = `You help match lost and found items on a campus. Describe this item so it can be matched. Reply with JSON only: {"category":string,"colour":string,"brand":string|null,"marks":string,"visible_text":string|null,"summary":string}. "marks" = scratches, stickers, damage, unique features. "summary" = one plain sentence. Note from the student: ${item.note}`
    const content: unknown[] = [{ type: 'text', text: ask }]
    if (item.photo_path) {
      const { data: blob } = await db.storage.from('photos').download(item.photo_path)
      if (blob) {
        const data = b64(new Uint8Array(await blob.arrayBuffer()))
        content.unshift({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })
      }
    }
    const attrs = await ai(content)

    // 2. Embed the description (built-in gte-small model, 384 dimensions)
    const text = [attrs.summary, attrs.category, attrs.colour, attrs.brand, attrs.marks, attrs.visible_text, item.note]
      .filter(Boolean).join('. ')
    const embedding = Array.from(
      await new Supabase.ai.Session('gte-small').run(text, { mean_pool: true, normalize: true }),
    ) as number[]
    await db.from('items').update({ attrs, embedding }).eq('id', item.id)

    // 3. Shortlist the nearest items of the opposite kind
    const want = item.kind === 'lost' ? 'found' : 'lost'
    const { data: cands } = await db.rpc('candidates', { q: embedding, want, k: 6 })
    if (!cands?.length) return json({ attrs, matches: 0 })

    // 4. AI re-rank: score each candidate and say why
    const brief = cands.map((c: any) => ({ id: c.id, note: c.note, location: c.location, attrs: c.attrs }))
    const ranked = await ai([{
      type: 'text',
      text: `A student posted a ${item.kind} item. Decide which candidates could be the same object.\nNew item: ${JSON.stringify({ note: item.note, location: item.location, attrs })}\nCandidates: ${JSON.stringify(brief)}\nReply with JSON only: an array of {"id":string,"score":number from 0 to 100,"reason":string} for candidates scoring 50 or more. "reason" is one short sentence naming the details that match. Return [] if none fit.`,
    }], 900) as { id: string; score: number; reason: string }[]

    const rows = ranked.map((r) => ({
      lost_id: item.kind === 'lost' ? item.id : r.id,
      found_id: item.kind === 'found' ? item.id : r.id,
      score: Math.round(r.score),
      reason: r.reason,
    }))
    if (rows.length) await db.from('matches').upsert(rows, { onConflict: 'lost_id,found_id' })
    return json({ attrs, matches: rows.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
