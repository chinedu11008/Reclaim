# Devpost kit

**Title:** Reclaim
**Tagline:** Lost something on campus? Snap it and let AI find it.

## Description (paste into Devpost)
**The problem.** Lost items on campus end up in group chats and on notice boards nobody searches by photo. Owners describe things vaguely, and finders can't tell the real owner from someone chancing it. Reclaim helps students who lose things and students who find them.

**How it works.** Post a lost or found item with a photo. Reclaim shortlists the closest items of the opposite kind and explains each match with a score. The owner gets a live alert, taps "This is mine", and answers one question about a detail only the real owner would know. A correct answer marks the item claimed.

**How we used AI.**
- Gemini vision turns each photo and note into structured attributes: category, colour, brand, marks, visible text.
- Supabase's gte-small model embeds each description, and pgvector shortlists the nearest items of the opposite kind.
- Gemini re-ranks the shortlist with a 0 to 100 score and a one-sentence reason.
- Gemini writes the ownership question from the finder's private detail and judges the answer. The claimant never sees the detail, and answers are treated as untrusted text.
- Claude also helped write the code (AI coding assistant).

**Challenges and what we learned.** [Write 2 or 3 real ones from your build.]

**What's next.** Image-to-image comparison for top matches, email alerts, a staff handover desk, rollout across campuses.

## Built With
vue, vite, supabase, postgresql, pgvector, supabase-edge-functions, deno, typescript, gemini-api, vercel

## Demo video (3 minutes max)
- 0:00 The problem, in two sentences.
- 0:20 Signed in as a finder: post a found item with photo and private detail.
- 0:50 Second account: post the lost item with a different-angle photo. A ticket appears with a score and reason.
- 1:30 Tap "This is mine", answer the question, show "Verified". Then show one wrong answer on another match.
- 2:10 The pipeline in one slide: vision, embeddings, re-rank, verification.
- 2:40 Impact and what's next.
