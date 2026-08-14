import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = join(repositoryRoot, 'assets')
const buildRoot = join(repositoryRoot, 'build')
const logoSource = readFileSync(join(assetsRoot, 'brand', 'deepseek-logo.svg'))
const wordmarkSource = readFileSync(join(assetsRoot, 'brand', 'deepseek-wordmark.svg'))
const shellSource = join(assetsRoot, 'shell', 'deepseek-flow.png')

mkdirSync(buildRoot, { recursive: true })

await generateIcons()
await generateShellArtwork()

console.log('DeepSeek Work assets generated from the pinned official logo and project shell artwork.')

async function generateIcons() {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = await Promise.all(sizes.map(renderIcon))

  writeFileSync(join(buildRoot, 'icon.ico'), await pngToIco(images))
  writeFileSync(join(buildRoot, 'icon.png'), images.at(-1))
  writeFileSync(join(buildRoot, 'tray-icon.png'), await renderIcon(32))
}

async function renderIcon(size) {
  const inset = Math.max(2, Math.round(size * 0.18))
  const logoSize = size - inset * 2
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e9edff"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="${Math.round(size * 0.22)}" fill="url(#surface)" stroke="#cfd7ff"/>
</svg>`)
  const logo = await sharp(logoSource).resize(logoSize, logoSize, { fit: 'contain' }).png().toBuffer()
  return sharp(background)
    .composite([{ input: logo, left: inset, top: inset }])
    .png()
    .toBuffer()
}

async function generateShellArtwork() {
  await sharp(shellSource)
    .resize(1600, 1000, { fit: 'cover', position: 'centre' })
    .webp({ quality: 90, effort: 5 })
    .toFile(join(buildRoot, 'splash-hero.webp'))

  await writeInstallerSidebar('installer-sidebar.bmp', false)
  await writeInstallerSidebar('uninstaller-sidebar.bmp', true)
}

async function writeInstallerSidebar(filename, muted) {
  const width = 164
  const height = 314
  const panel = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.82"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0.18"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#shade)"/>
    <rect x="14" y="18" width="136" height="64" rx="14" fill="#ffffff" fill-opacity="0.88" stroke="#d9dfff"/>
  </svg>`)
  const wordmark = await sharp(Buffer.from(wordmarkSource.toString('utf8').replaceAll('currentColor', '#111827')))
    .resize(116, 26, { fit: 'contain' })
    .png()
    .toBuffer()
  let image = sharp(shellSource)
    .resize(width, height, { fit: 'cover', position: 'right' })
  if (muted) image = image.modulate({ saturation: 0.62, brightness: 0.94 })

  const { data, info } = await image
    .composite([
      { input: panel, left: 0, top: 0 },
      { input: wordmark, left: 24, top: 37 },
    ])
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  writeFileSync(join(buildRoot, filename), encodeBmp(data, info.width, info.height, info.channels))
}

function encodeBmp(rgb, width, height, channels) {
  if (channels !== 3) throw new Error(`Expected three RGB channels, received ${channels}`)
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelBytes = rowSize * height
  const bitmap = Buffer.alloc(54 + pixelBytes)
  bitmap.write('BM', 0)
  bitmap.writeUInt32LE(bitmap.length, 2)
  bitmap.writeUInt32LE(54, 10)
  bitmap.writeUInt32LE(40, 14)
  bitmap.writeInt32LE(width, 18)
  bitmap.writeInt32LE(height, 22)
  bitmap.writeUInt16LE(1, 26)
  bitmap.writeUInt16LE(24, 28)
  bitmap.writeUInt32LE(pixelBytes, 34)
  bitmap.writeInt32LE(2835, 38)
  bitmap.writeInt32LE(2835, 42)

  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (sourceY * width + x) * 3
      const destinationOffset = 54 + y * rowSize + x * 3
      bitmap[destinationOffset] = rgb[sourceOffset + 2]
      bitmap[destinationOffset + 1] = rgb[sourceOffset + 1]
      bitmap[destinationOffset + 2] = rgb[sourceOffset]
    }
  }
  return bitmap
}
