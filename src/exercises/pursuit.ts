// Smooth Pursuit — one bright ball the eyes follow along a dim visible path.
//
// The path is drawn (founder ruling S276·2997, and the See In 3D exercises his
// research pointed at all draw the track the target runs on). It replaces the
// tracer's five invisible rows: with nothing on screen but the dot, the eye has
// no guide to anticipate, which is half of what pursuit training is for.
//
// Curve layout: the path is one dim text container, the ball a bright one, and
// a step is a text-only rebuild — fast, and the path is repainted intact each
// time. See page.ts for why an image path cannot work here.
import { curvePoints, isClosed, type CurvePoint, type CurveShape } from '../glasses/curves'
import {
  clamp,
  type ExerciseContext,
  type ExerciseDef,
  type ExerciseInstance,
  type ExerciseResult,
  type Input,
  type Params,
} from '../engine/types'

const PATHS: readonly CurveShape[] = [
  'line', 'vertical', 'zigzag', 'figure8', 'circle', 'square', 'arc', 'sweep',
]

const STEPS = 96                       // points sampled along the path
const LABEL_EVERY_MS = 2000            // each label change is one more rebuild — cap the churn
const HEAD_CUE_EVERY_MS = 1500         // don't nag on every sample — one cue, then a gap

/** ms to wait after each step. Never below 80 — a rebuild is already ~100-300 ms. */
function waitFor(speed: number) { return clamp(420 - speed * 35, 80, 400) }

/**
 * Points advanced per step. Scales gently with speed because the fixed BLE cost
 * per rebuild compresses what the wait alone can express.
 *
 * ⚠ The figures that used to sit here — "585 ms at speed 1 to 280 ms at speed
 * 10" — were NOT measurements and are removed. Traced S280·7a4e: they arrived
 * 2026-09-07 (`0933c76`) describing a `textContainerUpgrade` ("the fixed BLE
 * cost per upgrade"), which is what the TRACER layout did — one small container
 * upgraded per step. The curve layout did not exist yet (`0ddc905`, S276) and
 * does a full `rebuildPageContainer` per step, a heavier and different call.
 * The numbers were also just `waitFor(speed) + 200`, an assumed flat overhead.
 *
 * So the real step period of THIS layout had never been measured. It is now
 * measured at runtime instead of asserted — see `stepMsAvg`/`stepMsP90` in the
 * result, which come back from whatever hardware actually ran it. That is the
 * number AT2's <=300 ms budget should be judged against.
 */
function stride(speed: number) { return 1 + Math.round(speed / 2) }

/** p90 of a small sample. Sorting a ~200-entry array once at the end is free. */
function p90(xs: number[]) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]
}

