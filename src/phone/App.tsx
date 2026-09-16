// The phone UI, built on even-toolkit (founder ruling S276·2997: scaffold it
// on the toolkit properly). Talks to the engine only through session.ts's
// public API and data/store.ts — it never touches the bridge, exactly as the
// vanilla UI did. BLUEPRINT.md's "one serial owner of every bridge call" is
// unchanged by this; React owns the phone screen, not the glasses.
import { useEffect, useRef, useState } from 'react'
import {
  AppShell,
  Button,
  Card,
  ListItem,
  ScreenHeader,
  SectionHeader,
  SegmentedControl,
  SettingsGroup,
} from 'even-toolkit/web'
import { EXERCISES, exercise } from '../engine/registry'
import { BUILTIN_ROUTINES } from '../data/presets'
import {
  settings, setWeakEye, customRoutines, streakDays, totalMinutes, sessionsThisWeek,
} from '../data/store'
import {
  startRoutine, pause, resume, skipStep, restartStep, endSession, subscribe,
  type SessionStatus,
} from '../engine/session'
import { EXPECTATIONS_PHONE, STOP_RULE } from '../data/copy'
import { GROUPS } from '../engine/jukebox'
import { previewFor } from './previews'
import { glyphLevels } from '../glasses/glyph-screen'
import { setLiveTarget } from '../data/live'
import type { Eye, Params, Routine } from '../engine/types'

const SCREEN_W = 576
const SCREEN_H = 288

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

/**
 * A thumbnail of what this exercise puts on the lens.
 *
 * Founder: "I kinda need a little preview of the exercise next to it so we're
 * not going in blind." Drawn with the same Glyph primitives as the real
 * stimulus, phone-side only — it never touches the bridge, so it costs nothing
 * and cannot disturb a run. An icon would not tell you whether a drill shows a
 * shrinking letter or a moving ball; a miniature does.
 */
function ExerciseThumb({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const W = 132, H = 66

  useEffect(() => {
    const draw = previewFor(id)
    const el = ref.current
    if (!draw || !el) return
    let cancelled = false
    void (async () => {
      const levels = await glyphLevels(g => draw(g, W, H), { width: W, height: H })
      if (cancelled) return
      const c = el.getContext('2d')
      if (!c) return
      const img = c.createImageData(W, H)
      for (let i = 0, o = 0; i < levels.length; i++, o += 4) {
        const k = levels[i] / 15
        img.data[o] = 41 * k
        img.data[o + 1] = 240 * k
        img.data[o + 2] = 122 * k
        img.data[o + 3] = 255
      }
      c.putImageData(img, 0, 0)
    })()
    return () => { cancelled = true }
  }, [id])

  if (!previewFor(id)) return null
  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      className="rounded bg-black"
      style={{ width: 88, height: 44 }}
      aria-hidden="true"
    />
  )
}

/**
 * The lens preview.
 *
 * canvas.ts paints the exact quantised bytes that are sent to the glasses into
 * `#preview`, so this is what the lens shows, not a prettier render. The canvas
 * must keep that id and its real 576x288 backing size — React only gives it a
 * home and a tap handler.
 */
