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
  structure: string // e.g. "Subject + Verb + Object"
  breakdown: { text: string; role: string; zh?: string }[]
  grammarNotes: string[]
  translationZh: string
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
    return this.json<SentenceExplanation>(
      'You are an English teacher for a Cantonese speaker. Explain the sentence structure. Return JSON {structure, breakdown:[{text,role,zh}], grammarNotes:[string in Traditional Chinese], translationZh}.',
      sentence,
    )
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
    if (!r.ok) throw new Error(`AI 服務錯誤 ${r.status}`)
    return r.json()
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
