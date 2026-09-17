// Brock String — the classic vergence-awareness drill, without the physical
// string. Attention sweeps NEAR -> MID -> FAR -> MID along one line, one dot
// showing at a time. Tap the moment the dot reads single and clear (not
// doubled or blurred) — the same self-report the physical string asks for.
// Dots layout: one rebuild per stop, no per-frame work.
import { clamp, type Dot, type ExerciseDef, type ExerciseInstance, type Params } from '../engine/types'

type Stop = 'near' | 'mid' | 'far'
const POS: Record<Stop, Dot> = {
  near: { x: 288, y: 215, size: 'large' },
  mid: { x: 288, y: 135, size: 'medium' },
  far: { x: 288, y: 55, size: 'small' },
}
const SWEEP: Stop[] = ['near', 'mid', 'far', 'mid'] // one lap, repeated `reps` times

function plan(p: Params) {
  const holdSec = clamp(Number(p.holdSec) || 4, 2, 10)
  const reps = clamp(Math.round(Number(p.reps) || 5), 2, 20)
  const stops: Stop[] = []
  for (let r = 0; r < reps; r++) stops.push(...SWEEP)
  return { stops, holdMs: holdSec * 1000 }
}

export const def: ExerciseDef = {
  id: 'brock',
  name: 'Brock String',
  kind: 'binocular',
  summary: 'A dot sweeps near, mid, far. Tap the moment it reads single and clear.',
  instructions: () => [
    'One dot at a time: near, then mid, then far.',
    'Follow the dot.',
    'Tap the instant it looks single and sharp.',
    'If it splits into two or blurs, wait.',
    'It moves on its own either way.',
  ],
  params: [
    { key: 'holdSec', label: 'Hold', type: 'number', default: 4, min: 2, max: 10, step: 1, unit: 's', help: 'Seconds each stop is held before moving on.' },
    { key: 'reps', label: 'Laps', type: 'number', default: 5, min: 2, max: 20, step: 1, help: 'How many times the dot sweeps near-mid-far-mid.' },
  ],
  estimateSeconds(p) {
    const { stops, holdMs } = plan(p)
    return Math.round(stops.length * holdMs / 1000)
  },
  create(ctx, params): ExerciseInstance {
    const { stops, holdMs } = plan(params)
    let i = 0
    let shownAt = 0
    let clearTaps = 0
    let stopped = false
    const t0 = ctx.now()
    const over = () => stopped || i >= stops.length
    const label = (s: Stop) => `${s} · ${i + 1}/${stops.length} · tap when clear`

    async function show() {
      const s = stops[i]
      await ctx.page.dots([POS[s]], label(s))
      shownAt = ctx.now()
    }

    return {
      async start() { await show() },
      async tick() {
        if (over()) return 'done'
        const left = shownAt + holdMs - ctx.now()
        if (left > 0) return Math.max(50, left)
        if (++i >= stops.length) return 'done'
        await show()
        return holdMs
      },
      async onInput(input) {
        if (input.type !== 'tap' || over()) return
        clearTaps++
        await ctx.page.setLabel(`${stops[i]} · clear`)
      },
      async stop() { stopped = true },
      result() {
        return {
          exerciseId: 'brock',
          completed: i >= stops.length,
          durationMs: Math.round(ctx.now() - t0),
          metrics: { clearTaps, stopsShown: Math.min(i + 1, stops.length) },
          note: `${clearTaps} clear report(s) of ${stops.length} stops`,
        }
      },
    }
  },
}
