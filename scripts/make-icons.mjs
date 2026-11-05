// Renders public/favicon.svg-based icons to PNG using headless Chrome (playwright-core).
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const exe = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect width="512" height="512" fill="#0f172a"/>
<g transform="translate(256 256) scale(${pad}) translate(-256 -256)">
<rect x="96" y="150" width="320" height="212" rx="52" fill="#f43f5e"/><path d="M226 202v108l92-54z" fill="#fff"/><rect x="132" y="392" width="150" height="16" rx="8" fill="#38bdf8"/><rect x="298" y="392" width="82" height="16" rx="8" fill="#fbbf24"/></g></svg>`
const b = await chromium.launch({ executablePath: exe })
fs.mkdirSync('public/icons', { recursive: true })
for (const [name, size, pad, round] of [['icon-512',512,1,true],['icon-192',192,1,true],['maskable-512',512,0.74,false]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } })
  const r = round ? `border-radius:${size*0.22}px;overflow:hidden;` : ''
  await p.setContent(`<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;${r}">${svg(pad).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</div></body>`)
  await p.screenshot({ path: `public/icons/${name}.png`, omitBackground: true })
}
await b.close()
