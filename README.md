# LingoTube 🎬🇬🇧

Trancy-style English learning PWA for Cantonese / Chinese speakers. Watch YouTube with
**side-by-side English + Traditional Chinese subtitles**, tap any word for its meaning and
pronunciation, save words and sentences, and review them with spaced repetition.
Local-first: everything is stored in IndexedDB on your device — **no account needed**, works offline.

## Stack

| Concern | Choice |
| --- | --- |
| App | Vite + React 19 + TypeScript, HashRouter (static-host friendly) |
| UI | Tailwind CSS v4, Traditional Chinese labels, mobile-first / responsive |
| PWA | `vite-plugin-pwa` (manifest, Workbox precache, auto-update, 192/512/maskable icons) |
| Data | Dexie (IndexedDB): videos, per-video prefs, words, sentences, dictionary cache, settings |
| Video | YouTube IFrame Player API (polled at ~8 Hz for subtitle sync). Falls back to a timer when offline / embedding blocked |
| Word lookup | bundled offline gloss for the demo → IndexedDB cache → dictionaryapi.dev (EN definition, IPA, audio) + MyMemory (zh-TW gloss) |
| Pronunciation | dictionary audio when available, else Web Speech `speechSynthesis` |
| SRS | SM-2 flavoured scheduler, 4 buttons (重來 / 困難 / 良好 / 簡單) |
| AI | `src/lib/ai/provider.ts`: `AIProvider` interface + `NoAIProvider` + `OpenAICompatibleProvider` (key stored locally). Wired into the UI from M2 |
| Captions | Demo bundled; import `.srt` / `.vtt`; optional local proxy (`server/captions-proxy.mjs`, uses `yt-dlp`) |

## Run it

```bash
npm install
npm run dev                 # dev server (http://localhost:5173)

# production build + PWA (service worker only runs on the built version)
npm run build
npm run preview             # http://localhost:4173  (also reachable on your LAN)
```

Install to home screen: open the preview URL in Chrome/Edge (install icon in the address bar) or
Safari/Chrome on a phone → *Add to Home Screen*. (Service workers need `https://` or `localhost`;
for phone testing over LAN use `https` via a tunnel, or install from a deployed https URL in M5.)

### Optional: fetch captions for any YouTube video

Browsers can't read YouTube captions directly (CORS). Two options:

