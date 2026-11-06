// AI service handler for Workers AI (env.AI binding)
// POST /api/ai with { method, data } -> AI response

async function chat(env, system, user) {
  const resp = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    max_tokens: 2048,
  })
  return resp.response || ''
}

async function jsonChat(env, system, user) {
  const out = await chat(env, system + '\nReply with JSON only, no markdown fences.', user)
  const cleaned = out.replace(/^```(?:json)?|```$/gm, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    // fallback: try to extract JSON from response
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (match) return JSON.parse(match[0])
    throw new Error('Invalid JSON response from AI')
  }
}

async function translate(env, lines, target) {
  return jsonChat(
    env,
    'Translate each English subtitle line into natural Traditional Chinese (Hong Kong/Taiwan reading). Return a JSON array of strings with exactly the same length and order.',
    JSON.stringify(lines),
  )
}

async function explainSentence(env, sentence) {
  return jsonChat(
    env,
    'You are an English teacher for a Cantonese speaker. Explain the sentence structure. Return JSON {structure, breakdown:[{text,role,zh}], grammarNotes:[string in Traditional Chinese], translationZh}.',
    sentence,
  )
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
