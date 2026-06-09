// One-off: rasterize public/favicon.svg into the PNG icons a PWA needs.
// Run via the node container (see the docker run in the build notes); not part
// of the app build. Re-run if the favicon changes.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url))
const dir = new URL('../public/', import.meta.url)

// A maskable icon needs its art inside a safe zone; we render the logo smaller
// on a matching dark background so platforms can crop it to any shape.
const BG = '#0f172a'

async function plain(size, name) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(new URL(name, dir).pathname)
  console.log('wrote', name)
}

async function maskable(size, name, pad = 0.18) {
  const inner = Math.round(size * (1 - pad * 2))
  const logo = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(new URL(name, dir).pathname)
  console.log('wrote', name)
}

await plain(192, 'pwa-192.png')
await plain(512, 'pwa-512.png')
await plain(180, 'apple-touch-icon.png')
await maskable(512, 'pwa-maskable-512.png')
