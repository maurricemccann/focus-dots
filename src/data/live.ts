// A target the phone can move WHILE an exercise is running.
//
// Params are resolved once at step start (`defaultsFor`), which is right for
// everything that should not change mid-drill — trial counts, durations,
// thresholds. But the founder asked for an exercise "that allows you to place a
// dot anywhere and be able to set it on the phone or move it somehow", and
// moving it only between runs is not the same thing.
//
// So this is deliberately the one piece of state that crosses from the phone
// into a live exercise. It is kept tiny and explicit rather than opening a
// general channel: exercises that want it read it, everything else is untouched.
export interface LiveTarget { x: number; y: number }

let target: LiveTarget = { x: 288, y: 128 }
const listeners = new Set<(t: LiveTarget) => void>()

export function liveTarget(): LiveTarget {
  return target
}

export function setLiveTarget(t: LiveTarget) {
  // Keep it on the lens and clear of the label strip, wherever the tap landed.
  target = {
    x: Math.max(12, Math.min(564, Math.round(t.x))),
    y: Math.max(12, Math.min(248, Math.round(t.y))),
  }
  for (const l of listeners) l(target)
}

export function onLiveTarget(cb: (t: LiveTarget) => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
