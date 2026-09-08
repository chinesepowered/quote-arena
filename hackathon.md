# Hackathon log

- **Project:** Quote Arena
- **Event:** Convex All Gas Hackathon
- **What it does:** Posts one home-repair job, finds local contractors, emails them all from a single inbox, and normalizes every reply into a ranked quote on a live leaderboard.
- **Live app:** https://polished-dragon-158.convex.site
- **Repo:** none
- **Frontend:** Convex static hosting
- **Convex deployment:** https://polished-dragon-158.convex.cloud
- **Components:** @convex-dev/static-hosting, @convex-dev/rate-limiter, @convex-dev/agent
- **Convex features:** schema, tables, indexes, queries, mutations, actions, HTTP actions, scheduled functions, crons, file storage, realtime queries
- **Auth:** Convex Auth
- **AI models:** not hardcoded — the endpoint and model are chosen per deployment through `LLM_BASE_URL` / `LLM_MODEL` / `LLM_VISION_MODEL` against an OpenAI-compatible API (`convex/lib/llm.ts`); the model id in use is stamped on every stored quote, contractor and answer row
- **Started:** 2026-09-01T17:35:40Z
- **Last updated:** 2026-09-08T18:36:25Z

## Log

### 2026-09-01 - cb7d2ea
Stood up the chassis on Convex: auth, the mail plumbing, the sponsor SDK wrappers and static hosting, before any product code. `convex/http.ts` routes the Convex Auth endpoints and a signed AgentMail webhook as exact routes and registers static hosting as the catch-all, so the app and its backend share one origin. Kept a hard rule from the start that only one module may talk to each vendor (`convex/lib/llm.ts`, `convex/lib/firecrawl.ts`, `convex/lib/agentmail.ts`), and that Node-only SDKs stay behind `"use node"` files. Convex features: schema, indexes, HTTP actions, components, Convex Auth (`convex/schema.ts`, `convex/convex.config.ts`, `convex/auth.ts`).

### 2026-09-01 - 28a0b73
Built the whole product backend in one pass: jobs, contractors, quotes, messages and questions with indexes for every read path, Firecrawl-driven contractor discovery, the RFQ send path, inbound reply analysis, the 48-hour nudge cron and a seeded demo arena. Put the leaderboard formula in a single pure module so the server ranking and the UI explanation can never drift apart (`convex/lib/ranking.ts`). Convex features: queries, mutations, internal functions, actions, scheduled functions, crons (`convex/jobs.ts`, `convex/contractors.ts`, `convex/quotes.ts`, `convex/sourcing.ts`, `convex/rfq.ts`, `convex/inbound.ts`, `convex/crons.ts`, `convex/seed.ts`).

### 2026-09-01 - c506604
Shipped the arena UI: a job form with drag-and-drop photo upload through Convex file storage, a contractor column that fills in live while the crawl runs, an animated quote leaderboard, a compare view and a thread/questions drawer. Added an LLM circuit breaker so a hanging endpoint degrades to heuristics instead of making the user wait (`convex/aiHealth.ts`). Convex features: realtime queries, file storage with upload URLs (`src/pages/NewJob.tsx`, `convex/jobs.ts`, `src/components/Leaderboard.tsx`).

### 2026-09-01 - 2fb2861
Three rounds of polish on the same session: an AI-health indicator in the arena header that says plainly when replies are being pattern-matched instead of extracted, better contractor naming from crawl titles and domains, an inline winner badge, a fix for negated phrases being read as *includes* by the heuristic quote extractor ("does not include staining"), and a rank badge that no longer sticks after a reorder (`convex/lib/quoteAi.ts`, `src/components/Leaderboard.tsx`, `src/pages/Arena.tsx`).

### 2026-09-01 - 0bff611
Fixed reply routing. A case code names the job, and every email on that job carries it, so matching an inbound reply to the *first* message under the code attached answers to the wrong conversation. Inbound mail is now matched by thread id first, then by a normalized subject against the exact outbound message that started the thread, then by sender address (`convex/mail.ts`, `convex/lib/mailUtil.ts`).

### 2026-09-01 - c0d96e3
Closed an access hole found while reviewing the public demo. The live app signs every visitor in anonymously, so "is signed in" proved nothing — the unrouted-mail view could be read by any visitor. It now requires an account with an email address (real password sign-in, not the anonymous provider), truncates bodies and redacts sender addresses even then (`convex/mail.ts`).

### 2026-09-07 - cb5a041
Made Firecrawl spending structurally safe rather than merely tuned. Added a permanent result cache and a spend guard denominated in credits, then routed every crawl through one gateway that serves a stored result when it has one, checks the provider's own credit-usage endpoint before spending, and refuses to go below a reserve or over a daily cap. Repeating what an earlier visitor did now costs nothing. Convex features: tables, indexes, internal queries and mutations (`convex/crawlCache.ts`, `convex/lib/firecrawl.ts`, `convex/schema.ts`).

### 2026-09-07 - 24ace5e
Made a budget refusal a normal outcome instead of an error. Contractor sourcing keeps whatever is already on the board, stops early rather than burning a second query on the same refusal, and reports honestly; the contractor column now says it is showing saved results while live search is paused (`convex/sourcing.ts`, `src/components/Contractors.tsx`).

### 2026-09-07 - 692d597
Corrected the credit cost estimates the guard reserves against per call type, and made the cache TTL read from the environment at call time instead of at module load, so changing it takes effect without a redeploy (`convex/lib/firecrawl.ts`).

### 2026-09-08 - working tree
Wrote the judge-facing `README.md` and this log, and committed the six demo screenshots under `public/demo/`. Verified every claim against the code before writing it: the registered components, the indexes behind each query, the scheduler and cron paths, the file-storage upload flow, the anonymous-first auth, and the ranking formula (including the worked example, which reproduces the numbers on the demo board). Confirmed `pnpm run build` passes and that no secret or address appears in either document.
