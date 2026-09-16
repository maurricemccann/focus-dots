// Glyph as a rasterizer, our bridge as the transport.
//
// Glyph (@gabrielevierti/glyph, MIT, zero runtime deps) puts a real 2D drawing
// API in front of the G2's 576x288 / 16-level surface — paths, arcs, gradients,
// measured text, charts — instead of the container primitives the SDK exposes.
// Founder ruling S276·2997: use it for the non-motion UI.
//
// WHAT THIS DELIBERATELY DOES NOT USE: Glyph's own GlyphRuntime, which talks to
// the SDK directly. BLUEPRINT.md's hardest rule is ONE serial owner of every
// bridge call — concurrent sends have crashed the BLE link on real glasses — so
// this takes Glyph's finished pixel levels and hands them to page.ts's existing
// tile sender, which is already inside serial(). Glyph never sees the bridge.
//
// It also does not touch motion. Glyph's own docs say why: "with only four
// containers you cannot buy diffing granularity by making tiles smaller — four
// tiles always cover 165,888 pixels between them." A moving ball still costs a
// whole tile per step, so pursuit stays on text containers. This is for the
// screens that are static or stepped: summaries, instructions, rest, results.
import { GlyphFrame, GlyphRaster, loadFontSet } from '@gabrielevierti/glyph'

let fontPromise: Promise<unknown> | null = null
let font: unknown = null

/** Load the bitmap atlas once. Text falls back to Glyph's own vector path if
 *  this fails, so a missing atlas degrades rather than blanking the screen. */
async function ensureFont() {
  if (font) return font
  if (!fontPromise) {
    fontPromise = loadFontSet('/fonts/inter.json')
      .then(f => { font = f; return f })
      .catch(e => { console.warn('[FocusDots] glyph font atlas unavailable', e); return null })
  }
  return fontPromise
}

/**
 * Draw a screen with Glyph and return its 576x288 levels (0-15), one per pixel
 * — the same shape page.ts's tile sender already speaks.
 *
 * `outline` is Glyph's default surface style and it is the right one here for a
 * reason that is clinical rather than aesthetic: this is a see-through display,
 * every lit pixel is a pixel of the world the wearer cannot see through, and
 * their measurements put outline at roughly a fifth of the lit pixels of filled.
 * On a vision-training app that is the therapy surface, not decoration.
 */
export async function glyphLevels(
  draw: (g: GlyphRaster) => void,
  opts: { brightness?: number; width?: number; height?: number } = {},
): Promise<Uint8Array> {
  await ensureFont()
  const width = opts.width ?? 576
  const height = opts.height ?? 288
  const common = {
    width, height, supersample: 2, surface: 'outline' as const,
    ...(opts.brightness !== undefined ? { brightness: opts.brightness } : {}),
  }

  // A GlyphFrame carries a TILE LAYOUT, and the default quadrants layout is
  // 288x144 tiles — which do not fit anything smaller than the lens. Asking for
  // a 132x66 thumbnail threw "tile t0 falls outside the 132x66 surface" and the
  // canvas came back blank, silently, because the throw was inside an async
  // effect. Anything that is not lens-sized wants the bare raster: same
  // primitives, no tiles, since a thumbnail is never transmitted anywhere.
  if (width !== 576 || height !== 288) {
    const raster = new GlyphRaster(common)
    if (font) {
      try { (raster as any).useFont(font, 'auto') } catch { /* vector fallback */ }
    }
    draw(raster)
    return raster.toLevels()
  }

  const frame = new GlyphFrame(common)
  if (font) {
    try { (frame.raster as any).useFont(font, 'auto') } catch { /* vector fallback */ }
  }
  frame.draw(draw)
  const levels = frame.toLevels()
  frame.dispose()
  return levels
}
