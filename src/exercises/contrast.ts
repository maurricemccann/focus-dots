// Contrast Sensitivity — a fixed-size tumbling E that fades toward the
// background instead of shrinking. Same 2-alternative up/down answer as
// Acuity; the confound this isolates is contrast, not size, so the E stays
// large and only its brightness LEVEL steps down.
import { otherEye, type Eye, type ExerciseContext, type ExerciseDef, type ExerciseInstance, type Input, type Params } from '../engine/types'

type Dir = 'up' | 'down'
const CX = 288, CY = 128, PX = 90 // fixed, generous size — contrast is the only variable
const REACT_MS = 250
const RETRY_MS = 1000
const MAX_FAILS = 3

/**
 * The E, drawn at one of the display's REAL levels.
 *
 * This used to take a 0-255 canvas value and let tilePixels() quantise it, with
 * the staircase stepping 20 down / 30 up. The lens has 16 levels, ~17 units
 * apart, so a step of 20 was ~1.2 levels: some steps changed nothing visible at
 * all, others jumped two, and the reported threshold ("dimmest 140/255")
 * implied a precision the hardware cannot express. In the one exercise where
 * the contrast level IS the measurement, that made the measurement fiction.
 *
 * Levels are the unit end to end now - Glyph's own model, "integers 0-15, not
 * CSS colors" - so one step of the staircase is exactly one visible step.
 */
function drawE(g: any, level: number, dir: Dir) {
  const s = Math.round(PX / 5)
  const left = Math.round(CX - PX / 2), top = Math.round(CY - PX / 2)
  const bar = (x: number, y: number, w: number, h: number) =>
    g.rect({ x, y, width: w, height: h }, { fill: level })
  bar(left, dir === 'up' ? top + PX - s : top, PX, s)
  for (const x of [left, left + Math.round((PX - s) / 2), left + PX - s]) bar(x, top, s, PX)
}

function create(ctx: ExerciseContext, params: Params): ExerciseInstance {
  const startLevel = Number(params.startLevel)
  const minLevel = Math.min(Number(params.minLevel), startLevel)
  const trials = Number(params.trials)
  const holdMs = Number(params.holdSec) * 1000

  let level = startLevel
  let dir: Dir = 'up'
  let trial = 0
  let correct = 0
  let minLevelCorrect = startLevel
  let shownAt = 0
  let awaiting = false
  let done = false
  let stopped = false
  let fails = 0
  let startedAt = 0

  const label = () => `swipe up or down: which way? · ${trial + 1}/${trials}`

  async function show() {
    dir = Math.random() < 0.5 ? 'up' : 'down'
    const r = await ctx.page.glyph((g: any) => drawE(g, level, dir), label())
    if (r === 'success') { awaiting = true; shownAt = ctx.now(); fails = 0 }
    else if (++fails >= MAX_FAILS) done = true // an unseen E is never scored; three misses ends the drill
  }

  function answer(a: Dir | null) {
    awaiting = false
    if (a === dir) {
      correct++
      minLevelCorrect = Math.min(minLevelCorrect, level)
      level = Math.max(minLevel, level - 1)   // exactly one visible step
    } else {
      level = Math.min(startLevel, level + 2)  // back off two on a miss
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
        metrics: { minLevelCorrect, accuracyPct, trials: trial },
        note: `dimmest level ${minLevelCorrect}/15 · ${correct}/${trial} right`,
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
    { key: 'startLevel', label: 'Start brightness', type: 'number', default: 15, min: 6, max: 15, step: 1, help: 'Display level (0-15) of the first E. 15 is the brightest the lens can draw.' },
    { key: 'minLevel', label: 'Dimmest', type: 'number', default: 1, min: 1, max: 8, step: 1, help: 'The E never dims below this level. 1 is the faintest lit level; 0 is off.' },
    { key: 'trials', label: 'Trials', type: 'number', default: 8, min: 4, max: 20, step: 1, help: 'How many Es to answer.' },
    { key: 'holdSec', label: 'Answer time', type: 'number', default: 4, min: 2, max: 8, step: 1, unit: 's', help: 'Seconds to answer before it counts as cannot tell.' },
  ],
  estimateSeconds: p => Number(p.trials) * (Number(p.holdSec) + 4),
  create,
}
