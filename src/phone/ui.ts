// The phone-side WebView UI: pick a routine or a single exercise, watch live
// session status, and control the run in progress. Talks to the engine only
// through engine/session.ts's public API and data/store.ts — never touches
// the bridge directly.
import { EXERCISES, exercise } from '../engine/registry'
import { BUILTIN_ROUTINES } from '../data/presets'
import { settings, setWeakEye, customRoutines, streakDays, totalMinutes, sessionsThisWeek } from '../data/store'
import { startRoutine, pause, resume, skipStep, restartStep, endSession, subscribe, type SessionStatus } from '../engine/session'
import { EXPECTATIONS_PHONE, STOP_RULE } from '../data/copy'
import type { Eye, Params, Routine } from '../engine/types'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  Object.assign(e, props)
  for (const c of children) e.append(c)
  return e
}

function adhocRoutine(exerciseId: string, params?: Partial<Params>): Routine {
  const def = exercise(exerciseId)
  return {
    id: `single-${exerciseId}`,
    name: def?.name ?? exerciseId,
    description: '',
    steps: [{ exerciseId, params }],
    restSeconds: 0,
  }
}

/** Does this exercise let you say where its target lands? */
function placeable(exerciseId: string): boolean {
  const def = exercise(exerciseId)
  if (!def) return false
  const keys = new Set(def.params.map(p => p.key))
  return keys.has('x') && keys.has('y')
}

export function initUI() {
  const app = document.getElementById('app')
  if (!app) return
  app.innerHTML = ''

  const stats = el('p', { className: 'stats' })

  const eyeSelect = el('select', { id: 'weakEye' },
    el('option', { value: 'left', textContent: 'Left' }),
    el('option', { value: 'right', textContent: 'Right' }),
  )
  eyeSelect.value = settings.weakEye
  eyeSelect.addEventListener('change', () => setWeakEye(eyeSelect.value as Eye))
  const eyeRow = el('div', { className: 'row' }, el('label', { textContent: 'Weak eye' }), eyeSelect)

  const phaseText = el('p', { className: 'phase' })
  const labelText = el('p', { className: 'label' })
  const pauseBtn = el('button', { textContent: 'Pause', onclick: () => void pause() })
  const resumeBtn = el('button', { textContent: 'Resume', onclick: () => void resume() })
  const skipBtn = el('button', { textContent: 'Skip', onclick: () => void skipStep() })
  const restartBtn = el('button', { textContent: 'Restart step', onclick: () => void restartStep() })
  const endBtn = el('button', { textContent: 'End session', className: 'danger', onclick: () => void endSession() })
  const statusBox = el('div', { className: 'status', hidden: true }, phaseText, labelText,
    el('div', { className: 'controls' }, pauseBtn, resumeBtn, skipBtn, restartBtn, endBtn))

  // The lens preview. canvas.ts has painted into #preview since it was written —
  // previewTile/previewText/previewDot are called on every page operation — but
  // the element never existed, so previewCtx() returned null and every one of
  // those calls silently did nothing. Mounting the canvas is the whole fix; the
  // rendering was already there. It paints the exact quantised bytes that go to
  // the glasses, in the display green, so this is what the lens shows, not a
  // prettier version of it.
  const preview = el('canvas', { id: 'preview', className: 'preview', width: 576, height: 288 })
  const placeHint = el('p', { className: 'muted', textContent: 'Tap the preview to place the target.' })

  // Where the next placeable exercise puts its target. Null = its own default.
  let placed: { x: number; y: number } | null = null

  function markPlacement() {
    if (!placed) return
    const c = preview.getContext('2d')
    if (!c) return
    // A ring in the lens green, drawn over whatever the preview last painted —
    // this is a phone-side annotation, never sent to the glasses.
    c.strokeStyle = 'rgb(41,240,122)'
    c.lineWidth = 2
    c.beginPath()
    c.arc(placed.x, placed.y, 14, 0, Math.PI * 2)
    c.stroke()
    c.beginPath()
    c.moveTo(placed.x - 20, placed.y); c.lineTo(placed.x + 20, placed.y)
    c.moveTo(placed.x, placed.y - 20); c.lineTo(placed.x, placed.y + 20)
    c.stroke()
  }

  preview.addEventListener('click', (ev) => {
    const r = preview.getBoundingClientRect()
    // The canvas is 576x288 but is laid out at whatever width the phone gives
    // it, so click coordinates have to be scaled back into lens space.
    const x = Math.round(((ev.clientX - r.left) / r.width) * 576)
    const y = Math.round(((ev.clientY - r.top) / r.height) * 288)
    placed = { x, y }
    placeHint.textContent = `Target at ${x}, ${y} — tap to move, or clear.`
    clearPlaceBtn.hidden = false
    markPlacement()
  })

  const clearPlaceBtn = el('button', {
    textContent: 'Centre the target',
    hidden: true,
    onclick: () => {
      placed = null
      placeHint.textContent = 'Tap the preview to place the target.'
      clearPlaceBtn.hidden = true
    },
  })

  const previewBox = el('div', { className: 'preview-box' },
    el('h2', { textContent: 'On the lens' }),
    preview,
    placeHint,
    clearPlaceBtn,
  )

  const routinesList = el('div', { className: 'list' })
  for (const r of [...BUILTIN_ROUTINES, ...customRoutines]) {
    routinesList.append(
      el('div', { className: 'item' },
        el('div', { className: 'item-title' },
          el('strong', { textContent: r.name }),
          el('span', { className: 'muted', textContent: r.description })),
        el('button', { textContent: 'Start', onclick: () => void startRoutine(r) }),
      ),
    )
  }

  const exercisesList = el('div', { className: 'list' })
  for (const def of EXERCISES) {
    const canPlace = placeable(def.id)
    exercisesList.append(
      el('div', { className: 'item' },
        el('div', { className: 'item-title' },
          el('strong', { textContent: def.name }),
          el('span', { className: 'muted', textContent: def.summary }),
          ...(canPlace ? [el('span', { className: 'tag', textContent: 'placeable' })] : [])),
        el('button', {
          textContent: 'Start',
          onclick: () => void startRoutine(
            adhocRoutine(def.id, canPlace && placed ? { x: placed.x, y: placed.y } : undefined),
          ),
        }),
      ),
    )
  }

  app.append(
    el('header', {}, el('h1', { textContent: 'Focus Dots' })),
    el('p', { className: 'hint', textContent: EXPECTATIONS_PHONE[0] }),
    stats,
    eyeRow,
    previewBox,
    statusBox,
    el('h2', { textContent: 'Routines' }), routinesList,
    el('h2', { textContent: 'Individual exercises' }), exercisesList,
    el('p', { className: 'stop-rule', textContent: STOP_RULE }),
  )

  function renderStats() {
    stats.textContent = `${streakDays()}-day streak · ${sessionsThisWeek()} sessions this week · ${totalMinutes()} min total`
  }
  renderStats()

  subscribe((s: SessionStatus) => {
    const active = s.phase !== 'idle'
    statusBox.hidden = !active
    if (active) {
      phaseText.textContent = `${s.exerciseName || s.phase} · step ${s.stepIndex + 1}/${s.stepCount || 1}`
      labelText.textContent = s.label
    } else {
      renderStats()
    }
    pauseBtn.hidden = s.phase !== 'running'
    resumeBtn.hidden = s.phase !== 'paused'
  })
}
