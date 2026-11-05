// End-to-end smoke test with headless Chrome. Usage: node scripts/e2e.mjs [baseUrl]
import { chromium } from 'playwright-core'
const BASE = process.argv[2] || 'http://localhost:4173'
const exe = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const results = []
const ok = (name, cond, extra = '') => { results.push([cond, name, extra]); console.log(cond ? 'PASS' : 'FAIL', name, extra) }
const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] })

async function run(label, ctxOpts) {
  const ctx = await browser.newContext({ ...ctxOpts, locale: 'zh-HK', serviceWorkers: 'allow' })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  // NOTE: with deviceScaleFactor 2, headless Chrome + a playing cross-origin YouTube iframe drops all input after a screenshot (harness artifact, reproduced with plain DOM listeners), so the phone profile uses DSF 1.
  const shot = async (n) => { await page.screenshot({ path: `screenshots/${label}-${n}.png` }) }

  await page.goto(BASE + '/#/')
  await page.waitForSelector('[data-testid=video-card]')
  ok(`${label}: home shows demo video`, (await page.locator('[data-testid=video-card]').count()) >= 1)
  await shot('1-home')

  await page.click('[data-testid=video-card]')
  await page.waitForSelector('[data-testid=cue]')
  ok(`${label}: 77 cues rendered`, (await page.locator('[data-testid=cue]').count()) === 77)
  await page.waitForFunction(() => document.getElementById('yt-player')?.dataset.status !== 'loading', null, { timeout: 15000 }).catch(() => {})
  const status = await page.getAttribute('#yt-player', 'data-status')
  console.log(`  player status: ${status}`)
  ok(`${label}: player ready or graceful fallback`, ['ready', 'fallback', 'embed-blocked'].includes(status), status)

  // sync: click line 10 -> becomes active, then advances
  await page.locator('[data-idx="10"]').click({ position: { x: 30, y: 10 } })
  await page.waitForTimeout(800)
  const a1 = await page.locator('[data-active=true]').getAttribute('data-idx')
  ok(`${label}: click line seeks & highlights it`, a1 === '10' || a1 === '11', `active=${a1}`)
  await page.waitForTimeout(5500)
  const a2 = await page.locator('[data-active=true]').getAttribute('data-idx').catch(() => null)
  ok(`${label}: subtitles advance with playback`, a2 !== null && Number(a2) > Number(a1), `active ${a1} -> ${a2}`)
  await shot('2-watch')

  // toggles
  await page.click('[data-testid=toggle-showZh]')
  await page.waitForTimeout(150)
  ok(`${label}: 中文 toggle hides Chinese`, (await page.locator('[data-testid=cue] [lang=zh-Hant]').count()) === 0)
  await shot('3-en-only')
  await page.click('[data-testid=toggle-showZh]')
  await page.click('[data-testid=toggle-showEn]')
  await page.waitForTimeout(150)
  ok(`${label}: EN toggle hides English`, (await page.locator('[data-testid=cue] [lang=en]').count()) === 0 && (await page.locator('[data-testid=cue] [lang=zh-Hant]').count()) > 0)
  await page.click('[data-testid=toggle-showEn]')
  // persisted?
  await page.click('[data-testid=toggle-showZh]')
  await page.reload(); await page.waitForSelector('[data-testid=cue]'); await page.waitForTimeout(300)
  ok(`${label}: per-video toggles persist after reload`, (await page.locator('[data-testid=cue] [lang=zh-Hant]').count()) === 0)
  await page.click('[data-testid=toggle-showZh]')

  // word popup
  const word = page.locator('[data-idx="6"] .word', { hasText: 'confidence' }).first()
  await word.click()
  await page.waitForSelector('[data-testid=word-sheet]')
  await page.waitForSelector('[data-testid=word-zh]', { timeout: 8000 }).catch(() => {})
  const zh = await page.locator('[data-testid=word-zh]').textContent().catch(() => null)
  ok(`${label}: word popup shows Chinese meaning`, !!zh, zh ?? '')
  await page.waitForTimeout(1500)
  const defs = await page.locator('[data-testid=word-sheet] .italic').count()
  console.log(`  english definitions shown: ${defs}`)
  await shot('4-word-popup')
  await page.click('[data-testid=speak-word]') // must not throw
  await page.click('[data-testid=save-word]')
  await page.waitForTimeout(300)
  ok(`${label}: save word`, (await page.locator('[data-testid=save-word]').textContent()).includes('已收藏'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  ok(`${label}: saved word is underlined in subtitles`, (await page.locator('.word.saved').count()) >= 1)

  // save sentence
  await page.locator('[data-idx="12"]').hover()
  await page.locator('[data-idx="12"] [data-testid=save-sentence]').click()
  await page.waitForTimeout(300)
  ok(`${label}: save sentence (star filled)`, (await page.locator('[data-idx="12"] [data-testid=save-sentence]').textContent()) === '★')

  // coming-soon stubs
  for (const t of ['structure', 'exercise', 'shadow']) {
    await page.click(`[data-testid=tab-${t}]`)
    ok(`${label}: ${t} tab marked coming soon`, (await page.locator('[data-testid=soon-panel]').count()) === 1)
  }
  await shot('5-soon')
  await page.click('[data-testid=tab-subs]')

  // saved page
  await page.goto(BASE + '/#/saved')
  await page.waitForSelector('[data-testid=word-item]')
  ok(`${label}: saved page lists word`, (await page.locator('[data-testid=word-item]').count()) === 1)
  await shot('6-saved-words')
  await page.click('[data-testid=tab-sentences]')
  ok(`${label}: saved page lists sentence`, (await page.locator('[data-testid=sentence-item]').count()) === 1)
  await shot('7-saved-sentences')

  // review
  await page.goto(BASE + '/#/review')
  await page.waitForSelector('[data-testid=review-card]')
  await shot('8-review-front')
  await page.click('[data-testid=reveal]')
  await page.waitForSelector('[data-testid=grade-buttons]')
  await shot('9-review-back')
  await page.click('[data-testid=grade-2]')
  await page.waitForTimeout(200)
  await page.click('[data-testid=reveal]')
  await page.click('[data-testid=grade-3]')
  await page.waitForSelector('[data-testid=review-done]')
  ok(`${label}: review flow completes (2 cards graded)`, true)
  await shot('10-review-done')
  await page.reload(); await page.waitForSelector('[data-testid=review-done]')
  ok(`${label}: graded cards are no longer due (SRS scheduled)`, true)

  // settings + topics
  await page.goto(BASE + '/#/settings'); await page.waitForSelector('[data-testid=ai-settings]'); await shot('11-settings')
  await page.goto(BASE + '/#/topics'); await page.waitForSelector('[data-testid=soon-panel]'); await shot('12-topics')

  // PWA checks
  const pwa = await page.evaluate(async () => {
    const m = await (await fetch('/manifest.webmanifest')).json()
    const reg = await navigator.serviceWorker.getRegistration()
    return { name: m.name, icons: m.icons.length, display: m.display, sw: !!reg, swActive: !!reg?.active }
  })
  ok(`${label}: manifest + service worker`, pwa.sw && pwa.icons >= 3 && pwa.display === 'standalone', JSON.stringify(pwa))

  // filter benign third-party noise but report everything
  const appErrors = errors.filter((e) => !/youtube|googlevideo|ytimg|doubleclick|google\.com|Permissions policy|ERR_BLOCKED|ERR_FAILED|Failed to load resource|mymemory|dictionaryapi|noembed/i.test(e))
  console.log(`  console errors total=${errors.length}, app-related=${appErrors.length}`)
  errors.forEach((e) => console.log('   ·', e.slice(0, 200)))
  ok(`${label}: no app console errors`, appErrors.length === 0, appErrors.join(' | ').slice(0, 300))
  return ctx
}

const phone = await run('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
const desktop = await run('desktop', { viewport: { width: 1280, height: 800 } })

// offline test (desktop context has SW active)
{
  const page = (desktop.pages())[0]
  await page.goto(BASE + '/#/'); await page.waitForTimeout(1500)
  await desktop.setOffline(true)
  await page.reload()
  await page.waitForSelector('[data-testid=video-card]', { timeout: 8000 }).catch(() => {})
  ok('offline: app shell loads from service worker cache', (await page.locator('[data-testid=video-card]').count()) >= 1)
  await page.click('[data-testid=video-card]')
  await page.waitForSelector('[data-testid=cue]')
  await page.waitForFunction(() => document.getElementById('yt-player')?.dataset.status !== 'loading', null, { timeout: 15000 }).catch(() => {})
  ok('offline: watch page + bilingual subtitles work', (await page.locator('[data-testid=cue]').count()) === 77)
  await page.locator('[data-idx="6"] .word', { hasText: 'confidence' }).first().click()
  await page.waitForSelector('[data-testid=word-zh]', { timeout: 8000 }).catch(() => {})
  ok('offline: bundled gloss gives word meaning', (await page.locator('[data-testid=word-zh]').textContent().catch(() => '')) === '自信')
  await page.screenshot({ path: 'screenshots/desktop-13-offline-word.png' })
  await desktop.setOffline(false)
}

await browser.close()
const failed = results.filter((r) => !r[0])
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
