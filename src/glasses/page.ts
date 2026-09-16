// Owns the page on the lenses: four layouts, fixed container IDs and z-order
// (BLUEPRINT.md), and the only implementation of PageApi. Exercises call
// page.* and never see the SDK.
import {
  TextContainerProperty,
  ImageContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ImageRawDataUpdate,
  TextContainerUpgrade,
  MenuContainerProperty,
  MenuItemProperty,
} from '@evenrealities/even_hub_sdk'
import { bridge, serial, sleep } from './bridge'
import {
  SCREEN_W, SCREEN_H, TILE_W, TILE_H, TILES,
  render, tilePixels, previewClear, previewTile, previewText, previewDot,
} from './canvas'
import { glyphLevels } from './glyph-screen'
import type { Dot, PageApi } from '../engine/types'

type Layout = 'text' | 'dots' | 'tracer' | 'image' | 'curve'

const LABEL_H = 28
const LABEL_Y = SCREEN_H - LABEL_H            // 260
const ROWS = 5
const ROW_H = 40
const ROW_GAP = 6
const ROW_Y0 = 20                             // rows at y = 20, 66, 112, 158, 204 — all above the label strip
const TRACER_COLS = 96                        // spaces across 576 px in the firmware font, as curve-hero measured
const DOT_BOX = 40
const GLYPH: Record<Dot['size'], string> = { large: '●', medium: 'o', small: '·' }

let layout: Layout | null = null
let created = false
let menu: MenuItemProperty[] = []
let labelText = ''
let brightness: 1 | 2 | 3 | 4 = 4
let tracerRow = -1
let tracerCols = new Array<string>(ROWS).fill(' ')

export function setMenu(items: { itemID: number; itemName: string }[]) {
  menu = items.map(m => new MenuItemProperty(m))
}
export function setBrightness(b: 1 | 2 | 3 | 4) { brightness = b }

function eventLayer(content: string) {
  return new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: SCREEN_W, height: SCREEN_H,
    borderWidth: 0, borderColor: 0, paddingLength: 16,
    containerID: 1, containerName: 'event', content,
    isEventCapture: 1, zOrderIndex: 1, textColor: brightness,
  })
}
function labelLayer() {
  return new TextContainerProperty({
    xPosition: 0, yPosition: LABEL_Y, width: SCREEN_W, height: LABEL_H,
    borderWidth: 0, borderColor: 0, paddingLength: 4,
    containerID: 6, containerName: 'label', content: labelText || ' ',
    isEventCapture: 0, zOrderIndex: 6, textColor: Math.max(1, brightness - 1) as 1 | 2 | 3 | 4,
  })
}
function dotLayers(dots: Dot[]) {
  return dots.slice(0, 6).map((d, i) => new TextContainerProperty({
    xPosition: Math.round(Math.min(SCREEN_W - DOT_BOX, Math.max(0, d.x - DOT_BOX / 2))),
    yPosition: Math.round(Math.min(LABEL_Y - DOT_BOX, Math.max(0, d.y - DOT_BOX / 2))),
    width: DOT_BOX, height: DOT_BOX,
    borderWidth: 0, borderColor: 0, paddingLength: 0,
    containerID: 7 + i, containerName: `d${i + 1}`, content: GLYPH[d.size],
    isEventCapture: 0, zOrderIndex: 7 + i, textColor: d.bright ?? brightness,
  }))
}
// ── Curve layout ───────────────────────────────────────────────────────────
// A dim path with a bright ball on it (founder, S276·2997).
//
// The path is text, not an image, and that is forced rather than chosen: an
// image costs 2-8 s to send, and moving the ball needs a rebuild, which leaves
// the image containers empty until the tiles are re-sent. So a drawn path plus
// a moving ball is 2-8 s per step — not pursuit. Text rebuilds are fast, and a
// rebuild repaints the whole page, so the path comes back intact every step
// instead of being punched full of holes by the ball's own container.
//
// Dim-vs-bright is per container (textColor 1-4), which is why the path and the
// ball have to be two containers. One string cannot be dim in one place.
//
const CURVE_COLS = 96
const CURVE_ROWS = 9

// These four are MEASURED off real captures, not derived. The firmware font is
// proportional, so a space is NOT SCREEN_W/96 = 6 px: a full-width circle path
// rendered 0 -> 476 px across its 95 columns, giving 5.01 px per space. Rows
// measured 27.25 px apart with the first at y ~ 16.5.
//
// This matters because the ball is positioned in pixels while the path is
// positioned in character cells — if the two disagree, the ball floats off its
// own track. Deriving both from the same measured numbers is what keeps it on.
// Re-measure if the firmware font ever changes; the check is one capture of the
// circle path and its lit extent.
const CURVE_COL_W = 5.011
const CURVE_ROW_H = 26.9
const CURVE_Y0 = 16.5
// The `●` glyph does not sit in the middle of its 40 px container — it renders
// high, so a ball placed at the path's own y lands above the line. Measured:
// path row y=123, ball centre y=113.
const CURVE_BALL_NUDGE = 10

