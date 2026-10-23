# Reclaim: AI lost and found for campuses

Post a lost or found item with a photo. A vision model describes it, vector search shortlists candidates, and an AI re-rank explains each match. Owners get a live alert when something fits. Built for GLITCHATHON (Track 4: Campus Lost-and-Found Matcher).

## How AI is used
1. **Vision (Gemini):** the photo and note become structured attributes: category, colour, brand, marks, visible text.
2. **Embeddings (Supabase gte-small) and pgvector:** each description is embedded, and the closest items of the opposite kind are shortlisted.
3. **Re-rank (Gemini):** the shortlist is scored 0 to 100, with a one-sentence reason for each match.

Built with help from Claude as an AI coding assistant.

## Run it
Needs Node 22.12+, a Supabase project and a Gemini API key (free from aistudio.google.com).

1. In the Supabase SQL Editor, run `supabase/schema.sql`. Under Auth > Providers > Email, turn off "Confirm email" for demos.
2. Deploy the function:
   ```sh
   npx supabase init            # first time only
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase secrets set GEMINI_API_KEY=your-key GEMINI_MODEL=gemini-3.8-flash
   npx supabase functions deploy process-item
   npx supabase functions deploy verify-claim
   ```
3. Start the app:
   ```sh
   cp .env.example .env         # add your Supabase URL and anon key
   npm install
   npm run dev                  # http://localhost:5173
   ```
4. Deploy to Vercel with the same two `VITE_` variables.

The default Gemini model is `gemini-3.8-flash`. Set a `GEMINI_MODEL` secret to select a different supported model.

## Built with
Vue 3, Vite, Supabase (Auth, Storage, Postgres with pgvector, Realtime, Edge Functions), Gemini API, Vercel.

## Roadmap
- Ownership check: the finder stores a private detail, and the AI turns it into a question only the real owner can answer
- Image-to-image comparison for the top matches
- Email alerts and a staff handover step

## Claim check and demo data
1. SQL Editor: run `supabase/002_claims.sql`.
2. `npx supabase functions deploy verify-claim`
3. Add your service role key to `.env` as `SUPABASE_SERVICE_ROLE_KEY`.
4. Put 8 JPG photos in `seed/photos/` that match `seed/items.json`, then run `npm install && npm run seed`.
