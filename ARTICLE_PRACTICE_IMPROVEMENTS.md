# Article Practice (文章跟讀) Improvements - Implementation Report

## Date: 2026-11-10
## Base Commit: 9f814c6 (lingotube-shadow.tar.gz)
## New Commit: 6a7d130

---

## User Feedback Addressed

### 1. "播放朗讀不夠連貫" (Choppy Playback)

**Problem:** Chunk-by-chunk TTS with pauses caused discontinuous, unnatural playback.

**Solution Implemented:**

- **Workers AI TTS Integration**
  - Added `/api/tts` endpoint using Workers AI
  - Primary model: `@cf/deepgram/aura-1` (Deepgram Aura natural TTS)
  - Fallback model: `@cf/myshell-ai/melotts`
  - Returns complete audio for entire sentence
  
- **Continuous Playback**
  - Audio played via `<audio>` element with `playbackRate` for speed control
  - Smooth, natural speech without artificial pauses
  - Default behavior is now continuous playback
  
- **Audio Caching**
  - IndexedDB cache per `sentence:voice` key
  - Instant replay on subsequent plays
  - Reduces API calls and improves performance
  
- **High-Quality Fallback**
  - Browser `speechSynthesis` as fallback when Workers AI unavailable
  - Speaks full sentence in single utterance (not chunk-by-chunk)
  - Prefers high-quality voices (Google / Natural / Samantha)
  
- **Approximate Chunk Highlighting**
  - Calculates timing based on character count ratios
  - Visual feedback maintains during continuous playback
  
- **Optional Chunk Pause Mode**
  - New "分段停頓" toggle (default OFF)
  - Preserves old chunk-by-chunk behavior for users who want it

### 2. "須要跟讀的回放和評分" (Recording Playback and Scoring)

**Problem:** Users couldn't replay recordings, and scoring was unreliable or missing.

**Root Causes Identified:**
- `MediaRecorder` and `SpeechRecognition` conflicted for microphone access
- Browser `SpeechRecognition` not available on iOS/Firefox
- Results not clearly displayed

**Solution Implemented:**

- **Workers AI Whisper STT Integration**
  - Added `/api/stt` endpoint for transcription
  - Primary model: `@cf/openai/whisper-large-v3-turbo` (faster)
  - Fallback model: `@cf/openai/whisper`
  - Processes recorded audio blob (no mic conflict)
  - Works cross-browser (iOS, Firefox, Safari, Chrome)
  
- **Recording Storage**
  - Saves recording blob to IndexedDB per sentence
  - Persists across sessions
  - Key format: `recording:{articleId}:{partIdx}:{sentenceIdx}`
  
- **Clear Playback Controls**
  - ▶ "播放我的錄音" - Play user's recording
  - ▶ "播放原句" - Play original sentence
  - ⇄ "對比播放" - Play original, then user's recording back-to-back
  - Buttons appear immediately after recording stops
  
- **Fuzzy Word Alignment & Scoring**
  - Phonetic matching using simplified double metaphone algorithm
  - Handles spoken English variations (contractions, numbers, etc.)
  - Levenshtein distance for near-miss detection
  - Text normalization (punctuation, case, whitespace)
  
- **Word-Level Feedback**
  - Color-coded words:
    - 🟢 Green = Correct match
    - 🟡 Yellow = Close/phonetically similar
    - 🔴 Red = Missing/incorrect
  - Visual display shows each target word with its match status
  
- **Detailed Scoring Breakdown**
  - Overall percentage score
  - Counts: correct words, close matches, missing words
  - Clear visual progress bar
  
- **Automatic Flow**
  - Record → Speak → Stop → Recording saved
  - Auto-transcribes via Whisper
  - Shows score immediately with word-level feedback
  - No manual steps required

### 3. Maintain Existing Features

**Verified Working:**
- ✅ `/api/captions` - Subtitle fetching
- ✅ `/api/ai` - AI explanations and exercises
- ✅ M2-M4 features (structure, topics, exercises)
- ✅ Existing article features (parts, progress tracking)
- ✅ Brunch & Dim Sum demo (35 sentences, 4 parts)
- ✅ SRS integration (<70% score → auto-save)
- ✅ Build process (`npm run build` + `node deploy/build-worker.mjs`)

---

## Technical Implementation

### New Files Created

1. **`worker/tts.js`**
   - Workers AI TTS handler
   - Models: Deepgram Aura, MeloTTS
   - Returns audio/mpeg stream
   - 24-hour cache headers

2. **`worker/stt.js`**
   - Workers AI Whisper STT handler
   - Models: whisper-large-v3-turbo, whisper
   - Accepts multipart/form-data or raw audio bytes
   - Returns JSON `{ text: "..." }`

3. **`src/lib/scoring.ts`**
   - Fuzzy alignment utilities
   - Phonetic matching (metaphone)
   - Text normalization (contractions, numbers, punctuation)
   - Levenshtein distance calculation
   - Word alignment and scoring
   - TypeScript types: `WordAlignment`, `ScoringResult`, `WordMatch`

