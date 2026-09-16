// Free Dot — one target that YOU put wherever you want it, and move while the
// drill is running.
//
// Founder ask, S276·2997: "there should also be an exercise that allows you to
// place a dot anywhere and be able to set it on the phone or move it somehow".
//
// Why this earns a place next to Fixation rather than being a setting on it:
// amblyopia is not uniform across the visual field, and the founder's own
// account of it is that "with my lazy eye it's a bit harder to focus on certain
// areas". Fixation holds the centre and scores steadiness. This one is for
// hunting the areas that are hard — you park the dot in a weak corner, hold it,
// then move it somewhere else without stopping.
//
// It is affordable because it is text, not an image: a dot container is
// repositioned by a text-only rebuild, which is fast. The same screen drawn
// with Glyph would cost 0.5-2 s per move and stop being a placement tool.
import { clamp, type Dot, type ExerciseDef, type ExerciseInstance, type Params } from '../engine/types'
import { liveTarget, setLiveTarget, onLiveTarget } from '../data/live'

const SAMPLE_WINDOW_MS = 1000

export const def: ExerciseDef = {
  id: 'freedot',
  name: 'Free Dot',
  kind: 'binocular',
  summary: 'Put the dot where you want it. Move it any time from the phone.',
  instructions: () => [
    'Tap the preview to place the dot.',
    'Hold your gaze on it.',
    // ASCII only: the firmware silently drops em dashes (BLUEPRINT.md).
    'Move it whenever you like. It',
    'does not restart the drill.',
    'Blink often. Do not stare.',
  ],
  params: [
    { key: 'holdSec', label: 'Length', type: 'number', default: 60, min: 10, max: 300, step: 10, unit: 's', help: 'Total time before the drill ends.' },
    { key: 'size', label: 'Dot size', type: 'select', default: 'large',
      options: [
        { value: 'large', label: 'Large' },
        { value: 'medium', label: 'Medium' },
        { value: 'small', label: 'Small' },
      ],
      help: 'The glasses cannot scale text, so these are three real glyphs rather than a smooth size.' },
    { key: 'x', label: 'Start across', type: 'number', default: 288, min: 0, max: 576, step: 8, unit: 'px', help: 'Where it starts, left to right. Tap the preview to place it.' },
    { key: 'y', label: 'Start down', type: 'number', default: 128, min: 0, max: 256, step: 8, unit: 'px', help: 'Where it starts, top to bottom.' },
  ],
  estimateSeconds: p => Number(p.holdSec) || 60,
  create(ctx, params: Params): ExerciseInstance {
    const holdMs = clamp(Number(params.holdSec) || 60, 10, 300) * 1000
    const size = String(params.size) as Dot['size']

    // The step's own x/y seed the live target, so a routine can still place it
    // and the phone can still move it afterwards.
    setLiveTarget({ x: Number(params.x) || 288, y: Number(params.y) || 128 })

    let startedAt = 0
    let done = false
    let stopped = false
    let moved = 0
    let dirty = true
    let windowStart = 0
    let windowPeak = 0
    const samplePeaks: number[] = []
    let unsubscribe: (() => void) | null = null

    const render = () => {
      const t = liveTarget()
      return ctx.page.dots([{ x: t.x, y: t.y, size }], label())
    }

    function label() {
      const left = Math.max(0, Math.ceil((startedAt + holdMs - ctx.now()) / 1000))
      const t = liveTarget()
      return `${t.x},${t.y} · ${left}s`
    }

    return {
      async start() {
        startedAt = ctx.now()
        windowStart = startedAt
        // A move from the phone only marks the screen dirty; the repaint happens
        // in tick(), so the runner stays the one loop that sends (BLUEPRINT.md).
        unsubscribe = onLiveTarget(() => { dirty = true; moved++ })
        await render()
        await ctx.imu.start()
      },

      async tick() {
        if (done || stopped) return 'done'
        const elapsed = ctx.now() - startedAt
        if (elapsed >= holdMs) { done = true; return 'done' }
        if (dirty) {
          dirty = false
          await render()
        } else {
          await ctx.page.setLabel(label())
        }
        return 250
      },

      async onInput(input) {
        if (input.type !== 'imu' || done || stopped) return
        const mag = Math.abs(input.x) + Math.abs(input.y) + Math.abs(input.z)
        windowPeak = Math.max(windowPeak, mag)
        if (ctx.now() - windowStart >= SAMPLE_WINDOW_MS) {
          samplePeaks.push(windowPeak)
          windowPeak = 0
          windowStart = ctx.now()
        }
      },

      async stop() {
        stopped = true
        unsubscribe?.()
        await ctx.imu.stop()
      },

      result() {
        const measured = samplePeaks.length > 0
        const avgPeak = measured ? samplePeaks.reduce((a, b) => a + b, 0) / samplePeaks.length : 0
        const steadinessPct = measured ? Math.round(clamp(100 - avgPeak * 20, 0, 100)) : 0
        const t = liveTarget()
        return {
          exerciseId: 'freedot',
          completed: done,
          durationMs: Math.round(ctx.now() - startedAt),
          metrics: { steadinessPct, moves: moved, lastX: t.x, lastY: t.y },
          note: measured
            ? `${moved} move${moved === 1 ? '' : 's'} · steadiness ${steadinessPct}%`
            : `${moved} move${moved === 1 ? '' : 's'} · no head-motion data`,
        }
      },
    }
  },
}