1. **Import files** – on *首頁 → ＋加影片* paste the URL and pick an English `.srt`/`.vtt`
   (and optionally a Chinese one; they're aligned by time).
2. **Local proxy** – install [yt-dlp](https://github.com/yt-dlp/yt-dlp), then run
   `npm run captions-proxy` (listens on `127.0.0.1:8787`) and use *用本機代理抓字幕*.
   If YouTube asks for a sign-in, run with `YT_COOKIES_FROM_BROWSER=chrome npm run captions-proxy`.

### Tests

```bash
npm run build && npm run preview &        # in one terminal
node scripts/e2e.mjs                       # headless Chrome (CHROME_PATH=... to override); screenshots -> screenshots/
```

## Milestone 1 (done)

- App shell, bottom nav (mobile) / sidebar (desktop), PWA installable + offline
- Video page: YouTube player + synced bilingual subtitles, click a line to seek, auto-scroll, per-video toggles
  (EN / 中文 / auto-scroll / single-line loop / pause-on-word-tap / speed / font size, persisted per video)
- Tap a word → meaning (中文 + English), IPA, 🔊 pronunciation, save to vocab bank
- Save sentences (☆); 生字庫 page (words / sentences, search, jump back to video, delete); JSON export/import
- 複習: spaced-repetition flashcards (cloze for words, zh→en for sentences), keyboard shortcuts
- Demo video with real English captions + Traditional Chinese translation (TED-Ed "3 tips to boost your confidence")
- Visible “coming soon” stubs: sentence structure, exercises, shadowing, topic collections
- Video deletion: single-delete (× button) and batch-delete (選取 mode) on 我的影片 page

## Milestone 2 (done)

- **AI Settings**: Enabled AI configuration in Settings page with test button (測試連線)
- **Sentence Structure**: Watch 「句型」tab now functional - click 🧩 on any cue to see:
  - Structure analysis (e.g., "Subject + Verb + Object")
  - Breakdown with role labels and Traditional Chinese glosses
  - Grammar notes in Traditional Chinese
  - Translation
- **Workers AI Integration**: Default AI provider via `/api/ai` route using Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct-fast)
- **OpenAI Compatible**: BYOK support for OpenAI, OpenRouter, Groq, Ollama, etc.
- **Caching**: Sentence explanations cached in IndexedDB to avoid repeat AI calls

## Milestone 3 (done)

- **Topics Page**: Auto-group saved words, sentences, and videos by theme (e.g., "心理·自信", "科技", "日常對話")
  - Generate topics button with AI
  - Cached results persist in IndexedDB
  - Click items to navigate to source (video/saved page)
- **Exercise Generation**: Watch 「練習」tab generates practice exercises:
  - Multiple types: cloze (填充), multiple-choice (選擇), translate (翻譯), order (排序)
  - Interactive checking with explanations
  - Cached per video
  - Regenerate button
- Both features work with Workers AI or BYOK

## Milestone 4 (done)

- **Shadowing/Speech Practice**: Watch 「跟讀」tab with Web SpeechRecognition:
  - Play audio of current sentence
  - Record user speech via browser SpeechRecognition API
  - Score accuracy (0-100%) using Levenshtein distance
  - Show recognized transcript and missed words
  - Navigate through sentences (prev/next)
  - Graceful fallback message for unsupported browsers (Chrome/Safari required)


## Deploy (unlisted, Cloudflare Worker)

```bash
npm run build && node deploy/build-worker.mjs   # bundles dist/ into deploy/worker.js + deploy/deploy-code.js
```
`deploy-code.js` is an async arrow function for the Cloudflare connector `execute` tool (PUTs Worker script `lingotube`, then enable its workers.dev subdomain). Live at https://lingotube.hackerkurumi.workers.dev (noindex).

## Roadmap

- ✅ **M1** – Core video player, subtitles, word lookup, vocab bank, SRS review
- ✅ **M2** – AI sentence structure, Workers AI integration, BYOK support
- ✅ **M3** – Topic grouping, exercise generation
- ✅ **M4** – Shadowing with speech recognition
- **M5** – Enhanced deployment, optional cloud sync

## AI Configuration

LingoTube supports three AI modes:

### 1. Workers AI (Default, No Setup Required)

When deployed to Cloudflare Workers with the `AI` binding, the app automatically uses Workers AI via the `/api/ai` endpoint. This provides:
- **Model**: `@cf/meta/llama-3.1-8b-instruct-fast`
- **Features**: Sentence structure, topic grouping, exercise generation
- **Cost**: Free (included in Cloudflare Workers AI free tier)
- **Limitations**: Smaller model, may be less accurate than GPT-4 class models

### 2. OpenAI Compatible (BYOK)

For better results, configure your own API key in Settings:
1. Go to Settings → AI 服務
2. Select "OpenAI 相容"
3. Enter Base URL (e.g., `https://api.openai.com/v1`)
4. Enter Model (e.g., `gpt-4o-mini`)
5. Enter API Key
6. Click 測試連線 to verify

Supports:
- OpenAI (gpt-4o, gpt-4o-mini, etc.)
- OpenRouter (access to Claude, Gemini, etc.)
- Groq (fast inference)
- Ollama (local models)
- LM Studio (local)

### 3. No AI Mode

Select "不使用 AI" in Settings. The app remains fully functional with:
- Manual subtitle import
- Offline dictionary
- All non-AI features (video playback, vocab bank, SRS review)

## Notes

- Demo video © TED-Ed (CC BY-NC-ND); English captions are TED-Ed's, the Chinese translation was written for this project.
- API keys never leave the device and are excluded from JSON exports.
- AI responses are cached in IndexedDB to minimize API calls.

## 自動抓字幕 (`GET /api/captions?v=<11-char id>`)

The deployed Worker (`worker/captions.js`, inlined by `deploy/build-worker.mjs`) fetches subtitles server-side so the phone just pastes a link.

- Returns `{title, en:[{start,end,text}], zh:[...], enSource, zhSource, note?, debug}`; the app merges with `mergeBilingual`.
- yt-dlp and browser cookies can't run in a Worker (no Python/subprocess), so the same logic is reimplemented in JS: 11-char ID check → InnerTube `player` (ANDROID / IOS / ANDROID_VR clients, then watch-page scrape) → `captionTracks` → json3 → cues (dedupe consecutive repeats; auto-captions are rebuilt into sentences from word timings).
- English: manual track first, else auto (asr). Chinese: zh-Hant / zh-Hans track → YouTube machine translation (`tlang=zh-Hant`) → Workers AI (Qwen3, batched, binding `AI`) → public gtx.
- YouTube's bot check is intermittent per Cloudflare IP; the app retries transient `blocked/failed` responses up to 3 times. Errors are Chinese (`blocked`, `no_en` = 「這部影片找不到英文字幕」, `unavailable`, `bad_id`).
- Fallbacks on Home: paste text (SRT/VTT or YouTube "Show transcript" with `0:05` stamps), file import, local yt-dlp proxy.
- Test: `node scripts/add-flow.mjs <url>` (phone-size add-video flow).
