// Contrast Sensitivity — a fixed-size tumbling E that fades toward the
// background instead of shrinking. Same 2-alternative up/down answer as
// Acuity; the confound this isolates is contrast, not size, so the E stays
// large and only fill brightness (0-255 gray on black) steps down.
import { otherEye, type Eye, type ExerciseContext, type ExerciseDef, type ExerciseInstance, type Input, type Params } from '../engine/types'

type Dir = 'up' | 'down'
const CX = 288, CY = 128, PX = 90 // fixed, generous size — contrast is the only variable
const REACT_MS = 250
const RETRY_MS = 1000
const MAX_FAILS = 3

function drawE(c: CanvasRenderingContext2D, gray: number, dir: Dir) {
  const s = Math.round(PX / 5)
  const left = Math.round(CX - PX / 2), top = Math.round(CY - PX / 2)
  c.fillStyle = `rgb(${gray},${gray},${gray})`
  c.fillRect(left, dir === 'up' ? top + PX - s : top, PX, s)
  for (const x of [left, left + Math.round((PX - s) / 2), left + PX - s]) c.fillRect(x, top, s, PX)
}

function create(ctx: ExerciseContext, params: Params): ExerciseInstance {
  const startGray = Number(params.startGray)
  const minGray = Math.min(Number(params.minGray), startGray)
  const trials = Number(params.trials)
  const holdMs = Number(params.holdSec) * 1000

  let gray = startGray
  let dir: Dir = 'up'
  let trial = 0
  let correct = 0
  let minGrayCorrect = startGray
  let shownAt = 0
  let awaiting = false
  let done = false
  let stopped = false
  let fails = 0
  let startedAt = 0

  const label = () => `swipe up or down: which way? · ${trial + 1}/${trials}`

  async function show() {
    dir = Math.random() < 0.5 ? 'up' : 'down'
    const r = await ctx.page.image(c => drawE(c, gray, dir), label())
    if (r === 'success') { awaiting = true; shownAt = ctx.now(); fails = 0 }
    else if (++fails >= MAX_FAILS) done = true // an unseen E is never scored; three misses ends the drill
  }

  function answer(a: Dir | null) {
    awaiting = false
    if (a === dir) {
      correct++
      minGrayCorrect = Math.min(minGrayCorrect, gray)
      gray = Math.max(minGray, gray - 20)
    } else {
      gray = Math.min(startGray, gray + 30)
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
        answer(null) // no answer in time = cannot tell
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
        exerciseId: 'contrast',
        completed: trial >= trials,
        durationMs: Math.round(ctx.now() - startedAt),
        metrics: { minGrayCorrect, accuracyPct, trials: trial },
        note: `dimmest gray ${minGrayCorrect}/255 · ${correct}/${trial} right`,
      }
    },
  }
}

export const def: ExerciseDef = {
  id: 'contrast',
  name: 'Contrast Sensitivity',
  kind: 'monocular',
  summary: 'A fixed-size E fades toward black. Answer up or down as long as you can tell.',
  instructions: (weakEye: Eye) => [
    `Cover your ${otherEye(weakEye).toUpperCase()} eye.`,
    'An E points up or down.',
    'Swipe up or down to match it.',
    'Tap if you cannot tell.',
    'Correct answers dim it further.',
  ],
  params: [
    { key: 'startGray', label: 'Start brightness', type: 'number', default: 220, min: 150, max: 255, step: 5, help: 'Gray level (0-255) of the first E, brightest against the black background.' },
    { key: 'minGray', label: 'Dimmest', type: 'number', default: 20, min: 5, max: 100, step: 5, help: 'The E never dims below this.' },
    { key: 'trials', label: 'Trials', type: 'number', default: 8, min: 4, max: 20, step: 1, help: 'How many Es to answer.' },
    { key: 'holdSec', label: 'Answer time', type: 'number', default: 4, min: 2, max: 8, step: 1, unit: 's', help: 'Seconds to answer before it counts as cannot tell.' },
  ],
  estimateSeconds: p => Number(p.trials) * (Number(p.holdSec) + 4),
  create,
}