function create(ctx: ExerciseContext, params: Params): ExerciseInstance {
  const rawPath = String(params.path)
  const path: CurveShape = (PATHS as readonly string[]).includes(rawPath) ? (rawPath as CurveShape) : 'line'
  let speed = clamp(Math.round(Number(params.speed) || 4), 1, 10)
  const durationMs = clamp(Number(params.durationSec) || 60, 20, 300) * 1000
  const dim = clamp(Math.round(Number(params.pathDim) || 1), 1, 4) as 1 | 2 | 3 | 4
  const blinkMs = clamp(Number(params.blinkEverySec) ?? 20, 0, 120) * 1000   // 0 = off
  const headTol = clamp(Number(params.headTol) || 0.6, 0.2, 3)

  const points: CurvePoint[] = curvePoints(path, STEPS)
  const closed = isClosed(path)

  let index = 0
  let dir: 1 | -1 = 1                   // open paths reverse at the ends
  let steps = 0
  let startedAt = 0
  let endedAt = 0
  let finished = false
  let stopped = false
  let lastLabelAt = -Infinity
  let labelNote = ''                    // one-shot label after a speed change or head cue
  let inflight: Promise<void> = Promise.resolve()
  let lastBlinkAt = 0

  // Head-still, MEASURED rather than asked (AT5). This is the one thing a
  // monitor cannot do: paper and phones can only print "head still" and hope.
  // Sampling is the same shape fixation.ts uses — |x|+|y|+|z| per report — but
  // pursuit also has to *say something* when the head moves, inside ~1s.
  let lastImuAt = 0
  let lastCueAt = -Infinity
  let stillMs = 0
  let measuredMs = 0

  // Wall-clock between one ball move landing and the next. This is the whole of
  // AT2's budget: our wait plus the real cost of the rebuild on real hardware.
  let lastStepAt = 0
  const stepMs: number[] = []

  function advance() {
    const s = stride(speed)
    if (closed) { index = (index + s) % points.length; return }
    // An open path is walked out and back — jumping from the last point to the
    // first would snap the eye across the whole field, which is the opposite of
    // pursuit.
    let next = index + dir * s
    if (next >= points.length - 1) { next = points.length - 1; dir = -1 }
    else if (next <= 0) { next = 0; dir = 1 }
    index = next
  }

  function remainingSec(now: number) {
    return Math.max(0, Math.ceil((startedAt + durationMs - now) / 1000))
  }

  function blinkDue(now: number) { return blinkMs > 0 && now - lastBlinkAt >= blinkMs }

  function label(now: number) {
    const r = remainingSec(now)
    if (labelNote) { const l = `${labelNote} · ${r}s`; labelNote = ''; return l }
    // See In 3D's protocol says it three times in every video: "blink often".
    // Prolonged staring is the failure mode, and the strip is already there.
    if (blinkDue(now)) { lastBlinkAt = now; return `blink · ${r}s` }
    return `follow the dot · ${r}s`
  }

  async function place(now: number) {
    let text: string | undefined
    // A due blink overrides the churn cap, or a 20s cue would land whenever the
    // 2s cap next happened to open.
    if (blinkDue(now) || now - lastLabelAt >= LABEL_EVERY_MS) { lastLabelAt = now; text = label(now) }
    inflight = ctx.page.curve(points, index, text, dim)
    await inflight
  }

  return {
    async start() {
      startedAt = ctx.now()
      lastBlinkAt = startedAt
      await place(startedAt)
      await ctx.imu.start()
    },

    async tick() {
      if (finished || stopped) return 'done'
      const now = ctx.now()
      if (now - startedAt >= durationMs) {
        finished = true
        endedAt = now
        return 'done'
      }
      advance()
      await place(now)
      steps++
      // Timed AFTER the send resolves, so it includes the transport, not just
      // our own wait — the wait alone would measure the constant we chose.
      const landed = ctx.now()
      if (lastStepAt) stepMs.push(landed - lastStepAt)
      lastStepAt = landed
      return waitFor(speed)
    },

    async onInput(input: Input) {
      if (finished || stopped) return
      if (input.type === 'imu') {
        const now = ctx.now()
        const mag = Math.abs(input.x) + Math.abs(input.y) + Math.abs(input.z)
        // Credit the gap BETWEEN reports, not the report — reports arrive ~6/s
        // and counting them would measure sample rate, not time held still.
        if (lastImuAt) {
          const dt = now - lastImuAt
          measuredMs += dt
          if (mag <= headTol) stillMs += dt
        }
        lastImuAt = now
        if (mag > headTol && now - lastCueAt >= HEAD_CUE_EVERY_MS) {
          lastCueAt = now
          labelNote = 'head still'
          lastLabelAt = -Infinity        // the runner ticks right after input; show it then
        }
        return
      }
      if (input.type !== 'up' && input.type !== 'down') return
      const next = clamp(speed + (input.type === 'up' ? 1 : -1), 1, 10)
      if (next === speed) return
      speed = next
      labelNote = `speed ${speed}`
      lastLabelAt = -Infinity          // the runner ticks right after input; show it then
    },

    async stop() {
      if (stopped) return
      stopped = true
      if (!endedAt) endedAt = ctx.now()
      await ctx.imu.stop()
      // Let an in-flight move land first so clearTracer sees every row it wrote.
      try { await inflight } catch { /* a failed send is already named on the strip */ }
    },

    result(): ExerciseResult {
      const end = endedAt || (startedAt ? ctx.now() : 0)
      const ranMs = startedAt ? Math.max(0, end - startedAt) : 0
      // No IMU reports ever arrived — score as unmeasured, never as a clean
      // 100%. Same honesty rule fixation.ts follows.
      const measured = measuredMs > 0
      const stillPct = measured ? Math.round((stillMs / measuredMs) * 100) : 0
      return {
        exerciseId: def.id,
        completed: finished,
        durationMs: ranMs,
        metrics: {
          durationSec: Math.round(ranMs / 1000), steps, speed,
          headStillPct: stillPct, headStillSec: Math.round(stillMs / 1000),
          stepMsAvg: stepMs.length ? Math.round(stepMs.reduce((a, b) => a + b, 0) / stepMs.length) : 0,
          stepMsP90: Math.round(p90(stepMs)),
        },
        note: measured
          ? `${path} · speed ${speed} · head still ${stillPct}%`
          : `${path} · speed ${speed} · no head-motion data`,
      }
    },
  }
}

