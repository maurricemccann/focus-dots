// The card chooser that runs on the glasses (founder ruling S276·2997:
// "add some exercises to the glasses and group them so we could have like a
// card or jukebox styled exercise chooser").
//
// Until this, the glasses could only run what the phone started — the idle
// screen literally said "Pick a routine on your phone." The point of a wearable
// is that the phone stays in your pocket.
//
// Cards are text-only, so paging is a cheap rebuild and feels instant. The
// phone keeps the deep parameter editing; this is the jukebox, not the studio.
import { EXERCISES, exercise } from './registry'
import { progress } from '../data/store'
import type { ExerciseDef } from './types'

export interface Group {
  id: string
  name: string
  /** What this group trains, in one line, for the card header. */
  blurb: string
  exerciseIds: string[]
}

/**
 * Three groups, by what the eye is actually being asked to do — which is also
 * how a vision therapist blocks a session, rather than by our file names.
 *
 * Membership is stated here rather than derived from `kind`, because `kind` is
 * monocular/binocular (which eye is working) and that is a different question
 * from what skill is being trained.
 */
export const GROUPS: Group[] = [
  { id: 'track', name: 'Track', blurb: 'follow and jump', exerciseIds: ['pursuit', 'saccade'] },
  { id: 'focus', name: 'Focus', blurb: 'aim and hold', exerciseIds: ['fixation', 'freedot', 'nearfar', 'converge', 'brock'] },
  { id: 'see', name: 'See', blurb: 'resolve detail', exerciseIds: ['acuity', 'contrast', 'reading'] },
]

/** Anything not named in a group still has to be reachable, or it is invisible. */
export function groupsWithStrays(): Group[] {
  const claimed = new Set(GROUPS.flatMap(g => g.exerciseIds))
  const strays = EXERCISES.filter(e => !claimed.has(e.id)).map(e => e.id)
  if (!strays.length) return GROUPS
  return [...GROUPS, { id: 'other', name: 'Other', blurb: 'not yet grouped', exerciseIds: strays }]
}

export function groupExercises(group: Group): ExerciseDef[] {
  return group.exerciseIds.map(id => exercise(id)).filter((d): d is ExerciseDef => !!d)
}

/** The most recent run of this exercise, for the card's footer. */
function lastNote(exerciseId: string): string | null {
  for (let i = progress.length - 1; i >= 0; i--) {
    const hit = progress[i].results.find(r => r.exerciseId === exerciseId)
    if (hit) return hit.note || null
  }
  return null
}

/**
 * One card, as the lens text. Kept to five short lines: the label strip carries
 * the controls, so the card itself only has to say what this is and how it went
 * last time.
 */
export function cardText(group: Group, def: ExerciseDef, index: number, total: number): string {
  const note = lastNote(def.id)
  const mins = Math.max(1, Math.round(def.estimateSeconds(defaultParams(def)) / 60))
  return [
    `${group.name.toUpperCase()} · ${index + 1}/${total}`,
    '',
    def.name,
    def.summary,
    '',
    note ? `last: ${note}` : 'not run yet',
    `about ${mins} min`,
  ].join('\n')
}

function defaultParams(def: ExerciseDef): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const p of def.params) out[p.key] = p.default
  return out
}
