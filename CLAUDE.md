# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

LingoTube is a local-first English-learning PWA: YouTube with bilingual subtitles, tap-to-define, shadowing with pronunciation scoring, SM-2 review, and optional code-based sync (同步碼). A Vite + React SPA is bundled into a **single Cloudflare Worker** that also serves the `/api/*` routes.

See `README.md` for features, architecture diagram, and deploy steps.

## Commands

```bash
npm install
npm run dev              # Vite dev server, http://localhost:5173 (--host)
npm run build            # tsc -b && vite build  ← main correctness check
npm run preview          # built PWA at :4173 (service worker only runs here)
npm run captions-proxy   # optional local yt-dlp caption proxy on 127.0.0.1:8787

node deploy/build-worker.mjs   # bundle dist/ + worker/*.js → deploy/worker.js
npx wrangler deploy            # needs wrangler.toml (copy from wrangler.toml.example)
```

There is **no unit-test framework**. Verification is:
- `npm run build` must pass (TypeScript strict).
- Ad-hoc Node scripts in `scripts/`: `test-parser.mjs`, `verify-parser.mjs`, `test-structure-parser.mjs` (plain `node scripts/<name>.mjs`).
- Playwright smoke tests: `node scripts/e2e.mjs [baseUrl]` (default `http://localhost:4173`, so run `build` + `preview` first). They use `playwright-core` with a system Chrome (`CHROME_PATH`, default `/usr/bin/google-chrome`).

Locally, `/api/*` does not exist under `npm run dev` — caption auto-fetch, AI, TTS, STT and sync need the deployed Worker. The bundled TED-Ed demo and file import work offline.

## Layout

```
src/
  App.tsx            routes (HashRouter) + bottom nav; seeds the demo video
  pages/             Home, Watch, Review, Saved, Topics, Settings, Article*
  components/        Watch-page panels (Shadow, Structure, Exercise, Sync, WordSheet…)
  lib/
    db.ts            Dexie (IndexedDB) schema — versioned
    sync.ts          同步碼 client: push dirty rows, pull by server seq
    ai/provider.ts   AIProvider abstraction (Workers AI / OpenAI-compatible BYOK / none)
    scoring.ts       Metaphone + Levenshtein pronunciation alignment
    srs.ts           SM-2 scheduling
    subs.ts, autoCaptions.ts, captionLang.ts, articleParser.ts, structureTier.ts, tts.ts, dict.ts
  data/              bundled demo (TED-Ed cues, Brunch & Dim Sum article)
worker/              Cloudflare Worker handlers: captions, ai, tts, stt, sync, limits
deploy/              build-worker.mjs, schema.sql (D1)
server/              captions-proxy.mjs (local yt-dlp helper)
scripts/             test / e2e / icon scripts
```

## Conventions and gotchas

**Worker bundling.** `deploy/build-worker.mjs` concatenates `worker/limits.js`, `captions.js`, `ai.js`, `tts.js`, `stt.js`, `sync.js` into one file after stripping `export`. So:
- Worker files must not `import` each other; everything shares one top-level scope. Avoid duplicate top-level names across files.
- A new `/api/*` route needs a new handler **and** an entry in the `fetch` router (and `isApiRoute`) inside `build-worker.mjs`. A new worker file must be added to the concatenation list there.
- Worker code is plain JS (not type-checked by `tsc`).

**IndexedDB schema (`src/lib/db.ts`).** Never edit an existing `this.version(n)` block. Add `this.version(n+1)` with the full store list plus an `.upgrade()` if data needs migrating.

**Sync invariants.** Synced tables are `SYNC_TABLES` in `sync.ts` (`videos`, `prefs`, `words`, `sentences`). Any write to those must set `updatedAt = Date.now()` and `dirty = 1`. Deletes must write a tombstone (`tombstones` table, id `"<table>:<id>"`) or the row will come back from another device. The demo video is not re-seeded if a tombstone exists. Recordings, AI/TTS caches, and articles are intentionally **not** synced.

**Privacy.** BYOK API keys live only in IndexedDB (`kv`, key `ai-settings`) and must stay out of JSON export (`db.ts` filters it) and sync. The server stores only `SHA-256(sync code)`; IPs in rate limiting are hashed. Don't log either.

**AI.** Sentence structure (句型拆解) prefers `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, falling back to 8B models; 精準 vs 慳額度 is chosen in Settings. Cached 70B results may be shown in either mode, but an 8B result must never be labelled 精準. Usage caps live in `worker/limits.js` and are configured via Worker vars (`STRUCTURE_70B_DAILY_CAP`, `AI_IP_LIMIT`, `STT_IP_LIMIT`, `TTS_IP_LIMIT`).

**UI copy.** User-facing text is Traditional Chinese, often Cantonese (e.g. 漏咗). Keep new strings in the same register; error messages to users are short and in Chinese. Code, comments and identifiers are English. Layout is mobile-first (e2e uses a 390×844 viewport); Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config`).

**CJK.** Word-tap splitting, shadowing scores, and structure breakdown are English-only. For zh/ja/ko primary captions the app shows a note instead of splitting characters — keep that behaviour.

**Routing.** HashRouter (`/#/watch/...`) so the Worker's SPA fallback and the PWA work offline. Don't switch to BrowserRouter.

## Don't commit

`wrangler.toml`, `.env`, `deploy/worker.js`, `deploy/deploy-code.js`, `dist/` — all gitignored. Cloudflare account and D1 ids belong in env / `wrangler.toml`, never in source.

The root `*_IMPLEMENTATION.md` / `ARTICLE_PRACTICE_IMPROVEMENTS.md` files are historical build reports; they may mention paths that no longer exist. Treat the code as the source of truth.