function LensPreview({ placed, onPlace, onClear }: {
  placed: { x: number; y: number } | null
  onPlace: (p: { x: number; y: number }) => void
  onClear: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  // Re-draw the placement marker whenever it moves. It is a phone-side
  // annotation over whatever the preview last painted — never sent to the lens.
  useEffect(() => {
    const c = ref.current?.getContext('2d')
    if (!c || !placed) return
    c.strokeStyle = 'rgb(41,240,122)'
    c.lineWidth = 2
    c.beginPath()
    c.arc(placed.x, placed.y, 14, 0, Math.PI * 2)
    c.stroke()
    c.beginPath()
    c.moveTo(placed.x - 20, placed.y); c.lineTo(placed.x + 20, placed.y)
    c.moveTo(placed.x, placed.y - 20); c.lineTo(placed.x, placed.y + 20)
    c.stroke()
  }, [placed])

  return (
    <div className="space-y-2">
      <canvas
        id="preview"
        ref={ref}
        width={SCREEN_W}
        height={SCREEN_H}
        // Capped rather than full-width: the lens is 2:1, so on anything wider
        // than a phone an unconstrained preview grows to fill the page and
        // pushes the exercise list off the bottom.
        className="block w-full h-auto max-w-[520px] mx-auto rounded-md bg-black cursor-crosshair"
        style={{ aspectRatio: '2 / 1', touchAction: 'manipulation' }}
        onClick={(ev) => {
          const el = ref.current
          if (!el) return
          const r = el.getBoundingClientRect()
          // The canvas is 576x288 but laid out at whatever width the phone
          // gives it, so clicks scale back into lens space.
          onPlace({
            x: Math.round(((ev.clientX - r.left) / r.width) * SCREEN_W),
            y: Math.round(((ev.clientY - r.top) / r.height) * SCREEN_H),
          })
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs opacity-70">
          {placed ? `Target at ${placed.x}, ${placed.y} — tap to move.` : 'Tap the preview to place the target.'}
        </p>
        {placed && <Button variant="ghost" size="sm" onClick={onClear}>Centre</Button>}
      </div>
    </div>
  )
}

export function App() {
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [placed, setPlaced] = useState<{ x: number; y: number } | null>(null)
  const [eye, setEye] = useState<Eye>(settings.weakEye)
  const [group, setGroup] = useState<string>(GROUPS[0].id)

  useEffect(() => subscribe(setStatus), [])

  const active = !!status && status.phase !== 'idle' && status.phase !== 'browse'
  const groupIds = new Set(GROUPS.find(g => g.id === group)?.exerciseIds ?? [])
  const shown = EXERCISES.filter(d => groupIds.has(d.id))

  return (
    <AppShell
      header={
        <ScreenHeader
          title="Focus Dots"
          subtitle={`${streakDays()}-day streak · ${sessionsThisWeek()} this week · ${totalMinutes()} min`}
        />
      }
      footer={<p className="px-4 py-2 text-xs opacity-60">{STOP_RULE}</p>}
    >
      <div className="space-y-5 p-4">
        <p className="text-sm opacity-75">{EXPECTATIONS_PHONE[0]}</p>

        <SettingsGroup label="Weak eye">
          <SegmentedControl
            options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]}
            value={eye}
            onValueChange={(v) => { setEye(v as Eye); setWeakEye(v as Eye) }}
          />
        </SettingsGroup>

        <div>
          <SectionHeader title="On the lens" />
          <Card padding="default">
            <LensPreview
              placed={placed}
              onPlace={(p) => {
                setPlaced(p)
                // Also moves a Free Dot that is running right now — that is the
                // whole point of that exercise, so the tap does both.
                setLiveTarget(p)
              }}
              onClear={() => setPlaced(null)}
            />
          </Card>
        </div>

        {active && status && (
          <Card padding="default">
            <p className="font-semibold">
              {status.exerciseName || status.phase} · step {status.stepIndex + 1}/{status.stepCount || 1}
            </p>
            <p className="text-sm opacity-70">{status.label}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {status.phase === 'running' && <Button size="sm" onClick={() => void pause()}>Pause</Button>}
              {status.phase === 'paused' && <Button size="sm" onClick={() => void resume()}>Resume</Button>}
              <Button size="sm" variant="secondary" onClick={() => void skipStep()}>Skip</Button>
              <Button size="sm" variant="secondary" onClick={() => void restartStep()}>Restart</Button>
              <Button size="sm" variant="danger" onClick={() => void endSession()}>End</Button>
            </div>
          </Card>
        )}

        <div>
          <SectionHeader title="Exercises" />
          <SegmentedControl
            options={GROUPS.map(g => ({ value: g.id, label: g.name }))}
            value={group}
            onValueChange={setGroup}
            size="small"
          />
          <div className="mt-3 space-y-2">
            {shown.map(def => (
              <ListItem
                key={def.id}
                title={def.name}
                subtitle={def.summary}
                leading={<ExerciseThumb id={def.id} />}
                trailing={
                  <Button
                    size="sm"
                    onClick={() => void startRoutine(
                      adhocRoutine(def.id, placeable(def.id) && placed ? { x: placed.x, y: placed.y } : undefined),
                    )}
                  >
                    Start
                  </Button>
                }
              />
            ))}
          </div>
        </div>

        <div>
          <SectionHeader title="Routines" />
          <div className="space-y-2">
            {[...BUILTIN_ROUTINES, ...customRoutines].map(r => (
              <ListItem
                key={r.id}
                title={r.name}
                subtitle={r.description}
                trailing={<Button size="sm" onClick={() => void startRoutine(r)}>Start</Button>}
              />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
