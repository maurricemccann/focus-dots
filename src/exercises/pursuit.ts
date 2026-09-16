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

/** ms to wait after each step. Never below 80 — a rebuild is already ~100-300 ms. */
function waitFor(speed: number) { return clamp(420 - speed * 35, 80, 400) }

/**
 * Points advanced per step. Scales gently with speed because the fixed BLE cost
 * per rebuild compresses what the wait alone can express — real step periods run
 * roughly 585 ms at speed 1 to 280 ms at speed 10, only ~2x.
 */
function stride(speed: number) { return 1 + Math.round(speed / 2) }

function create(ctx: ExerciseContext, params: Params): ExerciseInstance {
  const rawPath = String(params.path)
  const path: CurveShape = (PATHS as readonly string[]).includes(rawPath) ? (rawPath as CurveShape) : 'line'
  let speed = clamp(Math.round(Number(params.speed) || 4), 1, 10)
  const durationMs = clamp(Number(params.durationSec) || 60, 20, 300) * 1000
  const dim = clamp(Math.round(Number(params.pathDim) || 1), 1, 4) as 1 | 2 | 3 | 4

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
  let labelNote = ''                    // one-shot label after a speed change
  let inflight: Promise<void> = Promise.resolve()

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

  function label(now: number) {
    const r = remainingSec(now)
    if (labelNote) { const l = `${labelNote} · ${r}s`; labelNote = ''; return l }
    return `follow the dot · ${r}s`
  }

  async function place(now: number) {
    let text: string | undefined
    if (now - lastLabelAt >= LABEL_EVERY_MS) { lastLabelAt = now; text = label(now) }
    inflight = ctx.page.curve(points, index, text, dim)
    await inflight
  }

  return {
    async start() {
      startedAt = ctx.now()
      await place(startedAt)
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
      return waitFor(speed)
    },

    async onInput(input: Input) {
      if (finished || stopped) return
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
      // Let an in-flight move land first so clearTracer sees every row it wrote.
      try { await inflight } catch { /* a failed send is already named on the strip */ }
    },

    result(): ExerciseResult {
      const end = endedAt || (startedAt ? ctx.now() : 0)
      const ranMs = startedAt ? Math.max(0, end - startedAt) : 0
      return {
        exerciseId: def.id,
        completed: finished,
        durationMs: ranMs,
        metrics: { durationSec: Math.round(ranMs / 1000), steps, speed },
        note: `${path} · speed ${speed}`,
      }
    },
  }
}

export const def: ExerciseDef = {
  id: 'pursuit',
  name: 'Smooth Pursuit',
  kind: 'binocular',
  summary: 'Follow a bright ball along a dim path. Head still.',
  instructions() {
    return [
      'Both eyes open. Keep your head still.',
      'Follow the bright ball with your eyes only.',
      'The dim path shows where it goes next.',
      'Stay on it. Do not jump ahead.',
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
  ],
  estimateSeconds(params) { return Number(params.durationSec) || 60 },
  create,
}
