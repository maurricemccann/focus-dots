// The session runner: the ONE loop that drives an exercise. Exercises return
// how long to wait from tick(); the runner sleeps interruptibly, drains input
// between ticks, and moves through instruction -> running -> rest -> summary.
// It never sends from a timer of its own; every send is inside a tick or an
// input handler, and every bridge call is serialised in bridge.ts regardless.
import { page, setMenu } from '../glasses/page'
import { imu, storageFlush, onGlassesEvent, requestExit, type GlassesEvent } from '../glasses/bridge'
import { exercise } from './registry'
import { defaultsFor, otherEye, type ExerciseInstance, type ExerciseResult, type Input, type Routine, type SessionRecord } from './types'
import { settings, saveSettings, addSession } from '../data/store'
import { EXPECTATIONS_LENS, LABEL, patchCue, patchOffCue } from '../data/copy'
import { groupsWithStrays, groupExercises, cardText } from './jukebox'

export type Phase = 'idle' | 'browse' | 'expectations' | 'instruction' | 'running' | 'paused' | 'rest' | 'summary'

export interface SessionStatus {
  phase: Phase
  routine: Routine | null
  stepIndex: number
  stepCount: number
  exerciseName: string
  label: string
  results: ExerciseResult[]
}

const MENU = [
  { itemID: 1, itemName: 'Pause' },
  { itemID: 2, itemName: 'Resume' },
  { itemID: 3, itemName: 'Skip' },
  { itemID: 4, itemName: 'Restart' },
  { itemID: 5, itemName: 'End session' },
]
const BROWSE_MENU = groupsWithStrays().map((g, i) => ({ itemID: 100 + i, itemName: g.name }))
setMenu(MENU)

// ── The jukebox (browse phase) ────────────────────────────────────────────
// Swipe pages the cards, tap starts, the menu jumps between groups.
let groupIndex = 0
let cardIndex = 0

async function showCard() {
  const groups = groupsWithStrays()
  groupIndex = ((groupIndex % groups.length) + groups.length) % groups.length
  const group = groups[groupIndex]
  const defs = groupExercises(group)
  if (!defs.length) { await toIdle(); return }
  cardIndex = ((cardIndex % defs.length) + defs.length) % defs.length
  phase = 'browse'
  routine = null
  lastLabel = LABEL_BROWSE
  await page.text(cardText(group, defs[cardIndex], cardIndex, defs.length), LABEL_BROWSE)
  emit()
}

const LABEL_BROWSE = 'swipe to browse · tap to start'

export async function showBrowse() {
  await endCurrent(false)
  setMenu(BROWSE_MENU)
  await showCard()
}

async function startCard() {
  const groups = groupsWithStrays()
  const defs = groupExercises(groups[groupIndex])
  const def = defs[cardIndex]
  if (!def) return
  setMenu(MENU)
  await startRoutine({
    id: `card-${def.id}`, name: def.name, description: '',
    steps: [{ exerciseId: def.id }], restSeconds: 0,
  })
}

let phase: Phase = 'idle'
let routine: Routine | null = null
let stepIndex = 0
let instance: ExerciseInstance | null = null
let results: ExerciseResult[] = []
let sessionStart = 0
let stepStart = 0
let inputQueue: Input[] = []
let wake: (() => void) | null = null
let runToken = 0
const listeners = new Set<(s: SessionStatus) => void>()

export function subscribe(cb: (s: SessionStatus) => void): () => void {
  listeners.add(cb)
  cb(status())
  return () => { listeners.delete(cb) }
}
export function status(): SessionStatus {
  const def = routine ? exercise(routine.steps[stepIndex]?.exerciseId) : undefined
  return {
    phase, routine, stepIndex, stepCount: routine?.steps.length ?? 0,
    exerciseName: def?.name ?? '', label: lastLabel, results: [...results],
  }
}
let lastLabel = ''
function emit() { const s = status(); for (const l of listeners) l(s) }

function interruptibleSleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    const t = setTimeout(() => { wake = null; resolve() }, ms)
    wake = () => { clearTimeout(t); wake = null; resolve() }
  })
}
function nudge() { wake?.() }

// ── Public API (phone UI + glasses events both land here) ──────────────────

export async function startRoutine(r: Routine) {
  await endCurrent(false)
  routine = r
  stepIndex = 0
  results = []
  sessionStart = Date.now()
  if (!settings.expectationsSeen) {
    phase = 'expectations'
    await page.text(EXPECTATIONS_LENS, LABEL.tapToContinue)
    emit()
    return
  }
  await showInstruction()
}

