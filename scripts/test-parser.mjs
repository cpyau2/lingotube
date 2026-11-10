#!/usr/bin/env node
// Simple test for article parser (no framework needed)
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Read and eval the parser code
const parserCode = readFileSync(join(__dirname, '../src/lib/articleParser.ts'), 'utf8')
  .replace(/export /g, '')
  .replace(/import .+?;/g, '')

const typesCode = readFileSync(join(__dirname, '../src/lib/types.ts'), 'utf8')
  .replace(/export /g, '')

// Read demo script
const demoCode = readFileSync(join(__dirname, '../src/data/brunchDimSum.ts'), 'utf8')
  .replace(/export /g, '')

// Create a minimal execution context
const context = {
  console,
  Math,
  Set,
  Array,
  String,
  Number,
  Object,
}

// Eval the code (simple approach for testing)
eval(typesCode)
eval(parserCode)
eval(demoCode)

console.log('Running article parser tests...\n')

try {
  const result = parseFormattedScript(BRUNCH_DIMSUM_SCRIPT)
  
  console.log('✓ Parsed script successfully')
  console.log(`  Parts: ${result.parts.length} (expected: 4)`)
  
  if (result.parts.length !== 4) {
    throw new Error(`Expected 4 parts, got ${result.parts.length}`)
  }
  
  const sentenceCounts = result.parts.map(p => p.sentences.length)
  console.log(`  Sentences per part: [${sentenceCounts.join(', ')}] (expected: [13, 11, 10, 9])`)
  
  const totalSentences = sentenceCounts.reduce((a, b) => a + b, 0)
  console.log(`  Total sentences: ${totalSentences} (expected: 43)`)
  
  if (totalSentences !== 43) {
    throw new Error(`Expected 43 sentences, got ${totalSentences}`)
  }
  
  // Check part titles
  const titles = result.parts.map(p => p.title)
  console.log(`\n  Part titles:`)
  titles.forEach((t, i) => console.log(`    ${i + 1}. ${t}`))
  
  // Check stressed words
  const firstSentence = result.parts[0].sentences[0]
  const stressedInFirst = firstSentence.chunks.filter(c => c.stressed).map(c => c.text)
  console.log(`\n  Stressed in first sentence: [${stressedInFirst.join(', ')}]`)
  
  if (!stressedInFirst.includes('dim sum')) {
    throw new Error('Expected "dim sum" to be stressed in first sentence')
  }
  
  const eggTartsSentence = result.parts[0].sentences[8]
  const hasEggTarts = eggTartsSentence.chunks.some(c => c.stressed && c.text === 'egg tarts')
  console.log(`  ✓ Multi-word stress "egg tarts" detected: ${hasEggTarts}`)
  
  if (!hasEggTarts) {
    throw new Error('Expected "egg tarts" to be detected as stressed multi-word')
  }
  
  const lastSentence = result.parts[3].sentences[result.parts[3].sentences.length - 1]
  const hasNextTime = lastSentence.chunks.some(c => c.stressed && c.text === 'next time')
  console.log(`  ✓ Multi-word stress "next time" detected: ${hasNextTime}`)
  
  if (!hasNextTime) {
    throw new Error('Expected "next time" to be detected as stressed multi-word')
  }
  
  // Check no empty chunks
  let emptyChunks = 0
  for (const part of result.parts) {
    for (const sentence of part.sentences) {
      for (const chunk of sentence.chunks) {
        if (!chunk.text.trim()) emptyChunks++
      }
    }
  }
  console.log(`  ✓ No empty chunks (trailing slashes handled): ${emptyChunks === 0}`)
  
  if (emptyChunks > 0) {
    throw new Error(`Found ${emptyChunks} empty chunks`)
  }
  
  console.log('\n✅ All tests passed!')
} catch (e) {
  console.error('\n❌ Test failed:', e.message)
  process.exit(1)
}
