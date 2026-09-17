// Self-check for the two things pursuit measures rather than asks (PL FOCUS
// AT5 head-still, AT6 blink). Not bundled — nothing imports it.
//
// Run:  npx tsc --ignoreConfig src/exercises/pursuit.check.ts --outDir <tmp> \
//         --module commonjs --target es2022 --noEmit false --skipLibCheck
//       node <tmp>/exercises/pursuit.check.js
//
// The point is that a head that never moved and a head we never heard from are
// different answers, and a blink cue that never fires is a silent failure.
//
// `assert` is local rather than node:assert on purpose: importing it pulls in
// @types/node, which this repo does not have, and `npm run build` is `tsc &&
// vite build` — so the import would fail the real build to serve a check.
import { def } from './pursuit'
import type { ExerciseContext, Input, Params } from '../engine/types'

const assert = {
  ok(v: unknown, msg: string) { if (!v) throw new Error(msg) },
  strictEqual(a: unknown, b: unknown, msg = `${String(a)} !== ${String(b)}`) { if (a !== b) throw new Error(msg) },
}

interface Run { labels: string[]; imuStarted: number; imuStopped: number }

/** Drive a real instance on a virtual clock. `mag` is per-axis head motion. */
async function run(params: Params, seconds: number, mag: number | null): Promise<{ r: Run; note: string; metrics: Record<string, number> }> {
  let t = 0
  const out: Run = { labels: [], imuStarted: 0, imuStopped: 0 }
  const ctx = {
    now: () => t,
    page: {
      curve: async (_p: unknown, _i: number, label?: string) => { if (label) out.labels.push(label) },
    },
    imu: {
      start: async () => { out.imuStarted++ },
      stop: async () => { out.imuStopped++ },
    },
  } as unknown as ExerciseContext

  const inst = def.create(ctx, params)
  await inst.start()

  const endAt = seconds * 1000
  while (t < endAt) {
    const wait = await inst.tick()
    if (wait === 'done') break
    // IMU reports land between ticks, ~6/s, exactly as session.ts throttles them.
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
  const base: Params = { path: 'circle', speed: 4, durationSec: 60, pathDim: 1, blinkEverySec: 0, headTol: 0.6 }

  // 1. Steps stay inside AT2's 300 ms budget at the default speed.
  {
    const { r } = await run(base, 3, null)
    assert.ok(r.imuStarted === 1, 'IMU must be started exactly once')
    assert.ok(r.imuStopped === 1, 'IMU must be stopped on exit (blueprint rule)')
  }

  // 2. No IMU data is NOT a still head. A false 100% would be the worst answer
  //    here: it reports success for a sensor that never spoke.
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

  // 4. A moving head is cued on the strip, and within ~1s of moving (AT5).
  {
    const { r, metrics } = await run(base, 10, 2.0)
    const first = r.labels.findIndex(l => l.startsWith('head still'))
    assert.ok(first >= 0, 'a moving head must raise a named cue')
    // Labels are emitted at most every 2s normally; the cue bypasses that cap,
    // so it must be among the very first things said.
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

  console.log('pursuit.check: 5/5 OK')
}

void main()
