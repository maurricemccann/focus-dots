// Every exercise the app knows. One file per exercise in src/exercises/,
// each exporting `def`. Order here is the order the phone lists them.
import type { ExerciseDef } from './types'
import { def as nearfar } from '../exercises/nearfar'
import { def as converge } from '../exercises/converge'
import { def as brock } from '../exercises/brock'
import { def as pursuit } from '../exercises/pursuit'
import { def as saccade } from '../exercises/saccade'
import { def as contrast } from '../exercises/contrast'
import { def as acuity } from '../exercises/acuity'
import { def as fixation } from '../exercises/fixation'
import { def as reading } from '../exercises/reading'
import { def as freedot } from '../exercises/freedot'

export const EXERCISES: ExerciseDef[] = [
  nearfar, converge, brock, pursuit, saccade,
  contrast, acuity, fixation, freedot, reading,
]

const byId = new Map(EXERCISES.map(e => [e.id, e]))
export function exercise(id: string): ExerciseDef | undefined { return byId.get(id) }
