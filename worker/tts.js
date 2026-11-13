// TTS service handler with Google Translate TTS proxy + Workers AI fallback
// GET /api/tts?q=...&tl=en -> audio stream (Google TTS proxy)
// POST /api/tts with { text, voice?, speed? } -> audio stream (Workers AI)

const TTS_MODELS = [
  '@cf/deepgram/aura-1', // Fallback 1 - natural TTS
  '@cf/myshell-ai/melotts', // Fallback 2
]

function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function toAudioBytes(resp) {
  if (!resp) throw new Error('Empty TTS response')
  if (resp instanceof Uint8Array) return resp
  if (resp instanceof ArrayBuffer) return new Uint8Array(resp)
  if (typeof ReadableStream !== 'undefined' && resp instanceof ReadableStream) {
    return new Uint8Array(await new Response(resp).arrayBuffer())
  }
  if (resp instanceof Response) return new Uint8Array(await resp.arrayBuffer())
  if (typeof resp === 'string') return b64ToBytes(resp)
  if (resp.audio) return toAudioBytes(resp.audio)
  throw new Error('Invalid TTS response format')
}

const AURA_SPEAKERS = ['luna', 'asteria', 'stella', 'athena', 'hera', 'orion', 'arcas', 'perseus', 'angus', 'orpheus', 'helios', 'zeus']

async function generateTTS(env, text, voice = 'luna', speed = 1.0) {
  let lastErr
  for (const model of TTS_MODELS) {
    try {
      let payload
      if (model === '@cf/deepgram/aura-1') {
        const v = String(voice || '').replace(/^aura-/, '').replace(/-en$/, '')
        payload = { text, speaker: AURA_SPEAKERS.includes(v) ? v : 'luna', encoding: 'mp3' }
      } else {
        payload = { prompt: text, lang: 'en' }
      }
      const resp = await env.AI.run(model, payload)
      const bytes = await toAudioBytes(resp)
      if (!bytes.byteLength) throw new Error('Empty audio')
      return bytes
    } catch (e) {
      lastErr = new Error(model + ': ' + (e && e.message))
      console.error('TTS model failed:', lastErr.message)
    }
  }
  throw lastErr || new Error('All TTS models failed')
}

// Split text at punctuation or spaces for Google TTS 200-char limit
function splitForGoogle(text, maxLen = 200) {
  if (text.length <= maxLen) return [text]
  
  const chunks = []
  let remaining = text
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }
    
    // Try to split at punctuation
    let splitIdx = -1
    const punctuation = ['. ', '! ', '? ', ', ', '; ', ': ']
    for (const p of punctuation) {
      const idx = remaining.lastIndexOf(p, maxLen)
      if (idx > 0 && idx > splitIdx) {
        splitIdx = idx + p.length
      }
    }
    
    // Fallback to space
    if (splitIdx < 0) {
      splitIdx = remaining.lastIndexOf(' ', maxLen)
      if (splitIdx > 0) splitIdx++
    }
    
    // Last resort: hard cut
    if (splitIdx < 0) splitIdx = maxLen
    
    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx)
  }
  
  return chunks
}

// Fetch Google Translate TTS
async function fetchGoogleTTS(text, lang = 'en') {
  const chunks = splitForGoogle(text)
  const parts = []
  
  for (const chunk of chunks) {
    const url = 'https://translate.google.com/translate_tts?' + new URLSearchParams({
      ie: 'UTF-8',
      client: 'tw-ob',
      tl: lang,
      q: chunk,
    })
    
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/',
      },
    })
    
    if (!resp.ok || !resp.headers.get('content-type')?.includes('audio')) {
      throw new Error(`Google TTS failed: ${resp.status}`)
    }
    
    parts.push(new Uint8Array(await resp.arrayBuffer()))
  }
  
  // Concatenate MP3 parts
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0)
  const combined = new Uint8Array(totalLen)
  let offset = 0
  for (const part of parts) {
    combined.set(part, offset)
    offset += part.length
  }
  
  return combined
}

async function handleTTS(req, env) {
  const url = new URL(req.url)
  
  if (req.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
  }

  // GET /api/tts?q=...&tl=en -> Google TTS proxy
  if (req.method === 'GET') {
    const text = url.searchParams.get('q')
    const lang = url.searchParams.get('tl') || 'en'
    
    if (!text) {
      return new Response(JSON.stringify({ error: 'Missing q parameter' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }
    
    try {
      // Try Worker Cache API first
      const cache = caches.default
      const cacheKey = new Request(req.url)
      let cached = await cache.match(cacheKey)
      if (cached) return cached

      const limited = await enforceIpLimit(req, env, 'tts')
      if (limited) return limited
      
      // Fetch from Google
      const audio = await fetchGoogleTTS(text, lang)
      
      const response = new Response(audio, {
        status: 200,
        headers: { 
          'content-type': 'audio/mpeg',
          'cache-control': 'public, max-age=86400',
        },
      })
      
      // Cache it
      await cache.put(cacheKey, response.clone())
      return response
    } catch (e) {
      console.error('Google TTS failed, falling back to Workers AI:', e)
      // Fallback to Workers AI
      try {
        const audio = await generateTTS(env, text, 'luna', 1.0)
        return new Response(audio, {
          status: 200,
          headers: { 
            'content-type': 'audio/mpeg',
            'cache-control': 'public, max-age=86400',
          },
        })
      } catch (e2) {
        console.error('All TTS methods failed:', e2)
        return new Response(JSON.stringify({ error: 'TTS service unavailable' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
    }
  }

  // POST /api/tts -> Workers AI (kept for compatibility)
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const limitedPost = await enforceIpLimit(req, env, 'tts')
  if (limitedPost) return limitedPost

  try {
    const body = await req.json()
    const { text, voice, speed } = body
    
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid text' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }
    
    const audio = await generateTTS(env, text, voice, speed)
    
    return new Response(audio, {
      status: 200,
      headers: { 
        'content-type': 'audio/mpeg',
        'cache-control': 'public, max-age=86400',
      },
    })
  } catch (e) {
    console.error('TTS error:', e)
    return new Response(JSON.stringify({ error: e.message || 'TTS service error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