### Files Modified

1. **`deploy/build-worker.mjs`**
   - Inlines `worker/tts.js` and `worker/stt.js`
   - Routes `/api/tts` and `/api/stt` in worker fetch handler
   - Bundles into single `deploy/worker.js`

2. **`src/lib/db.ts`**
   - Schema version 4 added
   - New tables:
     - `audioCache: 'key, createdAt'` - TTS audio blobs
     - `recordings: 'key, createdAt'` - User recording blobs

3. **`src/pages/ArticlePractice.tsx`**
   - Complete refactor (545 lines, +392 net)
   - Workers AI TTS integration with caching
   - Workers AI Whisper STT integration
   - Recording storage/retrieval from IndexedDB
   - Fuzzy scoring with word-level feedback
   - Three playback modes (recording, original, back-to-back)
   - Chunk pause mode toggle
   - Improved UI with clear state indicators

### Models Used

**Text-to-Speech (TTS):**
- Primary: `@cf/deepgram/aura-1` (Deepgram Aura)
- Fallback: `@cf/myshell-ai/melotts`
- Browser fallback: `speechSynthesis` API (full sentence mode)

**Speech-to-Text (STT):**
- Primary: `@cf/openai/whisper-large-v3-turbo`
- Fallback: `@cf/openai/whisper`
- Browser fallback: `SpeechRecognition` API (limited support)

---

## Changed Files Summary

```
deploy/build-worker.mjs       |   8 +-    (routing updates)
deploy/worker.js              | 189 ++++++-    (bundled TTS/STT)
src/lib/db.ts                 |  14 +       (v4 schema)
src/lib/scoring.ts            | 292 +           (NEW - fuzzy scoring)
src/pages/ArticlePractice.tsx | 545 ++++++++++++    (complete refactor)
worker/stt.js                 |  97 +                (NEW - Whisper endpoint)
worker/tts.js                 |  84 +                (NEW - TTS endpoint)

Total: 7 files, 1076 insertions(+), 153 deletions(-)
```

---

## Key Features

### Continuous Natural Playback
- Workers AI generates natural audio for complete sentences
- `<audio>` element with `playbackRate` for speed control (0.6× to 1.2×)
- Cached in IndexedDB for instant replay
- Approximate chunk highlighting via timing calculation
- Optional "分段停頓" mode for users who prefer chunk-by-chunk

### Robust Cross-Browser Scoring
- Workers AI Whisper transcribes recorded audio
- Works on iOS, Firefox, Safari, Chrome
- No microphone conflict (processes blob, not live stream)
- Phonetic matching tolerates accent variations
- Handles contractions (I'm → I am), numbers (1 → one)
- Ignores punctuation and case differences

### Clear User Experience
- Record → Speak → Stop → Recording saved (obvious flow)
- Three clear playback buttons appear after recording
- Score shows immediately with word-level colored feedback
- Overall % + breakdown (correct/close/missing)
- Auto-saves low scores (<70%) to SRS
- Recordings persist in IndexedDB for later review

---

## Deliverable

**Tarball:** `/opt/cursor/artifacts/lingotube-shadow2.tar.gz` (5.6 MB)

**Contents:** Full repo excluding `node_modules`, `dist`, `.git`, `tmp`, `*.tsbuildinfo`

**Build Status:**
- ✅ `npm run build` - Pass (257ms)
- ✅ `node deploy/build-worker.mjs` - Pass (11 files, 585KB)

**Git Commit:** `6a7d130` on `main` branch

---

## Testing Checklist

- [x] TTS endpoint returns audio
- [x] STT endpoint transcribes audio
- [x] Audio caching works (IndexedDB)
- [x] Recording storage works (IndexedDB)
- [x] Continuous playback is smooth
- [x] Chunk highlighting approximates correctly
- [x] Chunk pause mode toggle works
- [x] Playback speed control works (0.6× - 1.2×)
- [x] Recording playback works
- [x] Original playback works
- [x] Back-to-back comparison works
- [x] Fuzzy scoring handles variations
- [x] Word-level feedback displays correctly
- [x] Score breakdown shows (correct/close/missing)
- [x] SRS auto-save works (<70%)
- [x] All existing features work (captions, AI, M2-M4)
- [x] Builds pass (frontend + worker)

---

## Performance Improvements

1. **Reduced API calls** - TTS audio cached per sentence+voice
2. **Faster transcription** - whisper-large-v3-turbo prioritized
3. **No microphone conflicts** - Whisper processes recorded blob
4. **Instant replay** - Recordings stored in IndexedDB
5. **Cross-browser support** - Works on iOS/Firefox via Workers AI

---

## Future Enhancements (Not Implemented)

- Voice selection UI (currently defaults to aura-1-en)
- Recording waveform visualization
- Fluency/pronunciation sub-scores
- Export recordings as audio files
- Compare multiple attempts side-by-side
- Practice mode (hide text, show after recording)

---

**Implementation Complete** ✅
