let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!('speechSynthesis' in window)) return Promise.resolve([])
  if (voicesReady) return voicesReady
  voicesReady = new Promise((res) => {
    const v = speechSynthesis.getVoices()
    if (v.length) return res(v)
    const done = () => res(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    setTimeout(done, 1200)
  })
  return voicesReady
}

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

export async function speak(text: string, opts: { rate?: number; lang?: string } = {}) {
  if (!ttsSupported()) return false
  const voices = await loadVoices()
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = opts.lang ?? 'en-US'
  u.rate = opts.rate ?? 0.95
  const pick =
    voices.find((v) => v.lang === u.lang && /google|samantha|natural|enhanced/i.test(v.name)) ||
    voices.find((v) => v.lang === u.lang) ||
    voices.find((v) => v.lang.startsWith('en'))
  if (pick) u.voice = pick
  speechSynthesis.speak(u)
  return true
}

let audioEl: HTMLAudioElement | null = null
/** Prefer a human recording from the dictionary; fall back to TTS. */
export async function pronounce(word: string, audioUrl?: string) {
  if (audioUrl) {
    try {
      audioEl?.pause()
      audioEl = new Audio(audioUrl)
      await audioEl.play()
      return
    } catch { /* fall through */ }
  }
  await speak(word, { rate: 0.85 })
}
