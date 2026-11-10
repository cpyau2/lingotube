// Fuzzy word alignment and scoring utilities for speech recognition

// Simplified double metaphone for phonetic matching
// Based on the double metaphone algorithm - simplified for our use case
function metaphone(word: string): string {
  const w = word.toUpperCase()
  let result = ''
  let i = 0
  
  while (i < w.length && result.length < 4) {
    const c = w[i]
    const next = w[i + 1] || ''
    const prev = w[i - 1] || ''
    
    // Skip silent letters at start
    if (i === 0) {
      if (c === 'K' && next === 'N') { i++; continue }
      if (c === 'G' && next === 'N') { i++; continue }
      if (c === 'P' && next === 'N') { i++; continue }
      if (c === 'A' && next === 'E') { i++; continue }
      if (c === 'W' && next === 'R') { i++; continue }
    }
    
    // Consonant clusters
    if (c === 'C') {
      if (next === 'H') { result += 'X'; i += 2; continue }
      if (next === 'K') { result += 'K'; i += 2; continue }
      if ('EIY'.includes(next)) { result += 'S'; i++; continue }
      result += 'K'; i++; continue
    }
    
    if (c === 'G') {
      if (next === 'H') { i += 2; continue }
      if ('EIY'.includes(next)) { result += 'J'; i++; continue }
      result += 'K'; i++; continue
    }
    
    if (c === 'P' && next === 'H') { result += 'F'; i += 2; continue }
    if (c === 'Q') { result += 'K'; i++; continue }
    if (c === 'S' && next === 'H') { result += 'X'; i += 2; continue }
    if (c === 'T' && next === 'H') { result += '0'; i += 2; continue }
    if (c === 'T' && next === 'I' && w[i + 2] === 'O') { result += 'X'; i++; continue }
    if (c === 'X') { result += 'KS'; i++; continue }
    
    // Vowels -> A
    if ('AEIOU'.includes(c)) {
      if (i === 0) result += 'A'
      i++
      continue
    }
    
    // Double letters
    if (c === next) { i++; continue }
    
    // Keep consonants
    if ('BDFHJKLMNPQRSTVWXYZ'.includes(c)) {
      result += c
    }
    i++
  }
  
  return result || 'A'
}

