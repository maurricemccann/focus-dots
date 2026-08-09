import './style.css'
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
} from '@evenrealities/even_hub_sdk'

// Focus Dots — a slow, turn-based fixation drill for eye-muscle strain and
// alignment work. Two exercises, swipe to switch, double-tap to exit:
//   near/far  — accommodation: alternates gaze between a near-positioned and
//               far-positioned target, relaxing the focusing muscles.
//   converge  — two dots whose gap narrows each step (a Brock-string-style
//               fusion drill), resets once it hits the minimum gap.
// Not a substitute for professional vision care — general fixation practice.

type Mode = 'nearfar' | 'converge'

const bridge = await waitForEvenAppBridge()

let started = false
let mode: Mode = 'nearfar'
let intervalSec = 4
let totalReps = 20
let step = 0
let timer: ReturnType<typeof setInterval> | null = null

const CONVERGE_MAX_GAP = 260
const CONVERGE_MIN_GAP = 20
const CONVERGE_STEP_SIZE = 40

function nearFarContainers(): TextContainerProperty[] {
  const isNear = step % 2 === 0
  const dot = new TextContainerProperty({
    xPosition: 0,
    yPosition: isNear ? 140 : 0,
    width: 576,
    height: 148,
    borderWidth: 0,
    borderColor: 15,
    paddingLength: 8,
    containerID: 1,
    containerName: 'dot',
    content: isNear ? '●' : '·',
  })
  const label = new TextContainerProperty({
    xPosition: 0,
    yPosition: 248,
    width: 576,
    height: 40,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 8,
    containerID: 2,
    containerName: 'label',
    content: `${isNear ? 'NEAR' : 'FAR'} — hold — ${step + 1}/${totalReps}`,
    isEventCapture: 1, // real bug found live: no container here meant swipe/double-tap were silently dropped once a session started
  })
  return [dot, label]
}

function convergeContainers(): TextContainerProperty[] {
  // Sawtooth: gap narrows toward the minimum, then resets to max — a
  // repeating "bring the dots together" cycle rather than a one-shot drill.
  const cycleSteps = Math.ceil((CONVERGE_MAX_GAP - CONVERGE_MIN_GAP) / CONVERGE_STEP_SIZE) + 1
  const cyclePos = step % cycleSteps
  const gap = Math.max(CONVERGE_MIN_GAP, CONVERGE_MAX_GAP - cyclePos * CONVERGE_STEP_SIZE)
  const center = 288
  const left = new TextContainerProperty({
    xPosition: Math.round(center - gap / 2 - 30),
    yPosition: 120,
    width: 60,
    height: 60,
    borderWidth: 0,
    borderColor: 15,
    paddingLength: 4,
    containerID: 1,
    containerName: 'left',
    content: '●',
  })
  const right = new TextContainerProperty({
    xPosition: Math.round(center + gap / 2 - 30),
    yPosition: 120,
    width: 60,
    height: 60,
    borderWidth: 0,
    borderColor: 15,
    paddingLength: 4,
    containerID: 2,
    containerName: 'right',
    content: '●',
  })
  const label = new TextContainerProperty({
    xPosition: 0,
    yPosition: 248,
    width: 576,
    height: 40,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 8,
    containerID: 3,
    containerName: 'label',
    content: `Converge — ${step + 1}/${totalReps}`,
    isEventCapture: 1,
  })
  return [left, right, label]
}

function idleContainers(content: string): TextContainerProperty[] {
  return [
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      borderColor: 15,
      paddingLength: 8,
      containerID: 1,
      containerName: 'main',
      content,
      isEventCapture: 1,
    }),
  ]
}

async function push(textObject: TextContainerProperty[]) {
  const payload = { containerTotalNum: textObject.length, textObject }
  if (started) {
    await bridge.rebuildPageContainer(new RebuildPageContainer(payload))
  } else {
    await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(payload))
    started = true
  }
}

async function render() {
  await push(mode === 'nearfar' ? nearFarContainers() : convergeContainers())
}

function stopTimer() {
  if (timer) clearInterval(timer)
  timer = null
}

async function advance() {
  step += 1
  if (step >= totalReps) {
    stopTimer()
    await push(idleContainers('Session complete. Double-tap to exit.'))
    return
  }
  await render()
}

async function startSession(m: Mode, seconds: number, reps: number) {
  mode = m
  intervalSec = Math.max(2, seconds)
  totalReps = Math.max(4, reps)
  step = 0
  stopTimer()
  await render()
  timer = setInterval(() => { void advance() }, intervalSec * 1000)
}

bridge.onEvenHubEvent(async (event: any) => {
  if (event.textEvent) {
    const type = event.textEvent.eventType ?? 0
    // swipe (either direction) toggles between the two exercises, mid-session
    if (type === 1 || type === 2) {
      mode = mode === 'nearfar' ? 'converge' : 'nearfar'
      step = 0
      await render()
    }
    return
  }
  if (event.sysEvent) {
    const type = event.sysEvent.eventType ?? 0
    if (type === 3) {
      stopTimer()
      await bridge.shutDownPageContainer(1) // double-tap — exit
    }
  }
})

await push(idleContainers('Focus Dots — start a session on your phone.'))

const modeSelect = document.querySelector<HTMLSelectElement>('#mode')!
const intervalInput = document.querySelector<HTMLInputElement>('#interval')!
const repsInput = document.querySelector<HTMLInputElement>('#reps')!
const startBtn = document.querySelector<HTMLButtonElement>('#start')!
const stopBtn = document.querySelector<HTMLButtonElement>('#stop')!
const status = document.querySelector<HTMLParagraphElement>('#status')!

startBtn.addEventListener('click', async () => {
  const m = modeSelect.value as Mode
  const seconds = Number(intervalInput.value) || 4
  const reps = Number(repsInput.value) || 20
  await startSession(m, seconds, reps)
  status.textContent = `Running ${m === 'nearfar' ? 'Near / Far' : 'Converge / Diverge'} — ${reps} reps at ${seconds}s.`
})

stopBtn.addEventListener('click', async () => {
  stopTimer()
  await push(idleContainers('Session stopped.'))
  status.textContent = 'Stopped.'
})

// ponytail: test-only entry point, same pattern as cue-sheet/teleprompter —
// the simulator drives glasses-side gestures but not phone-DOM clicks, so
// ?autotest=<mode>[:<intervalSec>:<reps>] exercises startSession() headlessly.
const testParams = new URLSearchParams(location.search)
const autotest = testParams.get('autotest')
if (autotest) {
  const [m, s, r] = autotest.split(':')
  void startSession((m as Mode) || 'nearfar', Number(s) || 2, Number(r) || 6)
}
