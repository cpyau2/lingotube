import { db } from '../db'

/**
 * AI provider abstraction.
 *
 * The UI only ever talks to `AIProvider`. Two implementations ship in M1:
 *  - NoAIProvider: always available; every method reports `unavailable` so the UI can
 *    fall back to bundled/offline behaviour (bundled glosses, imported subtitles, ...).
 *  - OpenAICompatibleProvider: any /v1/chat/completions endpoint (OpenAI, OpenRouter,
 *    Groq, Ollama, LM Studio, ...). Key + base URL are stored locally in IndexedDB only.
 *
 * Wiring into the UI happens in M2 (translation + sentence explanations) and M3
 * (topics + exercises).
 */

export interface SentenceExplanation {
  overview: string // e.g. "【話語標記】 + 【主句】"
  components: {
    roleZh: string
    roleEn: string
    text: string
    meaningZh: string
    notes: (string | { text: string; sub: string[] })[]
  }[]
  highlights: {
    title: string
    detail: string
  }[]
  alternatives: {
    label: string
    en: string
    zh: string
  }[]
  translationZh: string
  /** True when the public demo fell back to a smaller model after the daily 70B cap. */
  degraded?: boolean
  
  // Legacy fields for backward compatibility
  structure?: string
  breakdown?: { text: string; role: string; zh?: string }[]
  grammarNotes?: string[]
}

export interface Exercise {
  type: 'cloze' | 'multiple-choice' | 'translate' | 'order'
  prompt: string
  answer: string
  choices?: string[]
  explanationZh?: string
}

export interface TopicGroup {
  topic: string
  topicZh: string
  itemIds: string[]
}

export interface AIProvider {
  readonly id: string
  readonly label: string
  readonly available: boolean
  translate(lines: string[], target: 'zh-Hant'): Promise<string[]>
  explainSentence(sentence: string): Promise<SentenceExplanation>
  generateExercises(cues: { en: string; zh?: string }[], n: number): Promise<Exercise[]>
  groupTopics(items: { id: string; text: string }[]): Promise<TopicGroup[]>
}

export class AIUnavailableError extends Error {
  constructor() { super('尚未設定 AI 服務（到「設定」輸入 API key）') }
}

export class NoAIProvider implements AIProvider {
  id = 'none'
  label = '未使用 AI（離線模式）'
  available = false
  translate(): Promise<string[]> { return Promise.reject(new AIUnavailableError()) }
  explainSentence(): Promise<SentenceExplanation> { return Promise.reject(new AIUnavailableError()) }
  generateExercises(): Promise<Exercise[]> { return Promise.reject(new AIUnavailableError()) }
  groupTopics(): Promise<TopicGroup[]> { return Promise.reject(new AIUnavailableError()) }
}

export interface AISettings {
  provider: 'none' | 'openai-compatible'
  baseUrl: string
  apiKey: string
  model: string
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'none',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
}

export async function loadAISettings(): Promise<AISettings> {
  const r = await db.kv.get('ai-settings')
  return { ...DEFAULT_AI_SETTINGS, ...((r?.value as Partial<AISettings>) ?? {}) }
}
export async function saveAISettings(s: AISettings) {
  await db.kv.put({ key: 'ai-settings', value: s })
}

export class OpenAICompatibleProvider implements AIProvider {
  id = 'openai-compatible'
  label: string
  available = true
  constructor(private cfg: AISettings) { this.label = `OpenAI 相容（${cfg.model}）` }

