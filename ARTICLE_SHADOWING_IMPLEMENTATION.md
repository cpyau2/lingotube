# 文章跟讀 (Article Shadowing) Implementation Report

## ✅ Feature Complete

LingoTube now includes a comprehensive article shadowing feature for practicing English fluency with structured scripts.

## 📦 Deliverables

**Tarball Location**: `/opt/cursor/artifacts/lingotube-shadow.tar.gz` (5.5 MB)

### Build Status
- ✅ `npm run build` passes (462 kB JS bundle)
- ✅ `node deploy/build-worker.mjs` succeeds (571 kB worker)
- ✅ All TypeScript compilation successful
- ✅ PWA manifest and service worker generated

## 🎯 Feature Overview

### 1. Article Input & Parsing

**Format Support**:
- Plain English text (auto-formatted)
- Pre-formatted shadowing scripts with:
  - Part headings: `### Part 1: Title (中文subtitle)`
  - Pause markers: `/` separates chunks within sentences
  - Stress markers: `**word**` or `**multi word**` for emphasis
  - Curly apostrophes and Unicode supported

**Parser Features** (`src/lib/articleParser.ts`):
- Flexible Part heading detection (`###`, `##`, or plain `Part N`)
- Multi-word stress detection (`**egg tarts**`, `**next time**`)
- Trailing slash handling (ignores empty chunks)
- Deterministic fallback formatting (splits every ~6 words)
- Validation: `scripts/verify-parser.mjs` tests all parsing logic

### 2. Built-in Demo Script

**Brunch & Dim Sum (A2)**:
- 4 Parts: Brunch & Dim Sum, Grocery Store, Morning Time, Cleaning
- 35 total sentences (10, 9, 9, 7 per part)
- Real A2-level content with Chinese part subtitles
- One-tap loading from article list page
- Stored in `src/data/brunchDimSum.ts`

**Parser Test Results**:
```
✓ Parts: 4 (expected: 4)
✓ Sentences: [10,9,9,7] (expected: [10,9,9,7])
✓ Total sentences: 35 (expected: 35)
✓ Stressed in first sentence: [dim sum]
✓ Multi-word "egg tarts" detected: true
✓ Multi-word "next time" detected: true
✓ Part titles (with Chinese subtitles): ✓
```

### 3. Practice Player Features

**Playback** (`src/pages/ArticlePractice.tsx`):
- Browser TTS (speechSynthesis) with English voice selection
- Chunk-by-chunk playback with visual highlighting
- Speed control: 0.6× / 0.8× / 1.0× / 1.2×
- Repeat options: 1 / 3 / 5 / ∞ (infinite loop)
- Configurable pause between chunks: Short (200ms) / Medium (400ms) / Long (600ms)
- Automatic gap after each sentence for shadowing

**Recording & Comparison**:
- MediaRecorder API for user audio capture
- Compare mode: plays original TTS, then user recording back-to-back
- Permission handling for microphone access

**Speech Recognition Scoring**:
- Web SpeechRecognition API (Chrome/Safari)
- Levenshtein distance algorithm for accuracy
- 0-100% score with color-coded feedback:
  - ≥80%: Green (excellent)
  - ≥60%: Amber (good)
  - <60%: Red (needs practice)
- Shows recognized transcript
- Highlights missed/wrong words

**Progress Tracking**:
- Attempts counter per sentence
- Best score saved per sentence
- Last practiced timestamp
- Progress bars for each Part and overall script
- Auto-add sentences scoring <70% to SRS review system
  - Tagged as source: `article-${articleId}`
  - Integrated with existing flashcard system

### 4. Article Management

**List Page** (`src/pages/ArticleList.tsx`):
- Grid view with article cards
- Shows: title, level, part count, sentence count
- Progress bar (% practiced) per article
- Single-delete (× button) with confirmation
- Batch-delete mode (select multiple)
- Built-in demo banner with one-tap load

**New/Edit Page** (`src/pages/ArticleNew.tsx`):
- Title and level (optional) input
- Two input modes:
  - **Plain text**: paste raw English article
  - **Formatted**: paste pre-formatted script
- "自動排版" button:
  - Uses AI provider if available
  - Falls back to deterministic split (~6 words/chunk)
