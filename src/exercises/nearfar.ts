// Near / Far — accommodation pumping. A large dot low on the lens stands for
// NEAR, a small dot high on the lens for FAR. The user alternates fixation,
// holding each for intervalSec, both eyes open. Dots layout: one rebuild per
// switch, a near-free label upgrade for the blink cue. Every glyph here is
// ASCII or the known-good ● / · (BLUEPRINT.md) — so the strip reads
// "NEAR - hold - 3/20", never with an em dash the firmware font would drop.
import { clamp, type Dot, type ExerciseContext, type ExerciseDef, type ExerciseInstance, type Params } from '../engine/types'

const NEAR: Dot = { x: 288, y: 190, size: 'large' }   // lower-centre, box 170-210, clear of the label strip
const FAR: Dot = { x: 288, y: 60, size: 'small' }     // upper-centre
const BLINK_MS = 600                                  // how long the strip says "blink" after a switch
const SLACK_MS = 30                                   // timer drift tolerance; inside this the hold counts as elapsed

function read(p: Params) {
  return {
    intervalSec: clamp(Number(p.intervalSec) || 4, 2, 15),
    reps: Math.round(clamp(Number(p.reps) || 20, 4, 60)),
    cueBlink: p.cueBlink !== false,
  }
}

function create(ctx: ExerciseContext, params: Params): ExerciseInstance {
  const { intervalSec, reps, cueBlink } = read(params)
  const intervalMs = intervalSec * 1000
  let rep = 0                          // index of the current hold — also the count of holds completed
  let phase: 'blink' | 'hold' = 'hold'
  let phaseAt = 0                      // ctx.now() when the current phase landed on the lens
  let finished = false
  let stopped = false
  const t0 = ctx.now()

  const label = () => `${rep % 2 === 0 ? 'NEAR' : 'FAR'} - ${phase} - ${rep + 1}/${reps}`
  const phaseMs = () => (phase === 'blink' ? BLINK_MS : cueBlink ? intervalMs - BLINK_MS : intervalMs)

  // Put the current rep's target up. The hold clock starts once the frame has landed.
  async function show() {
    phase = cueBlink ? 'blink' : 'hold'
    await ctx.page.dots([rep % 2 === 0 ? NEAR : FAR], label())
    phaseAt = ctx.now()
  }

  return {
    async start() { await show() },

    async tick() {
      if (finished || stopped) return 'done'
      const left = phaseAt + phaseMs() - ctx.now()
      if (left > SLACK_MS) return Math.max(50, left)
      if (phase === 'blink') {
        phase = 'hold'
        await ctx.page.setLabel(label())
        phaseAt = ctx.now()
        return phaseMs()
      }
      rep++
      if (rep >= reps) { finished = true; return 'done' }
      await show()
      return phaseMs()
    },

    // Timed drill: taps and swipes change nothing. Skip / restart live on the menu.
    async onInput() {},

    async stop() { stopped = true },

    result: () => ({
      exerciseId: 'nearfar',
      completed: finished,
      durationMs: Math.round(ctx.now() - t0),
      metrics: { repsDone: rep, intervalSec },
    }),
  }
}

export const def: ExerciseDef = {
  id: 'nearfar',
  name: 'Near / Far',
  kind: 'binocular',
  summary: 'Alternate focus between a near dot and a far dot.',
  instructions: () => [
    'Big dot low on the lens = NEAR.',
    'Small dot high on the lens = FAR.',
    'Look at the dot that is showing.',
    'Keep both eyes open.',
    'Let focus settle before each switch.',
  ],
  params: [
    { key: 'intervalSec', label: 'Hold', type: 'number', default: 4, min: 2, max: 15, step: 1, unit: 's', help: 'How long each target stays up before it switches.' },
    { key: 'reps', label: 'Holds', type: 'number', default: 20, min: 4, max: 60, step: 2, help: 'Total holds. Near and far alternate, so an even count ends balanced.' },
    { key: 'cueBlink', label: 'Blink cue', type: 'boolean', default: true, help: 'The strip says "blink" for a moment at each switch.' },
  ],
  estimateSeconds: p => { const r = read(p); return r.reps * r.intervalSec },
  create,
}
