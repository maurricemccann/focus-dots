// Fixation Hold — hold gaze on one still dot while the runner samples head
// motion via IMU as a steadiness proxy (there is no eye tracking on this
// hardware — BLUEPRINT.md). ctx.imu.start()/stop() brackets the hold; imu
// reports arrive as onInput {type:'imu'} at ~5/s while running.
import { clamp, type ExerciseDef, type ExerciseInstance, type Params } from '../engine/types'

const CX = 288, CY = 128      // centre of the field, clear of the label strip (y >= 260)
const SAMPLE_WINDOW_MS = 1000 // one steadiness sample per second of held gaze

/**
 * A ring with a centre dot, drawn as an image.
 *
 * This used to be `page.dots([{ size: 'small' }])` — a single `·` glyph, which
 * measured **4 lit pixels** on the real framebuffer (S276·2997, simulator
 * capture). On a see-through waveguide that is not a fixation point, it is
 * nothing. BLUEPRINT.md lists fixation under the **image** layout for exactly
 * this reason; the dots layout was the deviation.
 *
 * Fixation is the one exercise where an image costs nothing ongoing: the target
 * never moves, so the 2-8 s send is paid once at start and never again. The
 * per-second countdown rides the label strip, which does not disturb the tiles.
 *
 * The ring is not decoration — a bare dot has no edges to hold once it fades in
 * peripheral drift, and the ring gives the eye a structure to lock back onto.
 */
function drawTarget(c: CanvasRenderingContext2D, px: number) {
  const r = px / 2
  c.fillStyle = '#fff'
  c.strokeStyle = '#fff'
  c.lineWidth = Math.max(2, Math.round(px / 12))
  c.beginPath()
  c.arc(CX, CY, r, 0, Math.PI * 2)
  c.stroke()
  c.beginPath()
  c.arc(CX, CY, Math.max(3, Math.round(px / 8)), 0, Math.PI * 2)
  c.fill()
}

function plan(p: Params) {
  const holdSec = clamp(Number(p.holdSec) || 30, 10, 120)
  const targetPx = clamp(Number(p.targetPx) || 56, 24, 120)
  return { holdMs: holdSec * 1000, targetPx }
}

export const def: ExerciseDef = {
  id: 'fixation',
  name: 'Fixation Hold',
  kind: 'binocular',
  summary: 'Hold your gaze on one still dot. Keep your head as still as the dot.',
  instructions: () => [
    'A ring with a dot, centre.',
    'Look at the dot and hold.',
    'Blink often — do not stare.',
    'Keep your head still — moving your',
    'head is easier than holding your',
    'eyes still, so the drill checks both.',
  ],
  params: [
    { key: 'holdSec', label: 'Hold', type: 'number', default: 30, min: 10, max: 120, step: 10, unit: 's', help: 'Total time to hold fixation.' },
    { key: 'targetPx', label: 'Target size', type: 'number', default: 56, min: 24, max: 120, step: 8, unit: 'px', help: 'Diameter of the ring. Bigger is easier to hold.' },
  ],
  estimateSeconds(p) { return plan(p).holdMs / 1000 },
  create(ctx, params): ExerciseInstance {
    const { holdMs, targetPx } = plan(params)
    let startedAt = 0
    let windowStart = 0
    let windowPeak = 0 // largest |imu| sample seen in the current window
    const samplePeaks: number[] = [] // one entry per completed window
    let stopped = false
    let done = false

    return {
      async start() {
        await ctx.page.image(c => drawTarget(c, targetPx), 'hold · 0s')
        startedAt = ctx.now()
        windowStart = startedAt
        await ctx.imu.start()
      },
      async tick() {
        if (done || stopped) return 'done'
        const elapsed = ctx.now() - startedAt
        if (elapsed >= holdMs) { done = true; return 'done' }
        const left = holdMs - elapsed
        await ctx.page.setLabel(`hold · ${Math.ceil(left / 1000)}s`)
        return Math.min(1000, Math.max(50, left))
      },
      async onInput(input) {
        if (input.type !== 'imu' || done || stopped) return
        const mag = Math.abs(input.x) + Math.abs(input.y) + Math.abs(input.z)
        windowPeak = Math.max(windowPeak, mag)
        if (ctx.now() - windowStart >= SAMPLE_WINDOW_MS) {
          samplePeaks.push(windowPeak)
          windowPeak = 0
          windowStart = ctx.now()
        }
      },
      async stop() {
        stopped = true
        await ctx.imu.stop()
      },
      result() {
        // No motion ever reported (IMU never started in time, or the SDK stayed
        // silent) — score as unmeasured rather than a false 100%.
        const measured = samplePeaks.length > 0
        const avgPeak = measured ? samplePeaks.reduce((a, b) => a + b, 0) / samplePeaks.length : 0
        const steadinessPct = measured ? Math.round(clamp(100 - avgPeak * 20, 0, 100)) : 0
        return {
          exerciseId: 'fixation',
          completed: done,
          durationMs: Math.round(ctx.now() - startedAt),
          metrics: { steadinessPct, samples: samplePeaks.length },
          note: measured ? `steadiness ${steadinessPct}%` : 'no head-motion data received',
        }
      },
    }
  },
}