- Format helper card explains syntax
- Validation before save

### 5. Browser Compatibility

**Feature Detection**:
- Checks for speechSynthesis, MediaRecorder, SpeechRecognition
- Shows friendly warnings for unsupported browsers
- Graceful degradation: missing features don't break the app

**Recommended Browsers**:
- ✅ Chrome (full support)
- ✅ Safari (full support)
- ⚠️ Firefox (no SpeechRecognition)
- ⚠️ Edge (full support on Chromium)

**Fallback Behaviors**:
- No TTS: shows "不支援語音合成" message
- No MediaRecorder: recording button disabled
- No SpeechRecognition: scoring unavailable, shows info card

## 📂 New & Modified Files

### New Files (10)
1. `src/lib/articleParser.ts` - Parser for formatted scripts
2. `src/lib/types.ts` - Updated with Article types
3. `src/data/brunchDimSum.ts` - Built-in A2 demo script
4. `src/pages/ArticleList.tsx` - Article management page
5. `src/pages/ArticleNew.tsx` - New article creation
6. `src/pages/ArticlePractice.tsx` - Practice player (main feature)
7. `scripts/verify-parser.mjs` - Parser validation test
8. `scripts/test-parser.mjs` - Alternative test approach
9. `ARTICLE_SHADOWING_IMPLEMENTATION.md` - This file
10. `/opt/cursor/artifacts/lingotube-shadow.tar.gz` - Full repo tarball

### Modified Files (4)
1. `src/App.tsx` - Added routes and nav item
2. `src/lib/db.ts` - Added articles table (v3 schema)
3. `src/lib/types.ts` - Added ArticleScript types
4. `deploy/worker.js` - Rebuilt (auto-generated)

## 🗄️ Database Schema

**New Table** (v3):
```typescript
articles: '++id, createdAt'

interface ArticleScript {
  id?: number
  title: string
  level?: string
  parts: ArticlePart[]
  createdAt: number
}

interface ArticlePart {
  title: string // e.g., "Brunch & Dim Sum (早午餐吃點心)"
  sentences: ArticleSentence[]
}

interface ArticleSentence {
  chunks: ArticleChunk[]
  attempts: number
  bestScore: number
  lastPractised?: number
}

interface ArticleChunk {
  text: string
  stressed: boolean // from **bold** markers
}
```

**Integration with Existing SRS**:
- Low-scoring sentences (<70%) auto-added to `sentences` table
- Tagged with `videoId: "article-${articleId}"`
- Appears in 複習 (Review) flashcard system
- Uses existing SRS algorithm (SM-2 variant)

## 🎨 UI Components & UX

**Traditional Chinese Labels**:
- 文章跟讀 (Article Shadowing) - main feature name
- 新增文章 (New Article)
- 已練習 (Practiced)
- 最佳 (Best)
- 重複 (Repeat)
- 停頓 (Pause)
- 錄音跟讀 (Record & Shadow)
- 對比播放 (Compare Playback)
- 辨識結果 (Recognition Result)

**Mobile-First Design**:
- Responsive grid (1 column mobile, 2 column desktop)
- Touch-friendly buttons and controls
- Bottom nav expands from 5 to 6 items
- Cards with clear visual hierarchy
- Progress bars with percentages

**Visual Feedback**:
- Current chunk highlighted during playback (blue background)
- Stressed words in amber/gold color
- Score color-coding (green/amber/red)
- Progress bars (part and overall)
- Attempt counters and timestamps

## 🔧 Technical Details

### Parser Algorithm

```typescript
parseFormattedScript(text: string) {
  1. Split by newlines
  2. Detect Part headings (regex: ^#+\s*Part\s+\d+[:\s]*(.*)$)
  3. For each line:
     - Split by "/" to get chunks
     - Extract **stress** patterns (multi-word aware)
     - Build ArticleChunk[] with stress flags
  4. Group sentences under current Part
  5. Return { parts: ArticlePart[] }
}
```

### TTS Playback Flow

```
1. User clicks "播放"
2. For each chunk in sentence:
   a. Highlight chunk (visual feedback)
   b. Create SpeechSynthesisUtterance
   c. Set rate, voice, text
   d. Speak with speechSynthesis.speak()
   e. Wait for onend callback
   f. Pause (chunkPause ms)
3. After sentence complete:
   - Pause 800ms
   - Check repeat count
   - Loop or finish
```