export async function endSession() {
  if (phase === 'idle') return
  await endCurrent(false)
  await showSummary()
}

export async function pause() {
  if (phase !== 'running') return
  phase = 'paused'
  nudge()
  lastLabel = LABEL.paused
  await page.setLabel(LABEL.paused)
  emit()
}

export async function resume() {
  if (phase !== 'paused' || !instance) return
  phase = 'running'
  emit()
  void runLoop(runToken)
}

export async function skipStep() {
  if (phase !== 'running' && phase !== 'paused' && phase !== 'instruction') return
  await finishStep(false)
}

export async function restartStep() {
  if (phase !== 'running' && phase !== 'paused' && phase !== 'instruction') return
  await stopInstance()
  await beginStep()
}

export function currentPhase() { return phase }

// ── Internals ──────────────────────────────────────────────────────────────

async function showInstruction() {
  if (!routine) return
  const step = routine.steps[stepIndex]
  const def = exercise(step.exerciseId)
  if (!def) { await finishStep(false); return }
  phase = 'instruction'
  const lines = [
    `${stepIndex + 1}/${routine.steps.length}  ${def.name}`,
    def.kind === 'monocular' ? patchCue(settings.weakEye) : patchOffCue(),
    ...def.instructions(settings.weakEye).slice(0, 5),
  ]
  lastLabel = LABEL.tapToBegin
  await page.text(lines.join('\n'), LABEL.tapToBegin)
  emit()
}

async function beginStep() {
  if (!routine) return
  const step = routine.steps[stepIndex]
  const def = exercise(step.exerciseId)
  if (!def) { await finishStep(false); return }
  const params = defaultsFor(def, step.params)
  const weakEye = settings.weakEye
  instance = def.create({
    page,
    weakEye,
    strongEye: otherEye(weakEye),
    imu: { start: () => imu.start(), stop: () => imu.stop() },
    now: () => performance.now(),
  }, params)
  inputQueue = []
  stepStart = Date.now()
  phase = 'running'
  lastLabel = LABEL.step(stepIndex + 1, routine.steps.length, def.name)
  emit()
  const token = ++runToken
  try {
    await instance.start()
  } catch (e) {
    console.error('[FocusDots] exercise start failed', e)
    await finishStep(false)
    return
  }
  void runLoop(token)
}

async function runLoop(token: number) {
  const inst = instance
  if (!inst) return
  while (phase === 'running' && instance === inst && token === runToken) {
    // Drain input first so a tap lands before the next frame, not after it.
    while (inputQueue.length && phase === 'running' && instance === inst) {
      const input = inputQueue.shift()!
      try { await inst.onInput(input) } catch (e) { console.error('[FocusDots] onInput', e) }
    }
    if (phase !== 'running' || instance !== inst || token !== runToken) break
    let wait: number | 'done'
    try { wait = await inst.tick() } catch (e) { console.error('[FocusDots] tick', e); wait = 'done' }
    if (phase !== 'running' || instance !== inst || token !== runToken) break
    if (wait === 'done') { await finishStep(true); return }
    await interruptibleSleep(Math.max(50, wait))
  }
}

async function stopInstance() {
  const inst = instance
  instance = null
  runToken++
  nudge()
  if (inst) { try { await inst.stop() } catch { /* already down */ } }
  await imu.stop()
}

async function finishStep(completed: boolean) {
  if (!routine) return
  const inst = instance
  await stopInstance()
  if (inst) {
    let r: ExerciseResult
    try { r = inst.result() } catch {
      r = { exerciseId: routine.steps[stepIndex].exerciseId, completed: false, durationMs: 0, metrics: {} }
    }
    r.completed = completed && r.completed
    r.durationMs = Date.now() - stepStart
    results.push(r)
  }
  stepIndex++
  if (stepIndex >= routine.steps.length) { await showSummary(); return }
  await rest()
}

async function rest() {
  if (!routine) return
  const secs = Math.max(0, routine.restSeconds ?? settings.restSeconds)
  phase = 'rest'
  emit()
  const token = ++runToken
  for (let s = secs; s > 0 && phase === 'rest' && token === runToken; s--) {
    lastLabel = LABEL.rest(s)
    if (s === secs) await page.text('Rest.\nBlink. Look far away.\nBreathe.', lastLabel)
    else await page.setLabel(lastLabel)
    await interruptibleSleep(1000)
  }
  if (phase === 'rest' && token === runToken) await showInstruction()
}

