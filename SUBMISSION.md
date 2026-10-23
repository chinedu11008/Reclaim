# Reclaim

**Tagline:** Lost something on campus? Snap it and let AI help find it.

## Inspiration

Campus lost-and-found often depends on group chats, notice boards, and word of mouth. A description like “black bag” could fit dozens of items, and a finder has no easy way to tell whether someone claiming an item is its owner. We wanted to make it easier to connect lost items with the people looking for them, while giving finders a simple way to check a claim.

## What it does

Students can post a lost or found item with a description, location, and photo. Reclaim analyzes the post, searches for likely matches of the opposite type, and shows a score with a short explanation. When a lost item may match something found, its owner can request a claim check and answer a question based on a private detail that the finder recorded. A correct answer marks the item as claimed.

## How we built it

We built the app with Vue 3 and Vite, using Supabase for authentication, Postgres, photo storage, realtime updates, and Edge Functions. Gemini turns a photo and note into structured item details, such as category, colour, brand, and distinctive marks. Supabase’s `gte-small` model creates an embedding, and Postgres with pgvector finds nearby descriptions of the opposite item type. Gemini then re-ranks those candidates and gives a score and reason.

For claim checks, the finder can save a private detail separately from the public post. An Edge Function uses that detail to create a question and judge the claimant’s answer without showing them the original detail. The database’s access policies keep private data restricted.

Claude also helped us as an AI coding assistant.

## Challenges we ran into

Matching descriptions is difficult when people use different words for the same object or leave out useful details. We split the job into stages: vision extracts consistent attributes, vector search finds a shortlist, and a second model compares the candidates and explains its choices.

We also needed a claim flow that could check ownership without exposing the finder’s private detail. Keeping that detail separate and treating the claimant’s answer as untrusted input helped shape the Edge Function and database policies.

During development, Gemini rejected the older `gemini-2.5-flash` model for a new API user. We updated the project to use a currently supported model by default and made the model configurable through a Supabase secret.

## Accomplishments that we're proud of

We brought photo understanding, semantic search, match explanations, realtime updates, and a private-detail claim check into one prototype. Reclaim does more than display lost-and-found posts: it helps people find possible matches and gives them a way to verify a claim before handing an item over.

## What we learned

We learned that AI works best here as a series of focused steps: extract useful details, retrieve plausible candidates, then compare and explain them. A similarity score alone cannot establish ownership, so the claim check adds a separate signal. We also learned to keep model choice configurable as API availability changes.

## What's next for Reclaim

We want to compare images directly, add email alerts, and include a campus staff handover step. Next, we’d pilot Reclaim with real campus users, learn which item details lead to useful matches, and improve the flow based on their feedback.

## Built with

Vue 3, Vite, Supabase, Postgres, pgvector, Supabase Edge Functions, Deno, TypeScript, Gemini API.

## Demo video outline (3 minutes max)

- **0:00** Introduce the campus lost-and-found problem.
- **0:20** Sign in as a finder and post a found item with a photo and private detail.
- **0:50** Sign in with a second account and post the matching lost item. Show the match score and reason.
- **1:30** Claim the match, answer the private-detail question, and show the verified result.
- **2:10** Explain the pipeline: vision, embeddings, re-ranking, and verification.
- **2:40** Share the impact and what’s next for Reclaim.
