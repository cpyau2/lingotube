// STT service handler for Workers AI speech-to-text (Whisper)
// POST /api/stt with audio file (multipart/form-data or raw bytes) -> { text }

const STT_MODELS = [
  '@cf/openai/whisper-large-v3-turbo', // Primary - faster
  '@cf/openai/whisper', // Fallback - standard whisper
]

async function transcribeAudio(env, audioBuffer) {
  let lastErr
  for (const model of STT_MODELS) {
    try {
      const bytes = audioBuffer instanceof Uint8Array ? audioBuffer : new Uint8Array(audioBuffer)
      let input
      if (model.includes('large-v3-turbo')) {
        let bin = ''
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
        input = { audio: btoa(bin), language: 'en', task: 'transcribe' }
      } else {
        input = { audio: Array.from(bytes) }
      }
      const resp = await env.AI.run(model, input)

      // Whisper returns { text: "transcribed text" }
      if (typeof resp?.text === 'string') {
        return resp.text
      }
      
      // Handle alternate response shapes
      if (typeof resp === 'string') {
        return resp
      }
      
      if (resp?.result?.text) {
        return resp.result.text
      }
      
      throw new Error('Invalid STT response format')
    } catch (e) {
      lastErr = e
      console.error(`STT model ${model} failed:`, e.message)
    }
  }
  throw lastErr || new Error('All STT models failed')
}

async function handleSTT(req, env) {
  if (req.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'content-type': 'application/json' } })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    // Accept either raw binary or form-data
    let audioBuffer
    const contentType = req.headers.get('content-type') || ''
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const audioFile = formData.get('audio')
      if (!audioFile || typeof audioFile === "string") {
        return new Response(JSON.stringify({ error: 'Missing audio file' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }
      audioBuffer = await audioFile.arrayBuffer()
    } else {
      // Assume raw audio bytes
      audioBuffer = await req.arrayBuffer()
    }
    
    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return new Response(JSON.stringify({ error: 'Empty audio data' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }
    
    const text = await transcribeAudio(env, audioBuffer)
    
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { 
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    console.error('STT error:', e)
    return new Response(JSON.stringify({ error: e.message || 'STT service error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