async function showSummary() {
  if (!routine) return
  phase = 'summary'
  const done = results.filter(r => r.completed).length
  const totalMs = Date.now() - sessionStart
  const rec: SessionRecord = { at: sessionStart, routineId: routine.id, routineName: routine.name, results: [...results], totalMs }
  if (results.length) addSession(rec)
  const mins = Math.max(1, Math.round(totalMs / 60_000))
  const lines = [
    'Session complete.',
    `${done} of ${routine.steps.length} exercises done · ${mins} min`,
    '',
    'Same time tomorrow.',
    'Consistency is the whole method.',
  ]
  lastLabel = LABEL.tapToContinue
  await page.text(lines.join('\n'), LABEL.tapToContinue)
  emit()
  await storageFlush()
}

async function endCurrent(keepResults: boolean) {
  await stopInstance()
  if (!keepResults) { results = [] }
  phase = 'idle'
  emit()
}

async function toIdle() {
  await endCurrent(false)
  routine = null
  lastLabel = ''
  // Idle opens the jukebox rather than sending you to the phone. The lens used
  // to say "Pick a routine on your phone." on a device whose whole point is
  // that the phone stays in your pocket.
  setMenu(BROWSE_MENU)
  await showCard()
}

// ── Glasses input ─────────────────────────────────────────────────────────

let lastImuAt = 0
function queueInput(i: Input) {
  if (i.type === 'imu') {
    const now = performance.now()
    if (now - lastImuAt < 150) return          // ≤ ~6/s; the exercise only needs a trend
    lastImuAt = now
    const j = inputQueue.findIndex(q => q.type === 'imu')
    if (j >= 0) inputQueue[j] = i; else inputQueue.push(i)
  } else {
    inputQueue.push(i)
  }
  nudge()
}

async function onEvent(e: GlassesEvent) {
  switch (e.kind) {
    case 'menu': {
      if (e.itemID >= 100) {
        groupIndex = e.itemID - 100
        cardIndex = 0
        await showBrowse()
        return
      }
      if (e.itemID === 1) await pause()
      else if (e.itemID === 2) await resume()
      else if (e.itemID === 3) await skipStep()
      else if (e.itemID === 4) await restartStep()
      else if (e.itemID === 5) await endSession()
      return
    }
    case 'doubleTap':
      await requestExit()
      return
    case 'exit':
      await stopInstance()
      await storageFlush()
      return
    case 'fgExit':
      if (phase === 'running') await pause()
      await storageFlush()
      return
    case 'fgEnter':
      return
    case 'imu':
      if (phase === 'running') queueInput({ type: 'imu', x: e.x, y: e.y, z: e.z })
      return
    case 'tap':
      if (phase === 'expectations') {
        saveSettings({ expectationsSeen: true })
        await showInstruction()
      } else if (phase === 'instruction') {
        await beginStep()
      } else if (phase === 'paused') {
        await resume()
      } else if (phase === 'rest') {
        runToken++; nudge()
        await showInstruction()
      } else if (phase === 'summary') {
        await toIdle()
      } else if (phase === 'browse') {
        await startCard()
      } else if (phase === 'running') {
        queueInput({ type: 'tap' })
      }
      return
    // While an exercise runs, swipes belong to the exercise (acuity answers
    // up/down with them). Skip/restart live on the menu during a run.
    case 'down':
      if (phase === 'browse') { cardIndex++; await showCard(); return }
      if (phase === 'running') queueInput({ type: 'down' })
      else if (phase === 'paused' || phase === 'instruction') await skipStep()
      else if (phase === 'expectations') { saveSettings({ expectationsSeen: true }); await showInstruction() }
      return
    case 'up':
      if (phase === 'browse') { cardIndex--; await showCard(); return }
      if (phase === 'running') queueInput({ type: 'up' })
      else if (phase === 'paused') await restartStep()
      return
  }
}

let unsubscribe: (() => void) | null = null
export function attachGlassesEvents() {
  unsubscribe?.()
  unsubscribe = onGlassesEvent(e => { void onEvent(e) })
}

export async function showIdle() { await toIdle() }
export async function showExpectations() {
  await endCurrent(false)
  phase = 'expectations'
  routine = null
  await page.text(EXPECTATIONS_LENS, LABEL.tapToContinue)
  emit()
}
