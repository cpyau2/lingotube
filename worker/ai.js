// AI service handler for Workers AI (env.AI binding)
// POST /api/ai with { method, data } -> AI response

const AI_CHAT_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct-fast',
  '@cf/meta/llama-3.1-8b-instruct-fp8',
  '@cf/meta/llama-3.2-3b-instruct',
]

const AI_CHAT_MODELS_STRUCTURE = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast', // Primary for structure
  '@cf/meta/llama-3.1-8b-instruct-fast',
  '@cf/meta/llama-3.1-8b-instruct-fp8',
]

async function chat(env, system, user, maxTokens = 2048) {
  let lastErr
  for (const model of AI_CHAT_MODELS) {
    try {
      const resp = await env.AI.run(model, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
      })
      if (typeof resp === 'string') return resp
      if (typeof resp?.response === 'string') return resp.response
      if (Array.isArray(resp?.response)) {
        return resp.response.map((p) => (typeof p === 'string' ? p : p?.content || p?.text || '')).join('')
      }
      if (typeof resp?.result === 'string') return resp.result
      if (typeof resp?.result?.response === 'string') return resp.result.response
      // last resort: stringify unknown shapes for debugging upstream parse
      const fallback = resp?.response ?? resp?.result ?? resp
      return typeof fallback === 'string' ? fallback : JSON.stringify(fallback ?? '')
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('Workers AI failed')
}

async function jsonChat(env, system, user, maxTokens = 2048, models = AI_CHAT_MODELS) {
  let lastErr
  for (const model of models) {
    try {
      const resp = await env.AI.run(model, {
        messages: [
          { role: 'system', content: system + '\nReply with JSON only, no markdown fences.' },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
      })
      
      let out
      if (typeof resp === 'string') out = resp
      else if (typeof resp?.response === 'string') out = resp.response
      else if (Array.isArray(resp?.response)) {
        out = resp.response.map((p) => (typeof p === 'string' ? p : p?.content || p?.text || '')).join('')
      } else if (typeof resp?.result === 'string') out = resp.result
      else if (typeof resp?.result?.response === 'string') out = resp.result.response
      else {
        const fallback = resp?.response ?? resp?.result ?? resp
        out = typeof fallback === 'string' ? fallback : JSON.stringify(fallback ?? '')
      }
      
      const cleaned = out.replace(/^```(?:json)?|```$/gm, '').trim()
      try {
        return JSON.parse(cleaned)
      } catch (e) {
        // fallback: try to extract JSON from response
        const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
        if (match) {
          try {
            return JSON.parse(match[0])
          } catch {}
        }
        // Try one more time with stricter instruction
        if (models.length > 1 && model === models[0]) {
          console.warn(`${model} returned invalid JSON, trying next model`)
          lastErr = new Error(`${model}: Invalid JSON`)
          continue
        }
        throw new Error('Invalid JSON response from AI')
      }
    } catch (e) {
      lastErr = e
      console.error(`Model ${model} failed:`, e.message)
    }
  }
  throw lastErr || new Error('All AI models failed')
}

async function translate(env, lines, target) {
  return jsonChat(
    env,
    'Translate each English subtitle line into natural Traditional Chinese (Hong Kong/Taiwan reading). Return a JSON array of strings with exactly the same length and order.',
    JSON.stringify(lines),
  )
}

async function explainSentence(env, sentence) {
  const systemPrompt = `You are an expert English teacher for Traditional Chinese speakers (Cantonese/Taiwanese). Analyze English sentences with extreme depth, covering structure, grammar, colloquial nuances, and spoken English patterns.

Output ONLY valid JSON in this schema:
{
  "overview": "【話語標記】 + 【主句（含定語從句）】 + ...",
  "components": [
    {
      "roleZh": "話語標記",
      "roleEn": "Discourse Marker",
      "text": "So,",
      "meaningZh": "那么 / 好了",
      "notes": [
        "作用：口語中用來開啟新話題或承上啟下的連接詞。",
        {"text": "語氣與用法", "sub": ["通常讀作輕微停頓", "沒有實際實義"]}
      ]
    }
  ],
  "highlights": [
    {
      "title": "定語從句省略關系代詞",
      "detail": "the thing I want to do（我想做的事）、the person I want to meet（我想見的人）..."
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
    {"roleZh": "話語標記", "roleEn": "Discourse Marker", "text": "So,", "meaningZh": "那麼 / 好了", "notes": ["作用：口語中用來開啟新話題或承上啟下的連接詞，沒有實際實義，相當於中文裡的「那個……」、「那麼……」。"]},
    {"roleZh": "主句主語", "roleEn": "Subject", "text": "the first thing [that I want to talk about]", "meaningZh": "我想要談論的第一件事", "notes": ["核心名詞：the first thing（第一件事）。", {"text": "定語從句：(that) I want to talk about 用來修飾前面的 thing。", "sub": ["這裡省略了關係代詞 that 或 which（因為它在從句中作介詞 about 的賓語，口語中通常會省略）。", "talk about 是固定搭配，意為「談論某事」。"]}]},
    {"roleZh": "系動詞", "roleEn": "Linking Verb", "text": "is", "meaningZh": "是", "notes": ["因為主語核心詞 the first thing 是單數，所以用 is。"]},
    {"roleZh": "表語", "roleEn": "Predicative", "text": "pretty pretty serious", "meaningZh": "非常非常嚴肅 / 相當嚴重", "notes": ["核心形容詞：serious（嚴肅的、嚴重的）。", "程度副詞：pretty 在口語中作副詞，意思是「相當、很」（相當於 quite 或 very）。", "疊詞用法：連用兩個 pretty（pretty pretty）是純正的口語強調手法，用來加強語氣，表達「真的非常……」，類似於中文的「很嚴重很嚴重」或「非常非常嚴肅」。"]},
    {"roleZh": "句末確認詞", "roleEn": "Tag / Confirmation", "text": ", okay", "meaningZh": "好嗎？/ 明白嗎？", "notes": ["作用：放在句尾通常讀作升調（okay?），用來確認聽眾是否準備好傾聽，或者在心理上給對方打個預防針，提醒對方認真對待接下來的內容。"]}
  ],
  "highlights": [
    {"title": "定語從句省略關係代詞", "detail": "the thing I want to do（我想做的事）、the person I want to meet（我想見的人）都是極高頻的口語結構，直接把「名詞 + 主謂結構」拼在一起即可，無需加 that。"},
    {"title": "副詞疊用表強調", "detail": "在正式寫作中不能寫 pretty pretty，但在日常對話中，重複副詞（如 really really good、very very important）非常自然，能傳遞出說話人的情緒和緊迫感。"}
  ],
  "alternatives": [
    {"label": "更正式", "en": "First of all, I need to bring up something quite serious.", "zh": "首先，我需要提一件相當嚴肅的事。"},
    {"label": "更直接", "en": "Look, the first thing we need to discuss is really serious.", "zh": "聽著，我們需要討論的第一件事真的很嚴重。"}
  ],
  "translationZh": "那麼，我想談的第一件事是非常非常嚴肅的，好嗎？"
}

Analyze deeply: fixed collocations, omitted words, subject-verb agreement, adverb/adjective usage, spoken-English nuances, intonation markers, etc. Use Traditional Chinese (繁體中文) throughout. Never copy placeholder labels from the schema (do not output 子彈點標題, 嵌套點1, 嵌套點2, or "..."). Nested note titles must be real linguistic labels.`

  const use70b = await tryReserveStructure70b(env)
  const models = use70b ? AI_CHAT_MODELS_STRUCTURE : AI_CHAT_MODELS
  const raw = await jsonChat(env, systemPrompt, sentence, 3000, models)
  
  // Normalize and validate response
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid structure response')
  }
  
  if (typeof raw.overview !== 'string') raw.overview = ''
  if (!Array.isArray(raw.components)) raw.components = []
  if (!Array.isArray(raw.highlights)) raw.highlights = []
  if (!Array.isArray(raw.alternatives)) raw.alternatives = []
  if (typeof raw.translationZh !== 'string') raw.translationZh = ''
  
  const PLACEHOLDER_NOTE = /^(子彈點標題|嵌套點[0-9]+|[.]{3}|…)$/
  function sanitizeNotes(notes) {
    if (!Array.isArray(notes)) return []
    const out = []
    for (const n of notes) {
      if (typeof n === 'string') {
        if (!PLACEHOLDER_NOTE.test(n.trim())) out.push(n)
        continue
      }
      if (n && typeof n === 'object') {
        const title = String(n.text || '').trim()
        const sub = (Array.isArray(n.sub) ? n.sub : []).map(String).filter(s => !PLACEHOLDER_NOTE.test(s.trim()))
        if (!title || PLACEHOLDER_NOTE.test(title)) {
          out.push(...sub)
        } else {
          out.push({ text: title, sub })
        }
      }
    }
    return out
  }

  // Validate component structure
  raw.components = raw.components.map(c => ({
    roleZh: String(c.roleZh || ''),
    roleEn: String(c.roleEn || ''),
    text: String(c.text || ''),
    meaningZh: String(c.meaningZh || ''),
    notes: sanitizeNotes(c.notes),
  }))
  
  // Validate highlights
  raw.highlights = raw.highlights.map(h => ({
    title: String(h.title || ''),
    detail: String(h.detail || ''),
  }))
  
  // Validate alternatives
  raw.alternatives = raw.alternatives.map(a => ({
    label: String(a.label || ''),
    en: String(a.en || ''),
    zh: String(a.zh || ''),
  }))
  
  if (!use70b) raw.degraded = true
  return raw
}

async function generateExercises(env, cues, n) {
  return jsonChat(
    env,
    `Create ${n} varied practice exercises (cloze, multiple-choice, translate, order) from these subtitle lines. Return JSON array of {type,prompt,answer,choices?,explanationZh?}.`,
    JSON.stringify(cues),
  )
}

async function groupTopics(env, items) {
  return jsonChat(
    env,
    'Group the items into 3-8 topics. Return JSON array of {topic, topicZh, itemIds}.',
    JSON.stringify(items),
  )
}

async function handleAI(req, env) {
  if (req.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'content-type': 'application/json' } })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const limited = await enforceIpLimit(req, env, 'ai')
  if (limited) return limited

  try {
    const body = await req.json()
    const { method, data } = body

    let result
    switch (method) {
      case 'translate':
        result = await translate(env, data.lines, data.target)
        break
      case 'explainSentence':
        result = await explainSentence(env, data.sentence)
        break
      case 'generateExercises':
        result = await generateExercises(env, data.cues, data.n)
        break
      case 'groupTopics':
        result = await groupTopics(env, data.items)
        break
      default:
        return new Response(JSON.stringify({ error: 'Unknown method' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  } catch (e) {
    console.error('AI error:', e)
    return new Response(JSON.stringify({ error: e.message || 'AI service error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
