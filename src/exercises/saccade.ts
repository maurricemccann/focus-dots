// Saccades: the target jumps to a new spot and the eyes re-fixate on it.
// Tracer layout — one jump is one near-free row upgrade. Binocular.
import type { ExerciseContext, ExerciseDef, ExerciseInstance, Params } from '../engine/types'

const LABEL_EVERY_MS = 2000

type Spot = { row: number; col: number }
type Bounds = { rows: [number, number]; cols: [number, number] }

const SPREAD: Record<string, Bounds> = {
  wide: { rows: [0, 4], cols: [5, 90] },
  narrow: { rows: [1, 3], cols: [25, 70] },
}

const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))

// The next spot for a pattern. Never the same spot as `last`.
export function nextSpot(pattern: string, b: Bounds, last: Spot | null): Spot {
  const [r0, r1] = b.rows
  const [c0, c1] = b.cols
  const midRow = Math.round((r0 + r1) / 2)
  const midCol = Math.floor((c0 + c1) / 2)          // wide -> 47, narrow -> 47
  if (pattern === 'leftright') return { row: midRow, col: last?.col === c0 ? c1 : c0 }
  if (pattern === 'updown') return { row: last?.row === r0 ? r1 : r0, col: midCol }
  // random: a different row, or the same row at least a quarter of the span
  // away — a one-column hop is not a saccade.
  const minHop = Math.ceil((c1 - c0) / 4)
  for (;;) {
    const s = { row: randInt(r0, r1), col: randInt(c0, c1) }
    if (!last || s.row !== last.row || Math.abs(s.col - last.col) >= minHop) return s
  }
}

function create(ctx: ExerciseContext, p: Params): ExerciseInstance {
  const intervalMs = Number(p.intervalSec) * 1000
  const durationMs = Number(p.durationSec) * 1000
  const bounds = SPREAD[String(p.spread)] ?? SPREAD.wide
  const pattern = String(p.pattern)
  let spot: Spot | null = null
  let startAt = 0
  let endAt = 0
  let nextJumpAt = 0
  let nextLabelAt = 0
  let stopAt: number | null = null
  let jumps = 0
  let done = false

  const label = (now: number) => `jump · ${Math.max(0, Math.ceil((endAt - now) / 1000))}s`

  return {
    async start() {
      startAt = ctx.now()
      endAt = startAt + durationMs
      nextJumpAt = startAt + intervalMs
      nextLabelAt = startAt + LABEL_EVERY_MS
      spot = nextSpot(pattern, bounds, null)
      await ctx.page.tracer(spot.row, spot.col, label(startAt))
    },

    async tick() {
      if (done) return 'done'
      const now = ctx.now()
      if (now >= endAt) { done = true; return 'done' }
      // The runner may wake early on input — act only on what is actually due.
      const labelDue = now >= nextLabelAt
      if (labelDue) nextLabelAt = now + LABEL_EVERY_MS
      if (now >= nextJumpAt) {
        nextJumpAt = now + intervalMs
        spot = nextSpot(pattern, bounds, spot)
        jumps++
        await ctx.page.tracer(spot.row, spot.col, labelDue ? label(now) : undefined)
      } else if (labelDue) {
        await ctx.page.setLabel(label(now))
      }
      return Math.max(50, Math.min(nextJumpAt, nextLabelAt, endAt) - ctx.now())
    },

    async onInput() { /* nothing to answer — the dot leads, the eyes follow */ },

    async stop() {
      if (stopAt !== null) return
      stopAt = ctx.now()
      await ctx.page.clearTracer()
    },

    result() {
      const elapsedMs = startAt ? Math.min((stopAt ?? ctx.now()) - startAt, durationMs) : 0
      return {
        exerciseId: def.id,
        completed: done,
        durationMs: elapsedMs,
        metrics: { jumps, durationSec: Math.round(elapsedMs / 1000) },
      }
    },
  }
}

export const def: ExerciseDef = {
  id: 'saccade',
  name: 'Saccades',
  kind: 'binocular',
  summary: 'The dot jumps. Your eyes snap to it.',
  instructions: () => [
    'The dot jumps to a new spot.',
    'Snap your eyes to it. Head still.',
    'Hold on it until the next jump.',
  ],
  params: [
    { key: 'intervalSec', label: 'Jump every', type: 'number', default: 1.5, min: 0.5, max: 5, step: 0.5, unit: 's', help: 'Seconds the dot holds before it jumps. Shorter is harder.' },
    { key: 'durationSec', label: 'Duration', type: 'number', default: 60, min: 20, max: 300, step: 10, unit: 's', help: 'Length of the drill.' },
    { key: 'spread', label: 'Spread', type: 'select', default: 'wide', options: [{ value: 'wide', label: 'Wide' }, { value: 'narrow', label: 'Narrow' }], help: 'Wide uses the whole lens. Narrow keeps the jumps near the centre.' },
    { key: 'pattern', label: 'Pattern', type: 'select', default: 'random', options: [{ value: 'random', label: 'Random' }, { value: 'leftright', label: 'Left / right' }, { value: 'updown', label: 'Up / down' }], help: 'Random jumps anywhere in the spread. The others alternate between two fixed spots.' },
  ],
  estimateSeconds: p => Number(p.durationSec),
  create,
}
