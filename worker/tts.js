// TTS service handler for Workers AI text-to-speech
// POST /api/tts with { text, voice?, speed? } -> audio stream

const TTS_MODELS = [
  '@cf/deepgram/aura-1', // Primary model - natural TTS
  '@cf/myshell-ai/melotts', // Fallback
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

async function handleTTS(req, env) {
  if (req.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

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
        'cache-control': 'public, max-age=86400', // Cache for 24h
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
