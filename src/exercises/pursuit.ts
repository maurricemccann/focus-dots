// Smooth Pursuit — one target the eyes follow smoothly, both eyes open.
// Tracer layout only: moving the dot is a text-container upgrade on one of
// five rows, near-free over Bluetooth, so the target moves every tick.
// Each upgrade still costs ~100-300 ms of BLE time, so the motion is a
// stepped glide, never true animation — small strides keep it smooth.
import {
  clamp,
  type ExerciseContext,
  type ExerciseDef,
  type ExerciseInstance,
  type ExerciseResult,
  type Input,
  type Params,
} from '../engine/types'

type Path = 'horizontal' | 'vertical' | 'zigzag' | 'figure8'
const PATHS: readonly Path[] = ['horizontal', 'vertical', 'zigzag', 'figure8']

const COLS = 96                        // tracer columns 0-95
const ROWS = 5                         // tracer rows 0-4
const MID_ROW = 2
const MID_COL = 47
const LABEL_EVERY_MS = 2000            // each label change is one more upgrade — cap the churn
const ZIG = [0, 1, 2, 3, 4, 3, 2, 1]   // zigzag: row per sweep, 0..4..0

/** ms to wait after each step. Never below 80 — an upgrade is already ~100-300 ms. */
function waitFor(speed: number) { return clamp(420 - speed * 35, 80, 400) }

/**
 * Columns moved per step. Scales gently with speed (3..7) because the fixed
 * BLE cost per upgrade compresses what the wait alone can express — real step
 * periods run roughly 585 ms at speed 1 to 280 ms at speed 10, only ~2x.
 * With the stride, a horizontal sweep runs ~20 s at speed 1 down to ~4 s at 10.
 */
function stride(speed: number) { return 2 + Math.round(speed / 2) }

/** 0 -> 1 -> 0 as p runs 0 -> 1 -> 2, repeating. */
function triangle(p: number) { const m = p % 2; return m <= 1 ? m : 2 - m }

function create(ctx: ExerciseContext, params: Params): ExerciseInstance {
  const rawPath = String(params.path)
  const path: Path = (PATHS as readonly string[]).includes(rawPath) ? (rawPath as Path) : 'horizontal'
  let speed = clamp(Math.round(Number(params.speed) || 4), 1, 10)
  const durationMs = clamp(Number(params.durationSec) || 60, 20, 300) * 1000

  // phase: sweep progress for horizontal/vertical/zigzag (1.0 = one sweep),
  // or the angle t for figure8.
  let phase = 0
  let steps = 0
  let startedAt = 0
  let endedAt = 0
  let finished = false
  let stopped = false
  let lastLabelAt = -Infinity
  let labelNote = ''                    // one-shot label after a speed change
  let inflight: Promise<void> = Promise.resolve()

  function position(): { row: number; col: number } {
    if (path === 'vertical') return { row: triangle(phase) * (ROWS - 1), col: MID_COL }
    if (path === 'zigzag') return { row: ZIG[Math.floor(phase) % ZIG.length], col: triangle(phase) * (COLS - 1) }
    if (path === 'figure8') return { row: MID_ROW + 2 * Math.sin(2 * phase), col: MID_COL + 45 * Math.sin(phase) }
    return { row: MID_ROW, col: triangle(phase) * (COLS - 1) }
  }

  function advance() {
    const s = stride(speed)
    // figure8: d(col)/dt peaks at 45, so dt = s/45 caps the column jump at s.
    phase += path === 'figure8' ? s / 45 : s / (COLS - 1)
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
    const { row, col } = position()
    let text: string | undefined
    if (now - lastLabelAt >= LABEL_EVERY_MS) { lastLabelAt = now; text = label(now) }
    inflight = ctx.page.tracer(row, col, text)
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
      await ctx.page.clearTracer()
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
  summary: 'Follow a gliding dot with both eyes. Head still.',
  instructions() {
    return [
      'Both eyes open. Keep your head still.',
      'Follow the dot with your eyes only.',
      'Stay on it. Do not jump ahead.',
      'Swipe up or down to change speed.',
    ]
  },
  params: [
    {
      key: 'path', label: 'Path', type: 'select', default: 'horizontal',
      options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
        { value: 'zigzag', label: 'Zigzag' },
        { value: 'figure8', label: 'Figure 8' },
      ],
      help: 'The shape the dot traces. Start with horizontal.',
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