function curveLayer(content: string, color: 1 | 2 | 3 | 4) {
  return new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: SCREEN_W, height: LABEL_Y,
    borderWidth: 0, borderColor: 0, paddingLength: 0,
    containerID: 1, containerName: 'event', content,
    isEventCapture: 1, zOrderIndex: 1, textColor: color,
  })
}

/** Plot the path as `·` on a 96 x 9 character grid. */
function curveGrid(points: { x: number; y: number }[]): string {
  const grid = Array.from({ length: CURVE_ROWS }, () => new Array<string>(CURVE_COLS).fill(' '))
  for (const p of points) {
    const c = Math.max(0, Math.min(CURVE_COLS - 1, Math.round(p.x * (CURVE_COLS - 1))))
    const r = Math.max(0, Math.min(CURVE_ROWS - 1, Math.round(p.y * (CURVE_ROWS - 1))))
    grid[r][c] = '·'
  }
  // Trailing spaces cost content budget (1000 char cap) and render nothing.
  return grid.map(row => row.join('').replace(/\s+$/, '')).join('\n')
}

/** Where the ball sits, in pixels, for a normalised point on the path. */
function curveBallXY(p: { x: number; y: number }) {
  return {
    x: p.x * (CURVE_COLS - 1) * CURVE_COL_W + CURVE_COL_W / 2,
    y: CURVE_Y0 + p.y * (CURVE_ROWS - 1) * CURVE_ROW_H,
  }
}

function rowLayers() {
  return Array.from({ length: ROWS }, (_, i) => new TextContainerProperty({
    xPosition: 0, yPosition: ROW_Y0 + i * (ROW_H + ROW_GAP), width: SCREEN_W, height: ROW_H,
    borderWidth: 0, borderColor: 0, paddingLength: 0,
    containerID: 7 + i, containerName: `r${i + 1}`, content: tracerCols[i],
    isEventCapture: 0, zOrderIndex: 7 + i, textColor: brightness,
  }))
}
const tileLayers = TILES.map((t, i) => new ImageContainerProperty({
  xPosition: t.x, yPosition: t.y, width: TILE_W, height: TILE_H,
  containerID: t.id, containerName: t.name, zOrderIndex: 2 + i,
}))

async function build(next: Layout, textObject: TextContainerProperty[], imageObject: ImageContainerProperty[] = []) {
  const payload = {
    containerTotalNum: textObject.length + imageObject.length,
    textObject,
    imageObject,
    // Omitting menuObject on a rebuild clears the custom menu — it rides every build.
    menuObject: new MenuContainerProperty({ menuItems: menu }),
  }
  if (!created) {
    const r = await serial(() => bridge.createStartUpPageContainer(new CreateStartUpPageContainer(payload)))
    created = true
    console.log('[FocusDots] createStartUpPageContainer', r)
    // Let the page settle before pushing pixels; the first image send failed
    // every time on hardware without this.
    await sleep(1000)
  } else {
    const ok = await serial(() => bridge.rebuildPageContainer(new RebuildPageContainer(payload)))
    if (!ok) console.warn('[FocusDots] rebuildPageContainer returned false for layout', next)
    if (next === 'image') await sleep(300)
  }
  layout = next
}

async function upgrade(containerID: number, containerName: string, content: string, textColor?: number) {
  await serial(() => bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID, containerName, content, contentOffset: 0, contentLength: 0,
    ...(textColor !== undefined ? { textColor } : {}),
  })))
}

async function sendTile(index: number, pixels: number[]): Promise<string> {
  const tile = TILES[index]
  let last = 'no attempt'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await serial(() => bridge.updateImageRawData(new ImageRawDataUpdate({
        containerID: tile.id, containerName: tile.name, imageData: pixels,
      })))
      if (r === 'success') return r
      last = String(r)
    } catch (e: any) {
      last = 'threw ' + (e?.message ?? e)
    }
    await sleep(400)
  }
  return last
}

