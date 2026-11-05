// Add-video flow on a phone-size viewport. Usage: node scripts/add-flow.mjs <baseUrl>
import { chromium } from 'playwright-core'
const BASE = process.argv[2] || 'https://lingotube.hackerkurumi.workers.dev'
const DIR = process.env.SHOT_DIR || 'screenshots/deployed'
const results = []
const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x) }
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'zh-HK' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
const shot = (n) => page.screenshot({ path: `${DIR}/phone-addflow-${n}.png` })

await page.goto(BASE + '/#/'); await page.waitForSelector('[data-testid=video-card]')
await page.getByText('＋ 加影片').click()
await page.waitForSelector('[data-testid=add-video]')
ok('add form shows auto-fetch + file import + proxy + paste', (await page.getByText('✨ 自動抓字幕').count()) === 1 && (await page.getByRole('button', { name: '匯入字幕檔' }).count()) === 1 && (await page.getByRole('button', { name: '用本機代理抓字幕' }).count()) === 1 && (await page.locator('[data-testid=paste-en]').count()) === 1)
await shot('1-form')

// file import without choosing a file -> clearer error
await page.fill('[data-testid=add-url]', 'https://youtu.be/jOOFlndsb4s')
await page.getByRole('button', { name: '匯入字幕檔' }).click()
await page.waitForSelector('[data-testid=add-error]')
const e1 = await page.textContent('[data-testid=add-error]')
ok('missing-file error is clear', e1.includes('未揀字幕檔'), e1)
await shot('2-file-error')

// auto fetch (a public YouTube video used to exercise the flow)
await page.click('[data-testid=auto-fetch]')
await page.waitForTimeout(600); await shot('3-progress')
let t0 = Date.now()
await page.waitForURL(/#\/watch\/jOOFlndsb4s/, { timeout: 60000 }).catch(() => {})
const url = page.url()
ok('auto-fetch opens the video', /#\/watch\/jOOFlndsb4s/.test(url), `${Math.round((Date.now() - t0) / 100) / 10}s after progress shot`)
if (!/#\/watch\//.test(url)) { console.log('error text:', await page.textContent('[data-testid=add-error]').catch(() => '?')) }
await page.waitForSelector('[data-testid=cue]', { timeout: 10000 }).catch(() => {})
const n = await page.locator('[data-testid=cue]').count()
const nz = await page.locator('[data-testid=cue] [lang=zh-Hant]').count()
ok('cues rendered (EN)', n > 50, `cues=${n}`)
ok('Chinese lines rendered', nz > 50, `zh=${nz}`)
const title = await page.title(); const h = await page.locator('h1,h2').first().textContent().catch(() => '')
console.log('  heading:', h)
await page.waitForTimeout(2500)
await shot('4-watch')
await page.goto(BASE + '/#/'); await page.waitForSelector('[data-testid=video-card]')
const cards = await page.locator('[data-testid=video-card]').allTextContents()
ok('saved video listed on Home with auto-filled title', cards.some((c) => c.includes('I finally understand how to learn coding')), cards.join(' | ').slice(0, 120))
await shot('5-home-after')

// paste-text fallback (YouTube "Show transcript" style)
await page.getByText('＋ 加影片').click()
await page.fill('[data-testid=add-url]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
await page.fill('[data-testid=paste-en]', '0:00\nWe are no strangers to love\n0:05\nYou know the rules and so do I\n0:11 A full commitment is what I am thinking of\n1:02:03\nYou wouldn\'t get this from any other guy')
await page.click('[data-testid=paste-submit]')
await page.waitForURL(/#\/watch\/dQw4w9WgXcQ/, { timeout: 15000 }).catch(() => {})
await page.waitForSelector('[data-testid=cue]', { timeout: 10000 }).catch(() => {})
ok('paste-text fallback saves 4 cues and opens', (await page.locator('[data-testid=cue]').count()) === 4, `cues=${await page.locator('[data-testid=cue]').count()}`)
await shot('6-paste-watch')

// error: no English track / unavailable id surfaces server message
await page.goto(BASE + '/#/'); await page.getByText('＋ 加影片').click()
await page.fill('[data-testid=add-url]', 'https://youtu.be/aaaaaaaaaaa')
await page.click('[data-testid=auto-fetch]')
await page.waitForSelector('[data-testid=add-error]', { timeout: 30000 })
ok('bad/unavailable video shows Chinese error', (await page.textContent('[data-testid=add-error]')).length > 5, await page.textContent('[data-testid=add-error]'))
await shot('7-error')
const app = errors.filter((e) => !/youtube|googlevideo|ERR_BLOCKED|Failed to load resource|Content Security|net::|ad\b/i.test(e))
console.log('  console errors total', errors.length, 'app-related', app.length, app.slice(0, 3))
ok('no app console errors', app.length === 0)
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`)
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
