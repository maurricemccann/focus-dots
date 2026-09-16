// The exercise contract. Every exercise in src/exercises/ is built against
// exactly this and nothing else — it never touches the SDK bridge directly.
// See BLUEPRINT.md for the hardware rules that shaped these shapes.

export type Eye = 'left' | 'right'
export type ExerciseKind = 'binocular' | 'monocular'

export type ParamSpec =
  | { key: string; label: string; type: 'number'; default: number; min: number; max: number; step: number; unit?: string; help?: string }
  | { key: string; label: string; type: 'select'; default: string; options: { value: string; label: string }[]; help?: string }
  | { key: string; label: string; type: 'boolean'; default: boolean; help?: string }

export type Params = Record<string, number | string | boolean>

export type Input =
  | { type: 'tap' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'imu'; x: number; y: number; z: number }

export interface ExerciseResult {
  exerciseId: string
  completed: boolean
  durationMs: number
  // Numbers the progress screen can chart over time, keyed by a short name
  // (e.g. contrastThreshold, minGapReached, steadinessPct).
  metrics: Record<string, number>
  note?: string
}

export type DotSize = 'small' | 'medium' | 'large'
export interface Dot {
  x: number          // centre, 0-576
  y: number          // centre, 0-256 (keep clear of the label strip at y >= 260)
  size: DotSize      // large '●', medium 'o', small '·' — text size is fixed by firmware
  bright?: 1 | 2 | 3 | 4
}

// Everything an exercise can put on the lenses. Implemented by src/glasses/page.ts.
export interface PageApi {
  /** Full-screen text (instruction / rest / summary). Text layout. */
  text(content: string, label?: string): Promise<void>
  /**
   * A dim path with one bright ball on it. Curve layout.
   * `points` are normalised 0-1; `ballIndex` walks along them. Text-only, so a
   * step is a fast rebuild — the path is redrawn intact each time rather than
   * being occluded by the ball's own container.
   */
  curve(points: { x: number; y: number }[], ballIndex: number, label?: string, dim?: 1 | 2 | 3 | 4): Promise<void>
  /** Up to 6 positioned dots. Dots layout. Re-positioning is a rebuild — fine at a few per second, not per frame. */
  dots(dots: Dot[], label: string): Promise<void>
  /** Move a target on the tracer layout: row 0-4 (top to bottom), col 0-95 (left to right). Near-free. */
  tracer(row: number, col: number, label?: string, mark?: string): Promise<void>
  /** Blank every tracer row. */
  clearTracer(): Promise<void>
  /**
   * Draw a stimulus with canvas 2D and send it as 4 image tiles. Image layout.
   * Costs 2-8 s per call over Bluetooth — step, never animate. Draw on black;
   * white is brightest. Keep content inside y < 256 (label strip covers y >= 260).
   * Resolves 'success' or the failure name.
   */
  image(draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, label: string): Promise<string>
  /** Bottom status strip, cheap to update on every layout. */
  setLabel(text: string): Promise<void>
}

export interface ExerciseContext {
  page: PageApi
  weakEye: Eye
  strongEye: Eye
  /** Head-motion reports arrive as Input {type:'imu'} while started. Always stopped by the runner on exit too. */
  imu: { start(): Promise<void>; stop(): Promise<void> }
  now(): number
}

export interface ExerciseInstance {
  /** Put the first frame on the lenses. */
  start(): Promise<void>
  /** Advance one step. Return ms to wait before the next tick, or 'done'. All sends happen here or in onInput — never from a timer of the exercise's own. */
  tick(): Promise<number | 'done'>
  /** Runner delivers input between ticks. May send. */
  onInput(input: Input): Promise<void>
  /** Called once when the exercise ends for any reason (done, skipped, session ended). Stop IMU here if started. */
  stop(): Promise<void>
  result(): ExerciseResult
}

export interface ExerciseDef {
  id: string
  name: string
  kind: ExerciseKind
  /** One line, plain, for lists. */
  summary: string
  /** Instruction screen lines. Monocular exercises MUST open with the patch cue naming the eye to cover (the STRONGER eye). */
  instructions(weakEye: Eye): string[]
  params: ParamSpec[]
  estimateSeconds(params: Params): number
  create(ctx: ExerciseContext, params: Params): ExerciseInstance
}

export interface RoutineStep {
  exerciseId: string
  params?: Partial<Params>
}

export interface Routine {
  id: string
  name: string
  description: string
  steps: RoutineStep[]
  restSeconds: number
  builtIn?: boolean
}

export interface SessionRecord {
  at: number            // epoch ms
  routineId: string
  routineName: string
  results: ExerciseResult[]
  totalMs: number
}

export interface Settings {
  version: number
  weakEye: Eye
  restSeconds: number
  expectationsSeen: boolean
  brightness: 1 | 2 | 3 | 4
}

export function defaultsFor(def: ExerciseDef, overrides?: Partial<Params>): Params {
  const p: Params = {}
  for (const spec of def.params) p[spec.key] = spec.default
  if (overrides) for (const [k, v] of Object.entries(overrides)) if (v !== undefined) p[k] = v
  return p
}

export function otherEye(eye: Eye): Eye {
  return eye === 'left' ? 'right' : 'left'
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
