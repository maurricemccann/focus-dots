// Settings, custom routines and progress. Durable copy lives in the glasses'
// storage (BLE, capped reads, debounced writes — see bridge.ts); the WebView's
// localStorage mirrors it so the phone UI never waits on the link.
import { storageGet, storageSet, storageFlush } from '../glasses/bridge'
import type { Settings, Routine, SessionRecord, Eye } from '../engine/types'

const KEY = {
  settings: 'fd.settings',
  routines: 'fd.routines',
  progress: 'fd.progress',
} as const

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  weakEye: 'left',
  restSeconds: 20,
  expectationsSeen: false,
  brightness: 4,
}

export let settings: Settings = { ...DEFAULT_SETTINGS }
export let customRoutines: Routine[] = []
export let progress: SessionRecord[] = []

const MAX_SESSIONS = 300

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

/** Never on the startup path before the page exists — the page goes up first, then this fills in. */
export async function loadAll() {
  const [s, r, p] = await Promise.all([
    storageGet(KEY.settings),
    storageGet(KEY.routines),
    storageGet(KEY.progress),
  ])
  const loaded = parse<Partial<Settings>>(s, {})
  settings = { ...DEFAULT_SETTINGS, ...loaded, version: 1 }
  if (settings.weakEye !== 'left' && settings.weakEye !== 'right') settings.weakEye = 'left'
  customRoutines = parse<Routine[]>(r, []).filter(x => x && typeof x.id === 'string' && Array.isArray(x.steps))
  progress = parse<SessionRecord[]>(p, []).filter(x => x && typeof x.at === 'number')
}

export function saveSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch }
  storageSet(KEY.settings, JSON.stringify(settings))
}

export function setWeakEye(eye: Eye) { saveSettings({ weakEye: eye }) }

export function saveRoutine(routine: Routine) {
  const i = customRoutines.findIndex(r => r.id === routine.id)
  if (i >= 0) customRoutines[i] = routine
  else customRoutines.push(routine)
  storageSet(KEY.routines, JSON.stringify(customRoutines), 300)
}

export function deleteRoutine(id: string) {
  customRoutines = customRoutines.filter(r => r.id !== id)
  storageSet(KEY.routines, JSON.stringify(customRoutines), 300)
}

export function addSession(rec: SessionRecord) {
  progress.push(rec)
  if (progress.length > MAX_SESSIONS) progress = progress.slice(progress.length - MAX_SESSIONS)
  storageSet(KEY.progress, JSON.stringify(progress), 300)
}

export function flush() { return storageFlush() }

// ── Derived views for the progress screen ─────────────────────────────────

function dayKey(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Consecutive days with at least one completed session, counting back from today (or yesterday if nothing today). */
export function streakDays(now = Date.now()): number {
  if (!progress.length) return 0
  const days = new Set(progress.map(p => dayKey(p.at)))
  const DAY = 86_400_000
  let cursor = now
  if (!days.has(dayKey(cursor))) cursor -= DAY
  let n = 0
  while (days.has(dayKey(cursor))) { n++; cursor -= DAY }
  return n
}

export function totalMinutes(): number {
  return Math.round(progress.reduce((a, p) => a + p.totalMs, 0) / 60_000)
}

/** Time series of one metric for one exercise, oldest first. */
export function metricSeries(exerciseId: string, metric: string): { at: number; value: number }[] {
  const out: { at: number; value: number }[] = []
  for (const s of progress) {
    for (const r of s.results) {
      if (r.exerciseId === exerciseId && r.completed && typeof r.metrics[metric] === 'number') {
        out.push({ at: s.at, value: r.metrics[metric] })
      }
    }
  }
  return out
}

export function sessionsThisWeek(now = Date.now()): number {
  const since = now - 7 * 86_400_000
  return progress.filter(p => p.at >= since).length
}
