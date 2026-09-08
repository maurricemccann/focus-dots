// Convergence — the pencil push-up analog. Two large dots at y=130 whose gap
// steps narrower (or wider) every holdSec; the user taps the moment the two
// read as one. Dots layout only: one rebuild per step, nothing per frame.
import type { Dot, ExerciseDef, ExerciseInstance, Params } from '../engine/types'
import { clamp } from '../engine/types'

type Dir = 'converge' | 'diverge'
interface Step { cycle: number; dir: Dir; gap: number }

const Y = 130           // well clear of the label strip at y >= 260
const CX = 288

function plan(p: Params) {
  // Clamped to the ParamSpec ranges: a routine file can hand us anything, and
  // stepPx = 0 would loop forever below.
  const minGap = clamp(Number(p.minGap) || 20, 10, 80)
  const maxGap = Math.max(minGap, clamp(Number(p.maxGap) || 260, 100, 400))
  const stepPx = clamp(Number(p.stepPx) || 40, 10, 80)
  const holdMs = clamp(Number(p.holdSec) || 3, 1, 10) * 1000
  const cycles = clamp(Math.round(Number(p.cycles) || 4), 1, 20)
  const direction = String(p.direction)
  const gaps: number[] = []
  for (let g = maxGap; g > minGap; g -= stepPx) gaps.push(g)
  gaps.push(minGap)
  const steps: Step[] = []
  for (let c = 0; c < cycles; c++) {
    const dir: Dir = direction === 'diverge' || (direction === 'both' && c % 2 === 1) ? 'diverge' : 'converge'
    for (const gap of dir === 'diverge' ? [...gaps].reverse() : gaps) steps.push({ cycle: c, dir, gap })
  }
  return { steps, holdMs, cycles, maxGap }
}

export const def: ExerciseDef = {
  id: 'converge',
  name: 'Convergence',
  kind: 'binocular',
  summary: 'Two dots step closer together. Tap the moment they read as one.',
  instructions: () => [
    'Two dots, side by side.',
    'Let them drift together into one.',
    'Tap the moment you see ONE dot.',
    'The gap changes every few seconds.',
    'If they split, tap again when they fuse.',
  ],
  params: [
    { key: 'direction', label: 'Direction', type: 'select', default: 'converge', options: [
      { value: 'converge', label: 'Converge (narrow)' },
      { value: 'diverge', label: 'Diverge (widen)' },
      { value: 'both', label: 'Both (alternate)' },
    ], help: 'Narrow the gap, widen it, or alternate each cycle.' },
    { key: 'maxGap', label: 'Widest gap', type: 'number', default: 260, min: 100, max: 400, step: 20, unit: 'px', help: 'Widest gap between the dots. Each cycle starts (or ends) here.' },
    { key: 'minGap', label: 'Narrowest gap', type: 'number', default: 20, min: 10, max: 80, step: 5, unit: 'px', help: 'Narrowest gap between the dots.' },
    { key: 'stepPx', label: 'Step', type: 'number', default: 40, min: 10, max: 80, step: 5, unit: 'px', help: 'How much the gap changes per step.' },
    { key: 'holdSec', label: 'Hold', type: 'number', default: 3, min: 1, max: 10, step: 1, unit: 's', help: 'Seconds each gap is held before the next step.' },
    { key: 'cycles', label: 'Cycles', type: 'number', default: 4, min: 1, max: 20, step: 1, help: 'How many times the gap runs from widest to narrowest.' },
  ],
  estimateSeconds(p) {
    const { steps, holdMs } = plan(p)
    return Math.round(steps.length * holdMs / 1000)
  },
  create(ctx, params): ExerciseInstance {
    const { steps, holdMs, cycles, maxGap } = plan(params)
    const fused = new Array<number | null>(cycles).fill(null)   // smallest tapped gap per cycle, null = never
    let i = 0
    let taps = 0
    let shownAt = 0
    let stopped = false
    const t0 = ctx.now()
    const over = () => stopped || i >= steps.length
    const label = (s: Step, tail: string) => `${s.dir} · gap ${s.gap} · ${s.cycle + 1}/${cycles} · ${tail}`

    async function show() {
      const s = steps[i]
      const dots: Dot[] = [
        { x: CX - s.gap / 2, y: Y, size: 'large' },
        { x: CX + s.gap / 2, y: Y, size: 'large' },
      ]
      await ctx.page.dots(dots, label(s, 'tap when one'))
      shownAt = ctx.now()
    }

    return {
      async start() { await show() },
      async tick() {
        if (over()) return 'done'
        // Time-based hold: a tap nudges the runner into an early tick, and
        // that must not cut the current gap short.
        const left = shownAt + holdMs - ctx.now()
        if (left > 0) return Math.max(50, left)
        if (++i >= steps.length) return 'done'
        await show()
        return holdMs
      },
      async onInput(input) {
        if (input.type !== 'tap' || over()) return
        const s = steps[i]
        taps++
        fused[s.cycle] = Math.min(fused[s.cycle] ?? Infinity, s.gap)
        await ctx.page.setLabel(label(s, `one at ${s.gap}`))
      },
      async stop() { stopped = true },
      result() {
        const hits = fused.filter((g): g is number => g !== null)
        const completed = i >= steps.length
        return {
          exerciseId: 'converge',
          completed,
          durationMs: ctx.now() - t0,
          metrics: {
            minGapFused: hits.length ? Math.min(...hits) : maxGap,
            cyclesDone: completed ? cycles : steps[i].cycle,
            taps,
          },
          note: 'fused at ' + fused.map(g => g === null ? 'none' : String(g)).join(' / '),
        }
      },
    }
  },
}