// Normalize text for comparison
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''']/g, "'") // Normalize quotes
    .replace(/["""]/g, '"')
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[.,!?;:—–-]/g, '') // Remove punctuation
    .trim()
}

// Normalize contractions and common spoken forms
export function normalizeContractions(text: string): string {
  const contractions: Record<string, string> = {
    "i'm": "i am",
    "you're": "you are",
    "he's": "he is",
    "she's": "she is",
    "it's": "it is",
    "we're": "we are",
    "they're": "they are",
    "i've": "i have",
    "you've": "you have",
    "we've": "we have",
    "they've": "they have",
    "i'll": "i will",
    "you'll": "you will",
    "he'll": "he will",
    "she'll": "she will",
    "we'll": "we will",
    "they'll": "they will",
    "can't": "cannot",
    "won't": "will not",
    "don't": "do not",
    "doesn't": "does not",
    "didn't": "did not",
    "hasn't": "has not",
    "haven't": "have not",
    "hadn't": "had not",
    "isn't": "is not",
    "aren't": "are not",
    "wasn't": "was not",
    "weren't": "were not",
    "gonna": "going to",
    "wanna": "want to",
    "gotta": "got to",
  }
  
  let result = text
  for (const [contraction, expanded] of Object.entries(contractions)) {
    result = result.replace(new RegExp('\\b' + contraction + '\\b', 'gi'), expanded)
  }
  return result
}

// Convert numbers to words (basic)
export function normalizeNumbers(text: string): string {
  const numbers: Record<string, string> = {
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
    '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
    '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen',
    '15': 'fifteen', '16': 'sixteen', '17': 'seventeen', '18': 'eighteen', '19': 'nineteen',
    '20': 'twenty', '30': 'thirty', '40': 'forty', '50': 'fifty',
  }
  
  return text.replace(/\b\d+\b/g, (match) => numbers[match] || match)
}

// Full normalization pipeline
export function normalizeForComparison(text: string): string {
  return normalizeNumbers(
    normalizeContractions(
      normalizeText(text)
    )
  )
}

// Check if two words are phonetically similar
export function arePhoneticallySimilar(word1: string, word2: string): boolean {
  const m1 = metaphone(word1)
  const m2 = metaphone(word2)
  return m1 === m2
}

// Levenshtein distance
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1
      }
    }
  }
  return dp[m][n]
}

// Word match type
export type WordMatch = 'correct' | 'close' | 'missing'

// Word alignment result
export interface WordAlignment {
  targetWord: string
  recognizedWord: string | null
  match: WordMatch
}

// Align recognized words to target words with fuzzy matching
export function alignWords(target: string, recognized: string): WordAlignment[] {
  const targetWords = normalizeForComparison(target).split(/\s+/).filter(Boolean)
  const recognizedWords = normalizeForComparison(recognized).split(/\s+/).filter(Boolean)
  
  const alignments: WordAlignment[] = []
  const used = new Set<number>()
  
  // First pass: exact matches
  for (let i = 0; i < targetWords.length; i++) {
    const tw = targetWords[i]
    let bestMatch = -1
    
    // Look for exact match
    for (let j = 0; j < recognizedWords.length; j++) {
      if (used.has(j)) continue
      if (recognizedWords[j] === tw) {
        bestMatch = j
        break
      }
    }
    
    if (bestMatch >= 0) {
      alignments.push({
        targetWord: tw,
        recognizedWord: recognizedWords[bestMatch],
        match: 'correct',
      })
      used.add(bestMatch)
    } else {
      alignments.push({
        targetWord: tw,
        recognizedWord: null,
        match: 'missing',
      })
    }
  }
  
  // Second pass: fuzzy matches for missing words
  for (let i = 0; i < alignments.length; i++) {
    if (alignments[i].match !== 'missing') continue
    
    const tw = targetWords[i]
    let bestMatch = -1
    let bestScore = Infinity
    
    for (let j = 0; j < recognizedWords.length; j++) {
      if (used.has(j)) continue
      
      const rw = recognizedWords[j]
      
      // Phonetic match
      if (arePhoneticallySimilar(tw, rw)) {
        bestMatch = j
        break
      }
      
      // Levenshtein distance (allow up to 2 edits for close match)
      const dist = levenshtein(tw, rw)
      if (dist <= 2 && dist < bestScore) {
        bestScore = dist
        bestMatch = j
      }
    }
    
    if (bestMatch >= 0) {
      alignments[i] = {
        targetWord: tw,
        recognizedWord: recognizedWords[bestMatch],
        match: 'close',
      }
      used.add(bestMatch)
    }
  }
  
  return alignments
}

// Calculate overall score from alignment
export interface ScoringResult {
  score: number
  correct: number
  close: number
  missing: number
  total: number
  alignments: WordAlignment[]
}

export function calculateDetailedScore(target: string, recognized: string): ScoringResult {
  const alignments = alignWords(target, recognized)
  
  let correct = 0
  let close = 0
  let missing = 0
  
  for (const a of alignments) {
    if (a.match === 'correct') correct++
    else if (a.match === 'close') close++
    else missing++
  }
  
  const total = alignments.length
  
  // Scoring: correct = 100%, close = 70%, missing = 0%
  const rawScore = total > 0 ? ((correct * 100 + close * 70) / (total * 100)) * 100 : 0
  const score = Math.round(Math.max(0, Math.min(100, rawScore)))
  
  return {
    score,
    correct,
    close,
    missing,
    total,
    alignments,
  }
}
