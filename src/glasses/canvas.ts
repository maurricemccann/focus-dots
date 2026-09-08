// Draw surface for image stimuli + the phone-side preview.
//
// Stimuli are drawn at 1:1 (576x288) — no supersampling, so a grating or an
// acuity target lands on the exact pixels it was drawn on. Quantisation is a
// FIXED luminance -> 0-15 map, never adaptive: an adaptive stretch gave the
// four tiles different black points on hardware and the seams showed.
export const SCREEN_W = 576
export const SCREEN_H = 288
export const TILE_W = 288
export const TILE_H = 144
export const TILES = [
  { id: 2, name: 'tl', x: 0, y: 0 },
  { id: 3, name: 'tr', x: TILE_W, y: 0 },
  { id: 4, name: 'bl', x: 0, y: TILE_H },
  { id: 5, name: 'br', x: TILE_W, y: TILE_H },
] as const

const draw = document.createElement('canvas')
draw.width = SCREEN_W
draw.height = SCREEN_H
const drawCtx = draw.getContext('2d', { willReadFrequently: true })!

export function render(fn: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  drawCtx.save()
  drawCtx.globalCompositeOperation = 'source-over'
  drawCtx.fillStyle = '#000'
  drawCtx.fillRect(0, 0, SCREEN_W, SCREEN_H)
  drawCtx.fillStyle = '#fff'
  drawCtx.strokeStyle = '#fff'
  fn(drawCtx, SCREEN_W, SCREEN_H)
  drawCtx.restore()
}

/** Raw 4-bit greyscale for one tile, one entry per pixel, 0-15. */
export function tilePixels(index: number): number[] {
  const tile = TILES[index]
  const { data } = drawCtx.getImageData(tile.x, tile.y, TILE_W, TILE_H)
  const out: number[] = new Array(TILE_W * TILE_H)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    out[p] = Math.max(0, Math.min(15, Math.round((l / 255) * 15)))
  }
  return out
}

/** Map a 0-1 contrast to the nearest of the 16 levels, never below 1 so "faint" is still lit. */
export function level(v: number): string {
  const l = Math.max(0, Math.min(15, Math.round(v * 15)))
  const c = Math.round((l / 15) * 255)
  return `rgb(${c},${c},${c})`
}

// ── Phone preview ──────────────────────────────────────────────────────────
// The app runs in the phone's WebView; the glasses are only a display. The
// preview paints the exact quantised bytes that are sent, in the display green,
// so what the phone shows is what the lenses show — not a smoother render.
const LENS_RGB = [0x29, 0xf0, 0x7a]
let preview: CanvasRenderingContext2D | null = null
function previewCtx(): CanvasRenderingContext2D | null {
  if (preview) return preview
  const el = document.querySelector<HTMLCanvasElement>('#preview')
  preview = el?.getContext('2d') ?? null
  return preview
}
function lensColor(levelOf15: number) {
  const k = Math.max(0, Math.min(15, levelOf15)) / 15
  return `rgb(${Math.round(LENS_RGB[0] * k)},${Math.round(LENS_RGB[1] * k)},${Math.round(LENS_RGB[2] * k)})`
}

export function previewClear() {
  const p = previewCtx(); if (!p) return
  p.fillStyle = '#000'
  p.fillRect(0, 0, SCREEN_W, SCREEN_H)
}

export function previewTile(index: number, pixels: number[]) {
  const p = previewCtx(); if (!p) return
  const tile = TILES[index]
  const img = p.createImageData(TILE_W, TILE_H)
  for (let i = 0, o = 0; i < pixels.length; i++, o += 4) {
    const k = pixels[i] / 15
    img.data[o] = LENS_RGB[0] * k
    img.data[o + 1] = LENS_RGB[1] * k
    img.data[o + 2] = LENS_RGB[2] * k
    img.data[o + 3] = 255
  }
  p.putImageData(img, tile.x, tile.y)
}

/** Approximate: the firmware font is proportional and not ours. Band, position and brightness match; glyph metrics don't. */
export function previewText(x: number, y: number, w: number, h: number, text: string, bright = 4, px = 16) {
  const p = previewCtx(); if (!p) return
  p.fillStyle = '#000'
  p.fillRect(x, y, w, h)
  p.fillStyle = lensColor(Math.round((bright / 4) * 15))
  p.font = `${px}px ui-monospace, monospace`
  p.textBaseline = 'top'
  const lines = text.split('\n')
  const pad = 8
  for (let i = 0; i < lines.length; i++) {
    const ly = y + pad + i * (px + 4)
    if (ly > y + h - px) break
    p.fillText(lines[i], x + pad, ly, w - pad * 2)
  }
}

export function previewDot(x: number, y: number, size: 'small' | 'medium' | 'large', bright = 4) {
  const p = previewCtx(); if (!p) return
  const r = size === 'large' ? 9 : size === 'medium' ? 6 : 3
  p.fillStyle = lensColor(Math.round((bright / 4) * 15))
  p.beginPath()
  p.arc(x, y, r, 0, Math.PI * 2)
  p.fill()
}
