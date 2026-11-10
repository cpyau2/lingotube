// TTS service handler for Workers AI text-to-speech
// POST /api/tts with { text, voice?, speed? } -> audio stream

const TTS_MODELS = [
  '@cf/deepgram/aura-1', // Primary model - natural TTS
  '@cf/myshell-ai/melotts', // Fallback
]

async function generateTTS(env, text, voice = 'aura-1-en', speed = 1.0) {
  let lastErr
  for (const model of TTS_MODELS) {
    try {
      // Workers AI TTS models accept text and optional voice/speed
      const payload = { text }
      
      // Model-specific voice mappings
      if (model === '@cf/deepgram/aura-1') {
        // Deepgram Aura voices: aura-1-en, aura-asteria-en, aura-luna-en, aura-stella-en, aura-athena-en, aura-hera-en, aura-orion-en, aura-arcas-en, aura-perseus-en, aura-angus-en, aura-orpheus-en, aura-helios-en, aura-zeus-en
        payload.voice = voice || 'aura-1-en'
      } else if (model === '@cf/myshell-ai/melotts') {
        // MeloTTS uses language codes
        payload.language = 'en'
      }
      
      // Note: speed control is not universally supported - we'll handle it client-side via playbackRate
      
      const resp = await env.AI.run(model, payload)
      
      // Workers AI TTS returns audio data (Buffer/Uint8Array)
      if (resp instanceof Uint8Array || resp instanceof ArrayBuffer || Buffer.isBuffer(resp)) {
        return resp
      }
      
      // Handle wrapped responses
      if (resp?.audio) {
        return resp.audio
      }
      
      throw new Error('Invalid TTS response format')
    } catch (e) {
      lastErr = e
      console.error(`TTS model ${model} failed:`, e.message)
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