  private async chat(system: string, user: string): Promise<string> {
    const r = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    })
    if (!r.ok) throw new Error(`AI 服務錯誤 ${r.status}`)
    const j = await r.json()
    return j.choices?.[0]?.message?.content ?? ''
  }
  private async json<T>(system: string, user: string): Promise<T> {
    const out = await this.chat(system + '\nReply with JSON only, no markdown fences.', user)
    return JSON.parse(out.replace(/^```(?:json)?|```$/gm, '').trim()) as T
  }

  translate(lines: string[]) {
    return this.json<string[]>(
      'Translate each English subtitle line into natural Traditional Chinese (Hong Kong/Taiwan reading). Return a JSON array of strings with exactly the same length and order.',
      JSON.stringify(lines),
    )
  }
  explainSentence(sentence: string) {
    const systemPrompt = `You are an expert English teacher for Traditional Chinese speakers (Cantonese/Taiwanese). Analyze English sentences with extreme depth, covering structure, grammar, colloquial nuances, and spoken English patterns.

Output ONLY valid JSON in this schema:
{
  "overview": "【話語標記】 + 【主句（含定語從句）】 + ...",
  "components": [
    {
      "roleZh": "話語標記",
      "roleEn": "Discourse Marker",
      "text": "So,",
      "meaningZh": "那麼 / 好了",
      "notes": [
        "作用：口語中用來開啟新話題或承上啟下...",
        {"text": "語氣與用法", "sub": ["通常讀作輕微停頓", "沒有實際實義"]}
      ]
    }
  ],
  "highlights": [
    {
      "title": "定語從句省略關係代詞",
      "detail": "the thing I want to do（我想做的事）..."
    }
  ],
  "alternatives": [
    {"label": "更正式", "en": "First of all, I need to...", "zh": "首先，我需要..."}
  ],
  "translationZh": "那麼，我想談的第一件事是非常非常嚴肅的，好嗎？"
}

Few-shot example for "So, the first thing I want to talk about is pretty pretty serious, okay?":
{
  "overview": "【話語標記】 + 【主句（含定語從句）】 + 【確認語氣詞】",
  "components": [
    {"roleZh": "話語標記", "roleEn": "Discourse Marker", "text": "So,", "meaningZh": "那麼 / 好了", "notes": ["作用：口語中用來開啟新話題或承上啟下的連接詞。"]},
    {"roleZh": "主句主語", "roleEn": "Subject", "text": "the first thing [that I want to talk about]", "meaningZh": "我想要談論的第一件事", "notes": ["核心名詞：the first thing（第一件事）。", {"text": "定語從句：(that) I want to talk about 用來修飾前面的 thing。", "sub": ["這裡省略了關係代詞 that 或 which。", "talk about 是固定搭配。"]}]}
  ],
  "highlights": [
    {"title": "定語從句省略關係代詞", "detail": "the thing I want to do（我想做的事）都是極高頻的口語結構。"}
  ],
  "alternatives": [
    {"label": "更正式", "en": "First of all, I need to bring up something quite serious.", "zh": "首先，我需要提一件相當嚴肅的事。"}
  ],
  "translationZh": "那麼，我想談的第一件事是非常非常嚴肅的，好嗎？"
}

Analyze deeply: fixed collocations, omitted words, subject-verb agreement, spoken-English nuances. Use Traditional Chinese (繁體中文) throughout. Never copy placeholder labels from the schema (do not output 子彈點標題 or 嵌套點). Nested note titles must be real linguistic labels.`
    
    return this.json<SentenceExplanation>(systemPrompt, sentence)
  }
  generateExercises(cues: { en: string; zh?: string }[], n: number) {
    return this.json<Exercise[]>(
      `Create ${n} varied practice exercises (cloze, multiple-choice, translate, order) from these subtitle lines. Return JSON array of {type,prompt,answer,choices?,explanationZh?}.`,
      JSON.stringify(cues),
    )
  }
  groupTopics(items: { id: string; text: string }[]) {
    return this.json<TopicGroup[]>(
      'Group the items into 3-8 topics. Return JSON array of {topic, topicZh, itemIds}.',
      JSON.stringify(items),
    )
  }
}

export class WorkersAIProvider implements AIProvider {
  id = 'workers-ai'
  label = 'Cloudflare Workers AI'
  available = true

  private async post(method: string, data: any): Promise<any> {
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, data }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error((j && j.error) || `AI 服務錯誤 ${r.status}`)
    return j
  }

  async translate(lines: string[]): Promise<string[]> {
    return this.post('translate', { lines, target: 'zh-Hant' })
  }

  async explainSentence(sentence: string): Promise<SentenceExplanation> {
    return this.post('explainSentence', { sentence })
  }

  async generateExercises(cues: { en: string; zh?: string }[], n: number): Promise<Exercise[]> {
    return this.post('generateExercises', { cues, n })
  }

  async groupTopics(items: { id: string; text: string }[]): Promise<TopicGroup[]> {
    return this.post('groupTopics', { items })
  }
}

export async function getProvider(): Promise<AIProvider> {
  const s = await loadAISettings()
  if (s.provider === 'openai-compatible' && s.apiKey) return new OpenAICompatibleProvider(s)
  // Try Workers AI as default fallback
  try {
    const test = await fetch('/api/ai', { method: 'HEAD' })
    if (test.ok) return new WorkersAIProvider()
  } catch { /* no Workers AI available */ }
  return new NoAIProvider()
}
