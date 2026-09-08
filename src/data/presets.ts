// Built-in routines. A routine is just an ordered list of exerciseIds with
// optional per-step param overrides — see engine/types.ts Routine.
import type { Routine } from '../engine/types'

export const BUILTIN_ROUTINES: Routine[] = [
  {
    id: 'daily',
    name: 'Daily (all nine)',
    description: 'One pass through every exercise at default settings. ~20-25 min.',
    steps: [
      'nearfar', 'converge', 'brock', 'pursuit', 'saccade',
      'contrast', 'acuity', 'fixation', 'reading',
    ].map(exerciseId => ({ exerciseId })),
    restSeconds: 20,
    builtIn: true,
  },
  {
    id: 'binocular-short',
    name: 'Binocular, short',
    description: 'Both-eyes-open drills only — vergence and fixation. ~10 min.',
    steps: ['nearfar', 'converge', 'brock', 'fixation'].map(exerciseId => ({ exerciseId })),
    restSeconds: 15,
    builtIn: true,
  },
  {
    id: 'monocular-short',
    name: 'Weak eye, short',
    description: 'Cover the strong eye for all of these — acuity, contrast, reading. ~10 min.',
    steps: ['acuity', 'contrast', 'reading'].map(exerciseId => ({ exerciseId })),
    restSeconds: 15,
    builtIn: true,
  },
  {
    id: 'tracking',
    name: 'Tracking',
    description: 'Pursuit and saccades — following and jumping between targets.',
    steps: ['pursuit', 'saccade'].map(exerciseId => ({ exerciseId })),
    restSeconds: 15,
    builtIn: true,
  },
]

export function routineById(id: string): Routine | undefined {
  return BUILTIN_ROUTINES.find(r => r.id === id)
}
