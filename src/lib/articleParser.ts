import type { ArticleChunk, ArticlePart, ArticleScript } from './types'

interface ParsedScript {
  parts: ArticlePart[]
}

// Parse formatted script like "### Part 1: Title (中文)\nText / with **stress** / chunks."
export function parseFormattedScript(text: string): ParsedScript {
  const lines = text.split('\n')
  const parts: ArticlePart[] = []
  let currentPart: ArticlePart | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    
    // Skip empty lines
    if (!trimmed) continue
    
    // Check for Part heading (flexible matching with optional Chinese subtitle)
    // Matches: "### Part 1: Title", "## Part 1 Title", "Part 1: Title (中文)"
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

    // Parse sentence with chunks
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

// Parse a sentence into chunks: "text / with **stress** / marks /" -> chunks
// Handles multi-word stress like "**egg tarts**", "**next time**"
// Ignores trailing "/" with nothing after it
function parseSentenceChunks(sentence: string): ArticleChunk[] {
  const chunks: ArticleChunk[] = []
  const parts = sentence.split('/')
  
  for (const part of parts) {
    const trimmed = part.trim()
    // Skip empty parts (e.g., trailing slash)
    if (!trimmed) continue
    
    // Parse this chunk for **stressed** content
    // Can have multiple stressed sections or none
    const chunkParts: ArticleChunk[] = []
    let remaining = trimmed
    let lastIndex = 0
    
    // Find all **...** patterns
    const stressRegex = /\*\*(.+?)\*\*/g
    let match: RegExpExecArray | null
    
    while ((match = stressRegex.exec(trimmed)) !== null) {
      // Add text before the stressed part
      if (match.index > lastIndex) {
        const before = trimmed.slice(lastIndex, match.index).trim()
        if (before) chunkParts.push({ text: before, stressed: false })
      }
      
      // Add the stressed part
      chunkParts.push({ text: match[1], stressed: true })
      lastIndex = match.index + match[0].length
    }
    
    // Add any remaining text after the last stress
    if (lastIndex < trimmed.length) {
      const after = trimmed.slice(lastIndex).trim()
      if (after) chunkParts.push({ text: after, stressed: false })
    }
    
    // If no stressed parts found, just add the whole chunk
    if (chunkParts.length === 0) {
      chunkParts.push({ text: trimmed, stressed: false })
    }
    
    chunks.push(...chunkParts)
  }
  
  return chunks
}

// Format plain text into shadowing script (deterministic fallback)
export function formatPlainText(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim())
    .map((s) => s.trim())

  if (sentences.length === 0) return text

  // Split into parts (every ~10 sentences or at paragraph breaks)
  const parts: string[][] = []
  let currentPart: string[] = []
  
  for (const sentence of sentences) {
    currentPart.push(sentence)
    if (currentPart.length >= 10 || sentence.includes('\n\n')) {
      parts.push([...currentPart])
      currentPart = []
    }
  }
  if (currentPart.length > 0) parts.push(currentPart)

  // Format each part
  const formatted = parts.map((partSentences, i) => {
    const title = `Part ${i + 1}`
    const sentences = partSentences.map((s) => {
      // Split into chunks (~6 words)
      const words = s.split(/\s+/)
      const chunks: string[] = []
      for (let j = 0; j < words.length; j += 6) {
        chunks.push(words.slice(j, j + 6).join(' '))
      }
      return chunks.join(' / ')
    })
    return `## ${title}\n${sentences.join('\n')}`
  })

  return formatted.join('\n\n')
}

// Format plain text with AI (returns formatted script text)
export async function formatWithAI(text: string, provider: any): Promise<string> {
  try {
    // Call AI to format the text
    const prompt = `Format this English text into a shadowing script with these rules:
1. Split into 3-5 Parts with headings like "## Part 1 Title"
2. Within each part, break sentences into chunks of 5-8 words separated by " / "
3. Mark content words (nouns, verbs, adjectives, adverbs) with **bold** like **important**
4. Keep punctuation and meaning intact

Text:
${text}

Return only the formatted script.`

    const response = await provider.explainSentence(prompt)
    // The AI might return structure, try to extract text
    if (typeof response === 'string') return response
    if (response.translationZh) return text // fallback
    return text
  } catch (e) {
    console.error('AI format error:', e)
    return formatPlainText(text)
  }
}

export function createArticleScript(title: string, formattedText: string, level?: string): ArticleScript {
  const parsed = parseFormattedScript(formattedText)
  return {
    title,
    level,
    parts: parsed.parts,
    createdAt: Date.now(),
  }
}

// Calculate progress for a part
export function calculatePartProgress(part: ArticlePart): number {
  if (part.sentences.length === 0) return 0
  const practiced = part.sentences.filter((s) => s.attempts > 0).length
  return Math.round((practiced / part.sentences.length) * 100)
}

// Calculate progress for entire script
export function calculateScriptProgress(script: ArticleScript): number {
  if (script.parts.length === 0) return 0
  const totalSentences = script.parts.reduce((sum, p) => sum + p.sentences.length, 0)
  if (totalSentences === 0) return 0
  const practiced = script.parts.reduce(
    (sum, p) => sum + p.sentences.filter((s) => s.attempts > 0).length,
    0,
  )
  return Math.round((practiced / totalSentences) * 100)
}
