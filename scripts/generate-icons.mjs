// Generates PWA icons at 192x192 and 512x512 using sharp (already a Next.js dep).
// Run: node scripts/generate-icons.mjs

import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

function makeSVG(size) {
  const pad = Math.round(size * 0.14)
  const w = size - pad * 2
  const h = size - pad * 2
  const ox = pad
  const oy = pad

  // Mountain silhouette: two peaks, left smaller, right taller (snow peak shape)
  // All coords relative to ox/oy bounding box
  const baseY = oy + h
  const leftPeakX = ox + w * 0.28
  const leftPeakY = oy + h * 0.38
  const rightPeakX = ox + w * 0.72
  const rightPeakY = oy + h * 0.08
  const saddleX = ox + w * 0.50
  const saddleY = oy + h * 0.52
  const leftBaseX = ox
  const rightBaseX = ox + w

  // Snow cap on right (taller) peak — a small triangle at the tip
  const snowCapH = h * 0.10
  const snowCapW = w * 0.18
  const snowLeftX = rightPeakX - snowCapW / 2
  const snowRightX = rightPeakX + snowCapW / 2
  const snowBaseY = rightPeakY + snowCapH

  const mountain = `M ${leftBaseX},${baseY} L ${leftPeakX},${leftPeakY} L ${saddleX},${saddleY} L ${rightPeakX},${rightPeakY} L ${rightBaseX},${baseY} Z`
  const snowCap = `M ${rightPeakX},${rightPeakY} L ${snowRightX},${snowBaseY} L ${snowLeftX},${snowBaseY} Z`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#FAFAF8" rx="${Math.round(size * 0.18)}"/>
  <path d="${mountain}" fill="#1a4a2a"/>
  <path d="${snowCap}" fill="#FAFAF8"/>
</svg>`
}

for (const size of [192, 512]) {
  const svg = Buffer.from(makeSVG(size))
  await sharp(svg).png().toFile(join(outDir, `icon-${size}x${size}.png`))
  console.log(`✓ icon-${size}x${size}.png`)
}