export const page: PageApi = {
  async text(content, label) {
    if (label !== undefined) labelText = label
    if (layout === 'text') {
      await upgrade(1, 'event', content, brightness)
      if (label !== undefined) await upgrade(6, 'label', labelText || ' ')
    } else {
      await build('text', [eventLayer(content), labelLayer()])
    }
    previewClear()
    previewText(0, 0, SCREEN_W, LABEL_Y, content, brightness)
    previewText(0, LABEL_Y, SCREEN_W, LABEL_H, labelText, brightness, 12)
  },

  async curve(points, ballIndex, label, dim = 1) {
    if (label !== undefined) labelText = label
    const i = ((ballIndex % points.length) + points.length) % points.length
    const { x, y } = curveBallXY(points[i])
    await build('curve', [
      curveLayer(curveGrid(points), dim),
      labelLayer(),
      ...dotLayers([{ x, y: y + CURVE_BALL_NUDGE, size: 'large', bright: 4 }]),
    ])
    previewClear()
    // The path is drawn dim in the preview too, so the phone shows the same
    // hierarchy the lens does rather than a flat, equally-bright version.
    for (const p of points) {
      const q = curveBallXY(p)
      previewDot(q.x, q.y, 'small', dim)
    }
    previewDot(x, y, 'large', 4)
    previewText(0, LABEL_Y, SCREEN_W, LABEL_H, labelText, brightness, 12)
  },

  async dots(dots, label) {
    labelText = label
    await build('dots', [eventLayer(' '), labelLayer(), ...dotLayers(dots)])
    previewClear()
    for (const d of dots.slice(0, 6)) previewDot(d.x, d.y, d.size, d.bright ?? brightness)
    previewText(0, LABEL_Y, SCREEN_W, LABEL_H, labelText, brightness, 12)
  },

  async tracer(row, col, label, mark = '●') {
    row = Math.max(0, Math.min(ROWS - 1, Math.round(row)))
    col = Math.max(0, Math.min(TRACER_COLS - 1, Math.round(col)))
    if (layout !== 'tracer') {
      tracerCols = new Array<string>(ROWS).fill(' ')
      tracerRow = -1
      if (label !== undefined) labelText = label
      await build('tracer', [eventLayer(' '), labelLayer(), ...rowLayers()])
      previewClear()
      previewText(0, LABEL_Y, SCREEN_W, LABEL_H, labelText, brightness, 12)
    } else if (label !== undefined && label !== labelText) {
      labelText = label
      await upgrade(6, 'label', labelText || ' ')
      previewText(0, LABEL_Y, SCREEN_W, LABEL_H, labelText, brightness, 12)
    }
    const content = ' '.repeat(col) + mark
    if (tracerRow !== -1 && tracerRow !== row) {
      tracerCols[tracerRow] = ' '
      await upgrade(7 + tracerRow, `r${tracerRow + 1}`, ' ')
      previewText(0, ROW_Y0 + tracerRow * (ROW_H + ROW_GAP), SCREEN_W, ROW_H, ' ')
    }
    tracerCols[row] = content
    tracerRow = row
    await upgrade(7 + row, `r${row + 1}`, content, brightness)
    previewText(0, ROW_Y0 + row * (ROW_H + ROW_GAP), SCREEN_W, ROW_H, content, brightness, 18)
  },

  async clearTracer() {
    if (layout !== 'tracer') return
    for (let i = 0; i < ROWS; i++) {
      if (tracerCols[i] !== ' ') {
        tracerCols[i] = ' '
        await upgrade(7 + i, `r${i + 1}`, ' ')
      }
    }
    tracerRow = -1
    previewClear()
    previewText(0, LABEL_Y, SCREEN_W, LABEL_H, labelText, brightness, 12)
  },

  async image(draw, label) {
    if (layout !== 'image') {
      labelText = label
      await build('image', [eventLayer(' '), labelLayer()], [...tileLayers])
    } else if (label !== labelText) {
      labelText = label
      await upgrade(6, 'label', labelText || ' ')
    }
    render(draw)
    let result = 'success'
    for (let i = 0; i < TILES.length && result === 'success'; i++) {
      const pixels = tilePixels(i)
      previewTile(i, pixels)
      result = await sendTile(i, pixels)
    }
    previewText(0, LABEL_Y, SCREEN_W, LABEL_H, labelText, brightness, 12)
    if (result !== 'success') {
      // Never blank the only visible thing on a failure — name it on the strip.
      console.warn('[FocusDots] image', result)
      await upgrade(6, 'label', `image ${result}`)
    }
    return result
  },

  async glyph(draw, label) {
    if (layout !== 'image') {
      labelText = label ?? labelText
      await build('image', [eventLayer(' '), labelLayer()], [...tileLayers])
    } else if (label !== undefined && label !== labelText) {
      labelText = label
      await upgrade(6, 'label', labelText || ' ')
    }
    // Glyph rasterises; this slices its levels into our four tiles and sends
    // them through the same serial-owned path every other image uses. Glyph
    // never touches the bridge — see glyph-screen.ts for why that matters.
    const levels = await glyphLevels(draw)
    let result = 'success'
    for (let i = 0; i < TILES.length && result === 'success'; i++) {
      const t = TILES[i]
      const pixels = new Array<number>(TILE_W * TILE_H)
      for (let y = 0; y < TILE_H; y++) {
        const src = (t.y + y) * SCREEN_W + t.x
        const dst = y * TILE_W
        for (let x = 0; x < TILE_W; x++) pixels[dst + x] = levels[src + x]
      }
      previewTile(i, pixels)
      result = await sendTile(i, pixels)
    }
    previewText(0, LABEL_Y, SCREEN_W, LABEL_H, labelText, brightness, 12)
    if (result !== 'success') {
      console.warn('[FocusDots] glyph', result)
      await upgrade(6, 'label', `glyph ${result}`)
    }
    return result
  },

  async setLabel(text) {
    labelText = text
    if (layout === null) return
    await upgrade(6, 'label', text || ' ')
    previewText(0, LABEL_Y, SCREEN_W, LABEL_H, text, brightness, 12)
  },
}

export const pageState = {
  get layout() { return layout },
  get created() { return created },
}
