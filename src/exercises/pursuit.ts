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

// ── Pacing ─────────────────────────────────────────────────────────────────
// Set in SWEEP SECONDS — how long the ball takes to travel the path once —
// not an abstract 1-10 dial (founder ruling S280·7a4e).
//
// The dial hid the thing that mattered. Measured against the exercise this was
// built from (See In 3D `LXYkM28SEFc`, red-centroid tracked at 10 fps): their
// straight line sweeps the full width in ~1.0 s and their 2D shapes run
// 2.4-7.2 s per lap. The old default of speed 4 took **9.3 s** for the sweep
// they do in 1.0 s — nine times slower than the research, and nothing in the
// dial's units made that visible. Sweep seconds is the unit the research is
// written in, so a wrong value now looks wrong.
//
// ⚠ The figures that used to live here — "585 ms at speed 1 to 280 ms at speed
// 10" — were NOT measurements. Traced S280·7a4e: written 2026-09-07 (`0933c76`)
// describing a `textContainerUpgrade` ("the fixed BLE cost per upgrade"), which
// is the TRACER layout, one small container per step. The curve layout did not
// exist yet (`0ddc905`, S276) and does a full `rebuildPageContainer` per step.
// They were just `waitFor(speed) + 200`, an assumed flat overhead.

const MIN_STEP_MS = 90   // measured floor: below this the rebuild is the limit, not our wait
const MIN_SWEEP_SEC = 1
const MAX_SWEEP_SEC = 30

/**
 * Points advanced per step.
 *
 * Smaller stride is smoother, so take the SMALLEST stride whose resulting step
 * period still clears the hardware floor. Stride only grows when the requested
 * sweep is faster than the display can actually be redrawn.
 */
function strideFor(sweepSec: number) {
  return Math.max(1, Math.ceil((STEPS * MIN_STEP_MS) / (sweepSec * 1000)))
}

/** The step period that hits `sweepSec` exactly, given that stride. */
function targetStepMs(sweepSec: number, stride: number) {
  return (sweepSec * 1000 * stride) / STEPS
}

/**
 * Legacy `speed` (1-10) → the sweep time it actually produced, so a routine
 * saved before this change keeps the pace its owner chose rather than silently
 * snapping to the new default. Derived from the same formulas the old code used:
 * `stride = 1 + round(speed/2)`, `wait = clamp(420 - speed*35, 80, 400)`.
 */
function legacySweepSec(speed: number): number {
  const s = clamp(Math.round(speed), 1, 10)
  const oldStride = 1 + Math.round(s / 2)
  const oldWait = clamp(420 - s * 35, 80, 400)
  const steps = STEPS / oldStride
  return clamp((steps * (oldWait + 12)) / 1000, MIN_SWEEP_SEC, MAX_SWEEP_SEC)
}

/** p90 of a small sample. Sorting a ~200-entry array once at the end is free. */
function p90(xs: number[]) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]
}

function create(ctx: ExerciseContext, params: Params): ExerciseInstance {
  const rawPath = String(params.path)
  const path: CurveShape = (PATHS as readonly string[]).includes(rawPath) ? (rawPath as CurveShape) : 'line'
  // Legacy routines saved before S280 carry `speed`; honour the pace they chose
  // rather than snapping them to the new default.
  let sweepSec = params.sweepSec !== undefined
    ? clamp(Number(params.sweepSec) || 2, MIN_SWEEP_SEC, MAX_SWEEP_SEC)
    : params.speed !== undefined
      ? legacySweepSec(Number(params.speed))
      : 2
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
  let labelNote = ''                    // one-shot label after a pace change or head cue
  let inflight: Promise<void> = Promise.resolve()
  let lastBlinkAt = 0

  // The wait we ask for is not the step we get — a rebuild costs real time on
  // real hardware, and how much is a property of the glasses, not of us. So
  // learn it from what actually happened and subtract it, or a 2 s sweep on
  // hardware with a 150 ms rebuild would silently take 5 s. Seeded from the
  // simulator's measured ~12 ms; the first few steps correct it.
  // ponytail: a plain EMA, deliberately. A PID here would be a toy.
  let overheadMs = 12
  let lastWaitMs = 0

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
    const s = strideFor(sweepSec)
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
      if (lastStepAt) {
        const observed = landed - lastStepAt
        stepMs.push(observed)
        // observed = wait we took + what the rebuild actually cost.
        overheadMs += 0.25 * (clamp(observed - lastWaitMs, 0, 600) - overheadMs)
      }
      lastStepAt = landed
      lastWaitMs = Math.max(0, targetStepMs(sweepSec, strideFor(sweepSec)) - overheadMs)
      return lastWaitMs
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
      // Multiplicative, because 1s -> 2s is a different exercise while
      // 20s -> 21s is nothing. Up makes it faster (a shorter sweep).
      const raw = input.type === 'up' ? sweepSec / 1.5 : sweepSec * 1.5
      const next = clamp(Math.round(raw * 2) / 2, MIN_SWEEP_SEC, MAX_SWEEP_SEC)
      if (next === sweepSec) return
      sweepSec = next
      labelNote = `sweep ${sweepSec}s`
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
      const avg = stepMs.length ? Math.round(stepMs.reduce((a, b) => a + b, 0) / stepMs.length) : 0
      // What the sweep ACTUALLY took, against what was asked for. This is the
      // whole point of pacing in sweep seconds: the target and the outcome are
      // finally in the same units, so a miss is visible instead of inferred.
      const sweepActual = avg ? Math.round((avg * (STEPS / strideFor(sweepSec))) / 100) / 10 : 0
      return {
        exerciseId: def.id,
        completed: finished,
        durationMs: ranMs,
        metrics: {
          durationSec: Math.round(ranMs / 1000), steps,
          sweepSecTarget: sweepSec, sweepSecActual: sweepActual,
          headStillPct: stillPct, headStillSec: Math.round(stillMs / 1000),
          stepMsAvg: avg, stepMsP90: Math.round(p90(stepMs)),
        },
        note: measured
          ? `${path} · sweep ${sweepActual}s · head still ${stillPct}%`
          : `${path} · sweep ${sweepActual}s · no head-motion data`,
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
      'Swipe up to speed up, down to slow down.',
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
      key: 'sweepSec', label: 'Sweep', type: 'number', default: 2, min: 1, max: 30, step: 0.5, unit: 's',
      help: 'How long the ball takes to travel the path once. The exercise this is built from runs its straight line in about 1s and its shapes in 2-7s. Swipe up to speed up, down to slow down.',
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
