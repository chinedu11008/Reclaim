# Reclaim: AI lost and found for campuses

Post a lost or found item with a photo. A vision model describes it, vector search shortlists candidates, and an AI re-rank explains each match. Owners get a live alert when something fits. Built for GLITCHATHON (Track 4: Campus Lost-and-Found Matcher).

## How AI is used
1. **Vision (Claude):** the photo and note become structured attributes: category, colour, brand, marks, visible text.
2. **Embeddings (Supabase gte-small) and pgvector:** each description is embedded, and the closest items of the opposite kind are shortlisted.
3. **Re-rank (Claude):** the shortlist is scored 0 to 100, with a one-sentence reason for each match.

Built with help from Claude as an AI coding assistant.

## Run it
Needs Node 18+, a Supabase project and an Anthropic API key.

1. In the Supabase SQL Editor, run `supabase/schema.sql`. Under Auth > Providers > Email, turn off "Confirm email" for demos.
2. Deploy the function:
   ```sh
   npx supabase init            # first time only
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase secrets set ANTHROPIC_API_KEY=your-key
   npx supabase functions deploy process-item
   ```
3. Start the app:
   ```sh
   cp .env.example .env         # add your Supabase URL and anon key
   npm install
   npm run dev                  # http://localhost:5173
   ```
4. Deploy to Vercel with the same two `VITE_` variables.

Set an `ANTHROPIC_MODEL` secret to switch models (default `claude-haiku-5-5`).

## Built with
Vue 3, Vite, Supabase (Auth, Storage, Postgres with pgvector, Realtime, Edge Functions), Claude API, Vercel.

## Roadmap
- Ownership check: the finder stores a private detail, and the AI turns it into a question only the real owner can answer
- Image-to-image comparison for the top matches
- Email alerts and a staff handover step
