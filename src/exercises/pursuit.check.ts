// Self-check for what pursuit MEASURES rather than asks (PL FOCUS AT5
// head-still, AT6 blink) and for the sweep-seconds pacing (S280·7a4e).
// Not bundled — nothing imports it.
//
// Run:  npx tsc --ignoreConfig src/exercises/pursuit.check.ts --outDir <tmp> \
//         --module commonjs --target es2022 --noEmit false --skipLibCheck
//       node <tmp>/exercises/pursuit.check.js
//
// The properties worth pinning are the honest ones: a head that never moved and
// a head we never heard from are different answers, a blink cue that never
// fires is a silent failure, and a sweep that could not hit its target must say
// so rather than report the target back.
//
// `assert` is local rather than node:assert on purpose: importing it pulls in
// @types/node, which this repo does not have, and `npm run build` is `tsc &&
// vite build` — so the import would fail the real build to serve a check.
import { def } from './pursuit'
import type { ExerciseContext, Input, Params } from '../engine/types'

const assert = {
  ok(v: unknown, msg: string) { if (!v) throw new Error(msg) },
  strictEqual(a: unknown, b: unknown, msg = `${String(a)} !== ${String(b)}`) { if (a !== b) throw new Error(msg) },
  near(a: number, b: number, tol: number, msg: string) {
    if (Math.abs(a - b) > tol) throw new Error(`${msg} (got ${a}, wanted ${b} +/- ${tol})`)
  },
}

interface Run { labels: string[]; imuStarted: number; imuStopped: number }

/**
 * Drive a real instance on a virtual clock.
 * `mag` is per-axis head motion (null = the IMU never reports).
 * `rebuildMs` is what a ball move costs on the far side of the wire — the thing
 * the exercise has to learn and subtract, or every sweep runs long.
 */
async function run(
  params: Params, seconds: number, mag: number | null, rebuildMs = 0,
): Promise<{ r: Run; note: string; metrics: Record<string, number> }> {
  let t = 0
  const out: Run = { labels: [], imuStarted: 0, imuStopped: 0 }
  const ctx = {
    now: () => t,
    page: {
      curve: async (_p: unknown, _i: number, label?: string) => {
        t += rebuildMs                     // the send costs real time
        if (label) out.labels.push(label)
      },
    },
    imu: { start: async () => { out.imuStarted++ }, stop: async () => { out.imuStopped++ } },
  } as unknown as ExerciseContext

  const inst = def.create(ctx, params)
  await inst.start()

  const endAt = seconds * 1000
  while (t < endAt) {
    const wait = await inst.tick()
    if (wait === 'done') break
    if (mag !== null) {
      t += wait / 2
      await inst.onInput?.({ type: 'imu', x: mag, y: 0, z: 0 } as Input)
      t += wait / 2
    } else {
      t += wait
    }
  }
  await inst.stop?.()
  const res = inst.result()
  return { r: out, note: res.note ?? '', metrics: res.metrics as Record<string, number> }
}

async function main() {
  const base: Params = { path: 'circle', sweepSec: 2, durationSec: 60, pathDim: 1, blinkEverySec: 0, headTol: 0.6 }

  // 1. IMU is bracketed exactly once each way — the blueprint's rule.
  {
    const { r } = await run(base, 3, null)
    assert.strictEqual(r.imuStarted, 1, 'IMU must be started exactly once')
    assert.strictEqual(r.imuStopped, 1, 'IMU must be stopped on exit')
  }

  // 2. No IMU data is NOT a still head. A false 100% reports success for a
  //    sensor that never spoke, which is the worst answer available.
  {
    const { note, metrics } = await run(base, 5, null)
    assert.ok(note.includes('no head-motion data'), `expected unmeasured, got: ${note}`)
    assert.strictEqual(metrics.headStillPct, 0)
    assert.strictEqual(metrics.headStillSec, 0)
  }

  // 3. A still head measures still, and is never nagged.
  {
    const { r, note, metrics } = await run(base, 10, 0.1)
    assert.strictEqual(metrics.headStillPct, 100, `still head should read 100%, got ${metrics.headStillPct}`)
    assert.ok(metrics.headStillSec >= 8, `expected ~10s still, got ${metrics.headStillSec}`)
    assert.ok(!r.labels.some(l => l.startsWith('head still')), 'a still head must not be cued')
    assert.ok(note.includes('head still 100%'), `note should carry the measurement, got: ${note}`)
  }

  // 4. A moving head is cued by name, within ~1s of moving (AT5).
  {
    const { r, metrics } = await run(base, 10, 2.0)
    const first = r.labels.findIndex(l => l.startsWith('head still'))
    assert.ok(first >= 0, 'a moving head must raise a named cue')
    assert.ok(first <= 1, `cue should land within ~1s, was label #${first}`)
    assert.strictEqual(metrics.headStillPct, 0)
  }

  // 5. Blink fires on its interval, and 0 turns it off (AT6).
  {
    const { r } = await run({ ...base, blinkEverySec: 5 }, 22, 0.1)
    const blinks = r.labels.filter(l => l.startsWith('blink')).length
    assert.ok(blinks >= 3, `expected >=3 blink cues in 22s at 5s, got ${blinks}`)
    const { r: off } = await run({ ...base, blinkEverySec: 0 }, 22, 0.1)
    assert.strictEqual(off.labels.filter(l => l.startsWith('blink')).length, 0, '0 must disable the cue')
  }

  // 6. The sweep hits its target even when a rebuild costs real time. Without
  //    the learned subtraction a 2s sweep on 60ms hardware would run ~3.1s,
  //    and the exercise would be paced in a unit it does not honour.
  {
    const { metrics } = await run(base, 40, 0.1, 60)
    assert.strictEqual(metrics.sweepSecTarget, 2)
    assert.near(metrics.sweepSecActual, 2, 0.4, 'sweep should land near its target with 60ms rebuilds')
  }

  // 7. When the rebuild alone costs more than the target step, the target is
  //    physically unreachable — so REPORT the real figure, never the target.
  //    Same honesty rule as case 2, one layer up.
  {
    const { metrics } = await run(base, 60, 0.1, 300)
    assert.ok(
      metrics.sweepSecActual > metrics.sweepSecTarget + 1,
      `an unreachable target must report the truth, got actual ${metrics.sweepSecActual} vs target ${metrics.sweepSecTarget}`,
    )
  }

  // 8. A routine saved before S280 keeps the pace its owner chose. Old speed 4
  //    was ~9.3s per sweep; it must not snap to the new 2s default.
  {
    const legacy: Params = { path: 'circle', speed: 4, durationSec: 60, pathDim: 1, blinkEverySec: 0, headTol: 0.6 }
    const { metrics } = await run(legacy, 30, 0.1)
    assert.near(metrics.sweepSecTarget, 9.3, 0.6, 'legacy speed 4 should map to its real ~9.3s sweep')
  }

  console.log('pursuit.check: 8/8 OK')
}

void main()