### Recording & Scoring Flow

```
1. User clicks "錄音跟讀"
2. Request mic permission (getUserMedia)
3. Start MediaRecorder + SpeechRecognition
4. User speaks
5. User clicks "停止錄音"
6. MediaRecorder saves Blob
7. SpeechRecognition returns transcript
8. Calculate Levenshtein score
9. Update UI: show transcript, score, progress
10. Update article stats in IndexedDB
11. If score < 70%, add to SRS sentences
```

### Levenshtein Scoring

```typescript
function calculateScore(target: string, recognized: string): number {
  const distance = levenshtein(target, recognized)
  const maxLen = Math.max(target.length, recognized.length)
  const accuracy = Math.max(0, 1 - distance / maxLen)
  return Math.round(accuracy * 100)
}
```

## 🚀 Usage Examples

### 1. Load Built-in Demo
```
1. Click "文章跟讀" in nav
2. Click "一鍵載入示範" in demo banner
3. Navigate to practice page
4. Select Part 1
5. Click "播放" to hear first sentence
```

### 2. Create Custom Article
```
1. Click "＋ 新增文章"
2. Enter title: "My Daily Routine"
3. Paste plain text or formatted script
4. Click "自動排版" if plain text
5. Click "儲存文章"
6. Practice immediately
```

### 3. Practice with Recording
```
1. Open article, select sentence
2. Click "播放" to hear it
3. Click "錄音跟讀"
4. Speak the sentence
5. Click "停止錄音"
6. View score and transcript
7. Click "對比播放" to compare
8. Navigate with "上一句" / "下一句"
```

## 📊 Statistics

- **Code Added**: ~1,480 lines
- **New Components**: 3 pages + 1 parser module
- **New Routes**: 3 (`/articles`, `/articles/new`, `/articles/:id`)
- **Database Tables**: +1 (articles)
- **Built-in Scripts**: 1 (Brunch & Dim Sum A2)
- **Parser Tests**: Validates 4 parts, 35 sentences, multi-word stress
- **Bundle Size**: +23 kB (462 kB total JS)
- **Worker Size**: +27 kB (571 kB total)

## ✅ Checklist

- ✅ Parse formatted scripts with `/` and `**stress**`
- ✅ Handle curly apostrophes and Unicode
- ✅ Built-in demo (Brunch & Dim Sum A2)
- ✅ One-tap demo loading
- ✅ Parser test validates 4 parts, 35 sentences
- ✅ TTS playback with chunk highlighting
- ✅ Speed control (0.6-1.2×)
- ✅ Repeat options (1/3/5/∞)
- ✅ Configurable chunk pause
- ✅ MediaRecorder for user audio
- ✅ SpeechRecognition for scoring
- ✅ Compare playback (original vs recording)
- ✅ Levenshtein distance scoring (0-100%)
- ✅ Auto-add low scores (<70%) to SRS
- ✅ Progress tracking (attempts, best score)
- ✅ Part and overall progress bars
- ✅ Article list with delete (single & batch)
- ✅ New article with plain/formatted input
- ✅ Auto-format button (AI or fallback)
- ✅ Browser compatibility checks
- ✅ Graceful fallbacks for unsupported features
- ✅ Mobile-friendly responsive UI
- ✅ Traditional Chinese labels throughout
- ✅ Local-first (IndexedDB, no account needed)
- ✅ npm run build passes
- ✅ Worker builds successfully
- ✅ Git commit to main
- ✅ Full repo tarball created

## 🎉 Conclusion

The 文章跟讀 (Article Shadowing) feature is complete and production-ready. It integrates seamlessly with the existing LingoTube ecosystem while adding a powerful new learning mode focused on fluency and pronunciation practice.

**Key Achievements**:
- Real A2 script (Brunch & Dim Sum) built-in
- Chunk-by-chunk TTS with visual feedback
- Recording + recognition + scoring pipeline
- SRS integration for struggling sentences
- Mobile-first, browser-compatible design
- Local-first, no backend required

**Package**: `/opt/cursor/artifacts/lingotube-shadow.tar.gz` (5.5 MB)