export const def: ExerciseDef = {
  id: 'pursuit',
  name: 'Smooth Pursuit',
  kind: 'binocular',
  summary: 'Follow a bright ball along a dim path. Head still.',
  // FIVE lines, ASCII only — the instruction screen renders five and a sixth is
  // written but never seen (the same overflow fixation.ts records).
  //
  // Do NOT open with "Both eyes open." — session.ts prepends patchOffCue() for
  // every binocular exercise, so an opener that says it again prints the cue
  // twice. That is AT8's bug in the binocular direction: S279 fixed the
  // monocular half (three exercises hardcoding the patch cue) and this half was
  // left, because reading the code hides it and only the render shows it.
  instructions() {
    return [
      'Keep your head still.',
      'Follow the bright ball with your eyes only.',
      'The dim path shows where it goes next.',
      'The strip says so if your head moves.',
      'Swipe up or down to change speed.',
    ]
  },
  params: [
    {
      key: 'path', label: 'Path', type: 'select', default: 'line',
      options: [
        { value: 'line', label: 'Straight' },
        { value: 'vertical', label: 'Vertical' },
        { value: 'circle', label: 'Circle' },
        { value: 'square', label: 'Square' },
        { value: 'figure8', label: 'Figure 8' },
        { value: 'zigzag', label: 'Zigzag' },
        { value: 'arc', label: 'Arc' },
        { value: 'sweep', label: 'Sweep' },
      ],
      help: 'The path the ball travels, drawn dim on the lens. Start with straight, then circle.',
    },
    {
      key: 'pathDim', label: 'Path brightness', type: 'number', default: 1, min: 1, max: 4, step: 1,
      help: 'How bright the guide path is. 1 is dimmest — the ball should always be the brightest thing on the lens.',
    },
    {
      key: 'speed', label: 'Speed', type: 'number', default: 4, min: 1, max: 10, step: 1,
      help: '1 is slow, 10 is fast. Swipe up or down during the exercise to change it.',
    },
    {
      key: 'durationSec', label: 'Duration', type: 'number', default: 60, min: 20, max: 300, step: 10, unit: 's',
      help: 'How long the dot moves.',
    },
    {
      key: 'blinkEverySec', label: 'Blink cue', type: 'number', default: 20, min: 0, max: 120, step: 5, unit: 's',
      help: 'The strip says "blink" this often. Staring is the failure mode, not moving. 0 turns it off.',
    },
    {
      key: 'headTol', label: 'Head tolerance', type: 'number', default: 0.6, min: 0.2, max: 3, step: 0.2,
      help: 'How much head motion counts as moving. Lower is stricter. Raise it if the strip nags while you are holding still.',
    },
  ],
  estimateSeconds(params) { return Number(params.durationSec) || 60 },
  create,
}
