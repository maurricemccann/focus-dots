// Acuity & Crowding — a tumbling E that shrinks while you answer its direction.
// One image per trial (2-8 s over Bluetooth), never animated. Two alternatives,
// up or down, because the glasses give us swipe up / swipe down.
import { otherEye, type Eye, type ExerciseContext, type ExerciseDef, type ExerciseInstance, type Input, type Params } from '../engine/types'

type Dir = 'up' | 'down'

const CX = 288, CY = 128          // centre of the field above the label strip (y < 256)
const REACT_MS = 250              // a swipe queued during the image send lands ~0 ms after it — not an answer to this E
const RETRY_MS = 1000
const MAX_FAILS = 3

function drawE(c: CanvasRenderingContext2D, px: number, dir: Dir, crowd: boolean) {
  const s = Math.max(1, Math.round(px / 5))                       // stroke = one fifth of the letter
  const left = Math.round(CX - px / 2), top = Math.round(CY - px / 2)
  c.fillStyle = '#fff'
  // Spine across the closed side; three fingers toward the open side.
  c.fillRect(left, dir === 'up' ? top + px - s : top, px, s)
  for (const x of [left, left + Math.round((px - s) / 2), left + px - s]) c.fillRect(x, top, s, px)
  if (!crowd) return
  // ponytail: gap is one letter-width; it shrinks only when the outer bars would leave the
  // 256 px field (px > ~75). Exact at threshold sizes, which is where crowding matters.
  const gap = Math.max(0, Math.min(px, Math.floor(126 - px / 2 - s)))
  c.fillRect(left, top - gap - s, px, s)
  c.fillRect(left, top + px + gap, px, s)
  c.fillRect(left - gap - s, top, s, px)
  c.fillRect(left + px + gap, top, s, px)
}

function create(ctx: ExerciseContext, params: Params): ExerciseInstance {
  const startPx = Number(params.startPx)
  const minPx = Math.min(Number(params.minPx), startPx)
  const crowding = Boolean(params.crowding)
  const trials = Number(params.trials)
  const holdMs = Number(params.holdSec) * 1000

  let px = startPx
  let dir: Dir = 'up'
  let trial = 0                   // answered so far
  let correct = 0
  let minPxCorrect = startPx
  let shownAt = 0
  let awaiting = false            // an E is on the lenses and unanswered
  let done = false
  let stopped = false
  let fails = 0
  let startedAt = 0

  const label = () => `swipe up or down: which way? · ${trial + 1}/${trials}`

  async function show() {
    dir = Math.random() < 0.5 ? 'up' : 'down'
    const r = await ctx.page.image(c => drawE(c, px, dir, crowding), label())
    if (r === 'success') { awaiting = true; shownAt = ctx.now(); fails = 0 }
    else if (++fails >= MAX_FAILS) done = true   // an unseen E is never scored; three misses ends the drill
  }

  function answer(a: Dir | null) {
    awaiting = false
    if (a === dir) {
      correct++
      minPxCorrect = Math.min(minPxCorrect, px)
      px = Math.max(minPx, Math.round(px * 0.8))
    } else {
      px = Math.min(startPx, Math.round(px * 1.25))
    }
    if (++trial >= trials) done = true
  }

  return {
    async start() {
      startedAt = ctx.now()
      await show()
    },

    async tick() {
      if (done || stopped) return 'done'
      if (awaiting) {
        const left = holdMs - (ctx.now() - shownAt)
        if (left > 0) return Math.max(50, left)
        answer(null)                               // no answer in time = cannot tell
      }
      if (!done) await show()
      return done ? 'done' : awaiting ? holdMs : RETRY_MS
    },

    async onInput(i: Input) {
      if (!awaiting || done || stopped || i.type === 'imu') return
      if (ctx.now() - shownAt < REACT_MS) return
      answer(i.type === 'tap' ? null : i.type)
      if (!done) await show()
    },

    async stop() { stopped = true },

    result() {
      const accuracyPct = trial ? Math.round((correct / trial) * 100) : 0
      return {
        exerciseId: 'acuity',
        completed: trial >= trials,
        durationMs: Math.round(ctx.now() - startedAt),
        metrics: { minPxCorrect, accuracyPct, trials: trial },
        note: `smallest ${minPxCorrect}px · ${correct}/${trial} right${crowding ? ' · crowded' : ''}`,
      }
    },
  }
}

export const def: ExerciseDef = {
  id: 'acuity',
  name: 'Acuity & Crowding',
  kind: 'monocular',
  summary: 'A shrinking E. Answer up or down. Crowding bars optional.',
  instructions: (weakEye: Eye) => [
    `Cover your ${otherEye(weakEye).toUpperCase()} eye.`,
    'An E points up or down.',
    'Swipe up or down to match it.',
    'Tap if you cannot tell.',
    'Correct answers shrink it.',
  ],
  params: [
    { key: 'startPx', label: 'Start size', type: 'number', default: 80, min: 30, max: 120, step: 5, unit: 'px', help: 'Height of the first E.' },
    { key: 'minPx', label: 'Smallest size', type: 'number', default: 12, min: 6, max: 30, step: 2, unit: 'px', help: 'The E never shrinks below this.' },
    { key: 'crowding', label: 'Crowding bars', type: 'boolean', default: true, help: 'Four bars one letter-width around the E. Crowding is the amblyopia-specific deficit.' },
    { key: 'trials', label: 'Trials', type: 'number', default: 8, min: 4, max: 20, step: 1, help: 'How many Es to answer.' },
    { key: 'holdSec', label: 'Answer time', type: 'number', default: 4, min: 2, max: 8, step: 1, unit: 's', help: 'Seconds to answer before it counts as cannot tell.' },
  ],
  estimateSeconds: p => Number(p.trials) * (Number(p.holdSec) + 4),   // + ~4 s per image send
  create,
}
