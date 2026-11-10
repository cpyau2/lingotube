#!/usr/bin/env node
// Verify the Brunch & Dim Sum script format is parsed correctly
const BRUNCH_DIMSUM_SCRIPT = `### Part 1: Brunch & Dim Sum (早午餐吃點心)

This morning, / I really wanted to eat **dim sum**, /
so I went out / to eat **brunch**. /
I love dim sum / so **much**, /
but it's hard to find **good** places here. /

So I didn't think / it would be **super** good, /
but it was actually / **pretty** nice! /
I also got **egg tarts**. /
They are one of my **favorite** foods! /
It was **too** sweet, / so I couldn't eat it **all**. /
I took the rest **home** / to eat later. /

### Part 2: Grocery Store & Warm Food (買菜與暖心料理)

After that, / I went to the **supermarket** / to buy some food. /
I really needed **eggs**, /
but they had **none** left! /
So I just bought some **fruit** / and other little things. /

The weather is getting **cold** these days, /
so I wanted some **hot** food. /
I made a hot cheese sandwich / and **tomato soup**. /
My dad always made this for me / when I was a **kid**, /
and it makes me feel **happy** and warm. /

### Part 3: Morning Time & Coffee (早晨時光與咖啡)

I used to **hate** waking up early. /
But now, / I have a simple **morning plan**: /
I make a cup of **coffee**, /
sit down, / and just **relax**. /

Now, / I actually **like** waking up in the morning! /
My life is usually / very **busy**, /
so this helps me feel **quiet** / and stay calm. /
I haven't read a book / for a **long** time, /
so I read a few pages today / with my **coffee**. /

### Part 4: Cleaning the House (做家事放鬆身心)

When I was a kid, / I hated **cleaning** my room / and washing clothes. /
But now I live on my **own**, /
and I actually **enjoy** it. /

Cleaning the house / is a way / to take care of **myself**. /
When my home is **clean**, /
I feel so much **better**. /
That's all for today. / Thanks for watching, / and see you **next time**! /`

function parseSentenceChunks(sentence) {
  const chunks = []
  const parts = sentence.split('/')
  
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    
    const chunkParts = []
    let lastIndex = 0
    const stressRegex = /\*\*(.+?)\*\*/g
    let match
    
    while ((match = stressRegex.exec(trimmed)) !== null) {
      if (match.index > lastIndex) {
        const before = trimmed.slice(lastIndex, match.index).trim()
        if (before) chunkParts.push({ text: before, stressed: false })
      }
      chunkParts.push({ text: match[1], stressed: true })
      lastIndex = match.index + match[0].length
    }
    
    if (lastIndex < trimmed.length) {
      const after = trimmed.slice(lastIndex).trim()
      if (after) chunkParts.push({ text: after, stressed: false })
    }
    
    if (chunkParts.length === 0) {
      chunkParts.push({ text: trimmed, stressed: false })
    }
    
    chunks.push(...chunkParts)
  }
  
  return chunks
}

function parseFormattedScript(text) {
  const lines = text.split('\n')
  const parts = []
  let currentPart = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    
    const partMatch = trimmed.match(/^#+\s*Part\s+\d+[:\s]*(.*?)$/i) || 
                      trimmed.match(/^Part\s+\d+[:\s]*(.*?)$/i)
    
    if (partMatch) {
      if (currentPart) parts.push(currentPart)
      currentPart = {
        title: partMatch[1]?.trim() || trimmed,
        sentences: [],
      }
      continue
    }

    if (currentPart && trimmed) {
      const chunks = parseSentenceChunks(trimmed)
      if (chunks.length > 0) {
        currentPart.sentences.push({
          chunks,
          attempts: 0,
          bestScore: 0,
        })
      }
    }
  }

  if (currentPart) parts.push(currentPart)
  return { parts }
}

console.log('Testing Brunch & Dim Sum A2 script parser...\n')

try {
  const result = parseFormattedScript(BRUNCH_DIMSUM_SCRIPT)
  
  const expected = {
    parts: 4,
    sentences: [10, 9, 9, 7],
    total: 35,
  }
  
  console.log(`✓ Parts: ${result.parts.length} (expected: ${expected.parts})`)
  if (result.parts.length !== expected.parts) {
    throw new Error(`Wrong number of parts`)
  }
  
  const sentenceCounts = result.parts.map(p => p.sentences.length)
  console.log(`✓ Sentences: [${sentenceCounts}] (expected: [${expected.sentences}])`)
  
  for (let i = 0; i < expected.sentences.length; i++) {
    if (sentenceCounts[i] !== expected.sentences[i]) {
      throw new Error(`Part ${i + 1}: expected ${expected.sentences[i]} sentences, got ${sentenceCounts[i]}`)
    }
  }
  
  const total = sentenceCounts.reduce((a, b) => a + b, 0)
  console.log(`✓ Total sentences: ${total} (expected: ${expected.total})`)
  
  // Test stress detection
  const firstSentence = result.parts[0].sentences[0]
  const stressedFirst = firstSentence.chunks.filter(c => c.stressed).map(c => c.text)
  console.log(`✓ Stressed in first sentence: [${stressedFirst.join(', ')}]`)
  
  if (!stressedFirst.includes('dim sum')) {
    throw new Error('"dim sum" not detected as stressed')
  }
  
  // Multi-word stress tests
  const eggTartsSentence = result.parts[0].sentences[6] // Line 7: "I also got **egg tarts**. /"
  const hasEggTarts = eggTartsSentence.chunks.some(c => c.stressed && c.text === 'egg tarts')
  console.log(`✓ Multi-word "egg tarts" detected: ${hasEggTarts}`)
  if (!hasEggTarts) {
    console.log('  Chunks:', eggTartsSentence.chunks.map(c => `"${c.text}" (${c.stressed})`))
    throw new Error('"egg tarts" not detected')
  }
  
  const lastSentence = result.parts[3].sentences[result.parts[3].sentences.length - 1]
  const hasNextTime = lastSentence.chunks.some(c => c.stressed && c.text === 'next time')
  console.log(`✓ Multi-word "next time" detected: ${hasNextTime}`)
  if (!hasNextTime) throw new Error('"next time" not detected')
  
  // Check titles with Chinese
  console.log(`\n✓ Part titles (with Chinese subtitles):`)
  result.parts.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.title}`)
  })
  
  console.log('\n✅ All parser tests passed!')
} catch (e) {
  console.error('\n❌ Test failed:', e.message)
  process.exit(1)
}
