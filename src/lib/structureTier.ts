import { db } from './db'
import type { SentenceExplanation } from './ai/provider'

export type StructureTier = 'fast' | 'accurate'
export type StructureModel = '70b' | '8b'

export const LS_STRUCTURE_TIER = 'lingotube-structure-tier'

export function normalizeStructureTier(v: unknown): StructureTier {
  return v === 'fast' ? 'fast' : 'accurate'
}

export function loadStructureTier(): StructureTier {
  try {
    return normalizeStructureTier(localStorage.getItem(LS_STRUCTURE_TIER))
  } catch {
    return 'accurate'
  }
}

export function saveStructureTier(tier: StructureTier) {
  try {
    localStorage.setItem(LS_STRUCTURE_TIER, tier)
  } catch { /* private mode / disabled storage */ }
}

export function inferStructureModel(expl: SentenceExplanation | null | undefined): StructureModel | undefined {
  if (!expl) return undefined
  if (expl.model === '70b' || expl.model === '8b') return expl.model
  if (expl.degraded) return '8b'
  // Legacy struct:v2 entries were produced by the 70B-first path.
  // A result with no model and no degraded flag is treated as 70B.
  if (expl.overview || (expl.components && expl.components.length)) return '70b'
  return undefined
}

export function structureModelLabel(model?: StructureModel): string {
  if (model === '70b') return '70B 精準'
  if (model === '8b') return '8B 慳額度'
  return ''
}

function cacheKey(model: StructureModel, sentence: string) {
  return `struct:v3:${model}:${sentence}`
}

async function migrateV2(sentence: string): Promise<SentenceExplanation | null> {
  const row = await db.kv.get(`struct:v2:${sentence}`)
  if (!row?.value) return null
  const expl = row.value as SentenceExplanation
  const model: StructureModel = expl.degraded ? '8b' : '70b'
  const stored = { ...expl, model }
  await db.kv.put({ key: cacheKey(model, sentence), value: stored })
  return stored
}

/** Prefer a cached 70B result in either mode; an 8B cache may only satisfy 慳額度. */
export async function readStructureCache(sentence: string, tier: StructureTier): Promise<SentenceExplanation | null> {
  const hit70 = await db.kv.get(cacheKey('70b', sentence))
  if (hit70?.value) return hit70.value as SentenceExplanation
  const migrated = await migrateV2(sentence)
  if (migrated?.model === '70b') return migrated
  if (tier === 'fast') {
    const hit8 = await db.kv.get(cacheKey('8b', sentence))
    if (hit8?.value) return hit8.value as SentenceExplanation
    if (migrated?.model === '8b') return migrated
  }
  return null
}

export async function writeStructureCache(sentence: string, result: SentenceExplanation) {
  const model = inferStructureModel(result)
  if (!model) return
  const stored = { ...result, model }
  await db.kv.put({ key: cacheKey(model, sentence), value: stored })
}
