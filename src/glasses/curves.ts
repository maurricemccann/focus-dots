// The paths a pursuit target travels.
//
// Points come back normalised 0-1 in both axes; page.ts maps them onto the lens.
// A path is just an ordered point list, so an exercise's whole job is to walk an
// index along it — which is what keeps the motion cheap enough to be smooth.
//
// The shapes are the See In 3D progression (founder-supplied research,
// S276·2997): a straight track, a ring, a square, a figure-8 — read off the
// video frames, since those videos are silent. The house curves are ours.

export type CurveShape =
  | 'line'
  | 'vertical'
  | 'zigzag'
  | 'circle'
  | 'square'
  | 'figure8'
  | 'arc'
  | 'sweep'

export interface CurvePoint { x: number; y: number }

/** Square perimeter, parameterised 0-1 clockwise from the bottom-left. */
function squareAt(t: number): CurvePoint {
  const p = ((t % 1) + 1) % 1
  const side = Math.floor(p * 4)
  const f = p * 4 - side
  switch (side) {
    case 0: return { x: 0, y: 1 - f }      // left edge, bottom to top
    case 1: return { x: f, y: 0 }          // top edge, left to right
    case 2: return { x: 1, y: f }          // right edge, top to bottom
    default: return { x: 1 - f, y: 1 }     // bottom edge, right to left
  }
}

/** Cubic bezier, the house's own curve primitive. */
function bezier(t: number, p0: CurvePoint, p1: CurvePoint, p2: CurvePoint, p3: CurvePoint): CurvePoint {
  const u = 1 - t
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/**
 * `n` points along `shape`.
 *
 * Closed shapes (circle, square, figure8) come back as a loop the ball can
 * traverse forever. Open shapes (line, arc, sweep) are walked out and back by
 * the caller, so the eye is never yanked from one end to the other.
 */
export function curvePoints(shape: CurveShape, n = 96): CurvePoint[] {
  const out: CurvePoint[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    switch (shape) {
      case 'line':
        out.push({ x: t, y: 0.5 })
        break
      case 'vertical':
        out.push({ x: 0.5, y: t })
        break
      case 'zigzag': {
        // Four diagonal sweeps down the field — the saccadic cousin of the
        // smooth shapes, and the one the reading drills mirror.
        const legs = 4
        const p = t * legs
        const leg = Math.min(legs - 1, Math.floor(p))
        const f = p - leg
        out.push({ x: leg % 2 === 0 ? f : 1 - f, y: leg / (legs - 1) })
        break
      }
      case 'circle': {
        const a = t * Math.PI * 2
        out.push({ x: 0.5 + 0.5 * Math.cos(a), y: 0.5 + 0.5 * Math.sin(a) })
        break
      }
      case 'square':
        out.push(squareAt(t))
        break
      case 'figure8': {
        // Lissajous 1:2 — crosses the midline diagonally, which is the part of
        // the See In 3D set that trains crossing rather than just tracking.
        const a = t * Math.PI * 2
        out.push({ x: 0.5 + 0.5 * Math.sin(a), y: 0.5 + 0.5 * Math.sin(2 * a) / 1 })
        break
      }
      case 'arc':
        // A single swept curve, low and wide — the house's own line.
        out.push(bezier(t, { x: 0, y: 0.85 }, { x: 0.25, y: 0.05 }, { x: 0.75, y: 0.95 }, { x: 1, y: 0.15 }))
        break
      case 'sweep':
        out.push(bezier(t, { x: 0, y: 0.5 }, { x: 0.4, y: 0 }, { x: 0.6, y: 1 }, { x: 1, y: 0.5 }))
        break
    }
  }
  return out
}

/** Closed shapes loop; open ones reverse at the ends rather than jumping back. */
export function isClosed(shape: CurveShape): boolean {
  return shape === 'circle' || shape === 'square' || shape === 'figure8'
}
