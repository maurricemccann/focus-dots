// Every user-facing sentence that is not exercise-specific. Plain, direct,
// functional. No hype, no promises, no medical claims.
import type { Eye } from '../engine/types'
import { otherEye } from '../engine/types'

// Shown on the lenses on first run, and any time from About. Short lines —
// the lenses hold about 8 lines of firmware text.
export const EXPECTATIONS_LENS = [
  'Training, not treatment.',
  'These drills work the coordination',
  'of your eyes and the engagement of',
  'the weaker one. They do not cure',
  'amblyopia. Not a medical device.',
  'Consistency beats intensity:',
  '5-30 min a day. Most notice change',
  'after ~2 weeks. Tap to continue.',
].join('\n')

// The long form, on the phone.
export const EXPECTATIONS_PHONE = [
  'This is training, not treatment. It is not a medical device and it does not cure amblyopia (lazy eye). What it does is give the weaker eye regular, deliberate work: fixation, convergence, contrast, tracking — the same drills vision therapists assign as homework.',
  'Expect slow change. Exercises alone are not enough to eliminate amblyopia; they work best alongside what an optometrist prescribes (patching, lenses, in-office therapy). Improvement takes weeks to months. Most people who stick with daily practice notice something after about two weeks.',
  'Consistency beats intensity. Five to thirty minutes a day, every day, does more than an hour once a week. Split it into two or three short sessions if that is easier.',
  'Stop if you get a headache, eye pain, dizziness, or double vision that does not clear when you stop. Those are signals to rest and, if they persist, to see an optometrist.',
  'The glasses show both eyes the same image. Exercises marked "one eye" ask you to cover your stronger eye with your hand or a patch — the app cannot do that for you.',
  'Work under a registered vision therapist or optometrist. This is what you do between their appointments, not instead of them. It was built by someone with amblyopia, not by a clinician.',
]

export const STOP_RULE = 'Stop if you get a headache, eye pain, dizziness, or double vision that lingers.'

export function patchCue(weakEye: Eye): string {
  return `Cover your ${otherEye(weakEye).toUpperCase()} eye.`
}
export function patchOffCue(): string {
  return 'Both eyes open. Nothing covered.'
}

export const GLASSES_CONTROLS = [
  ['Tap', 'begin · continue · answer'],
  ['Swipe down', 'skip this exercise'],
  ['Swipe up', 'restart this exercise'],
  ['Tap, then long press', 'menu: pause · skip · restart · end'],
  ['Double tap', 'exit'],
] as const

// These strings go to the LENS, so they are ASCII plus the two glyphs
// BLUEPRINT.md confirms are in the firmware font (`·` and `●`). Em dashes were
// being dropped silently — `rest` in particular redraws every second of every
// rest period, so the gap where the dash should be was the most-seen defect in
// the app. The middle dots elsewhere in this file are fine and deliberate.
export const LABEL = {
  tapToBegin: 'tap to begin',
  tapToContinue: 'tap to continue',
  paused: 'paused · tap to resume',
  rest: (s: number) => `rest ${s}s · tap to skip`,
  step: (i: number, n: number, name: string) => `${i}/${n} ${name}`,
}
