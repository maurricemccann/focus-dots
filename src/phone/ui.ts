// The phone-side WebView UI: pick a routine or a single exercise, watch live
// session status, and control the run in progress. Talks to the engine only
// through engine/session.ts's public API and data/store.ts — never touches
// the bridge directly.
import { EXERCISES, exercise } from '../engine/registry'
import { BUILTIN_ROUTINES } from '../data/presets'
import { settings, setWeakEye, customRoutines, streakDays, totalMinutes, sessionsThisWeek } from '../data/store'
import { startRoutine, pause, resume, skipStep, restartStep, endSession, subscribe, type SessionStatus } from '../engine/session'
import { EXPECTATIONS_PHONE, STOP_RULE } from '../data/copy'
import type { Eye, Routine } from '../engine/types'

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

function adhocRoutine(exerciseId: string): Routine {
  const def = exercise(exerciseId)
  return { id: `single-${exerciseId}`, name: def?.name ?? exerciseId, description: '', steps: [{ exerciseId }], restSeconds: 0 }
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
    exercisesList.append(
      el('div', { className: 'item' },
        el('div', { className: 'item-title' },
          el('strong', { textContent: def.name }),
          el('span', { className: 'muted', textContent: def.summary })),
        el('button', { textContent: 'Start', onclick: () => void startRoutine(adhocRoutine(def.id)) }),
      ),
    )
  }

  app.append(
    el('header', {}, el('h1', { textContent: 'Focus Dots' })),
    el('p', { className: 'hint', textContent: EXPECTATIONS_PHONE[0] }),
    stats,
    eyeRow,
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
