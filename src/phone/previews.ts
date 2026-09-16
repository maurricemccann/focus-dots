// Thumbnails of what each exercise actually puts on the lens.
//
// Founder ask S276·2997: "I kinda need a little preview of the exercise next to
// it so we're not going in blind."
//
// Drawn with Glyph, phone-side only — they never touch the bridge, so they cost
// nothing and cannot disturb a run. They are miniatures of the real stimulus
// rather than icons, because an icon of an eye tells you nothing about whether a
// drill shows a shrinking letter or a moving ball.
//
// Glyph's primitives take LOOSE COORDINATES, not point objects:
//   rect(rect, paint) · circle(cx, cy, r, paint) · ring(cx, cy, outer, inner, …)
// The first cut of this file passed { x, y } objects to circle(), which drew
// absolutely nothing and failed silently — the thumbnails rendered blank with
// zero lit pixels rather than throwing. Caught by counting lit pixels in the
// canvas, which is why that check is worth doing on anything drawn.
import { curvePoints, type CurveShape } from '../glasses/curves'

type Draw = (g: any, w: number, h: number) => void

/** A tumbling E — the shape both Acuity and Contrast use. */
function tumblingE(g: any, cx: number, cy: number, px: number, level = 15, dir: 'up' | 'down' = 'up') {
  const s = Math.max(1, Math.round(px / 5))
  const left = Math.round(cx - px / 2)
  const top = Math.round(cy - px / 2)
  g.rect({ x: left, y: dir === 'up' ? top + px - s : top, width: px, height: s }, { fill: level })
  for (const x of [left, left + Math.round((px - s) / 2), left + px - s]) {
    g.rect({ x, y: top, width: s, height: px }, { fill: level })
  }
}

function pathPreview(shape: CurveShape): Draw {
  return (g, w, h) => {
    const pts = curvePoints(shape, 64)
    // Dim guide path, bright ball on it — the same hierarchy the lens shows, so
    // the thumbnail reads as the exercise rather than as decoration.
    for (const p of pts) {
      g.rect({ x: 6 + p.x * (w - 12), y: 6 + p.y * (h - 12), width: 2, height: 2 }, { fill: 4 })
    }
    const b = pts[Math.floor(pts.length * 0.32)]
    g.circle(6 + b.x * (w - 12), 6 + b.y * (h - 12), 5, { fill: 15 })
  }
}

export const PREVIEWS: Record<string, Draw> = {
  pursuit: pathPreview('circle'),

  saccade: (g, w, h) => {
    // Two targets and the jump between them.
    const y = h / 2
    g.circle(w * 0.22, y, 5, { fill: 15 })
    g.circle(w * 0.78, y, 5, { fill: 6 })
    for (let x = w * 0.34; x < w * 0.68; x += 9) {
      g.rect({ x, y: y - 1, width: 4, height: 2 }, { fill: 3 })
    }
  },

  fixation: (g, w, h) => {
    // The real target is a ring with a centre dot; this is it, smaller.
    const r = Math.min(w, h) * 0.3
    g.ring(w / 2, h / 2, r, r - 3, 0, Math.PI * 2, { fill: 15 })
    g.circle(w / 2, h / 2, Math.max(2, r / 4), { fill: 15 })
  },

  freedot: (g, w, h) => {
    // Off-centre, with a crosshair — the point is that YOU choose where.
    const x = w * 0.66, y = h * 0.34
    g.rect({ x: 4, y: y - 0.5, width: w - 8, height: 1 }, { fill: 2 })
    g.rect({ x: x - 0.5, y: 4, width: 1, height: h - 8 }, { fill: 2 })
    g.circle(x, y, 6, { fill: 15 })
  },

  acuity: (g, w, h) => {
    // Shrinking, with crowding bars — the amblyopia-specific deficit.
    tumblingE(g, w * 0.34, h / 2, Math.round(h * 0.46))
    tumblingE(g, w * 0.68, h / 2, Math.round(h * 0.26))
    const cx = w * 0.68, cy = h / 2, p = h * 0.26, gap = p * 0.65
    g.rect({ x: cx - p / 2, y: cy - p / 2 - gap, width: p, height: 2 }, { fill: 9 })
    g.rect({ x: cx - p / 2, y: cy + p / 2 + gap, width: p, height: 2 }, { fill: 9 })
  },

  contrast: (g, w, h) => {
    // The same letter at four real display levels — this drill's whole variable.
    const px = Math.round(h * 0.4)
    ;[15, 9, 5, 2].forEach((lv, i) => tumblingE(g, w * (0.17 + i * 0.22), h / 2, px, lv))
  },

  reading: (g, w, h) => {
    for (let i = 0; i < 4; i++) {
      const y = 9 + i * ((h - 18) / 4)
      g.rect({ x: 8, y, width: (w - 16) * (i === 3 ? 0.55 : 1), height: 3 }, { fill: 12 })
    }
  },

  nearfar: (g, w, h) => {
    // Near big, far small — the vergence swap.
    g.circle(w * 0.3, h / 2, 8, { fill: 15 })
    g.circle(w * 0.72, h / 2, 3, { fill: 7 })
  },

  converge: (g, w, h) => {
    // Two targets closing toward the middle.
    g.circle(w * 0.26, h / 2, 5, { fill: 15 })
    g.circle(w * 0.74, h / 2, 5, { fill: 15 })
    g.rect({ x: w * 0.36, y: h / 2 - 1, width: w * 0.28, height: 2 }, { fill: 3 })
  },

  brock: (g, w, h) => {
    // Beads on a string, running away from the eye.
    const y = h / 2
    g.rect({ x: 6, y: y - 0.5, width: w - 12, height: 1 }, { fill: 5 })
    ;[0.25, 0.5, 0.78].forEach((t, i) => g.circle(6 + t * (w - 12), y, 7 - i * 2, { fill: 15 }))
  },
}

export function previewFor(id: string): Draw | undefined {
  return PREVIEWS[id]
}
