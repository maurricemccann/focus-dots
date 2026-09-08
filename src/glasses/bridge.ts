// The only module that talks to the Even Hub bridge.
//
// One serial owner of every bridge call. Concurrent updateImageRawData calls
// are dropped by the SDK, and concurrent render + storage calls have crashed
// the BLE link on real glasses — so every call in this app is queued through
// serial(). Nothing else imports the SDK bridge.
import { waitForEvenAppBridge, ImuReportPace } from '@evenrealities/even_hub_sdk'

export const bridge = await waitForEvenAppBridge()

let chain: Promise<unknown> = Promise.resolve()
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))])
}

// ── Storage ────────────────────────────────────────────────────────────────
// getLocalStorage/setLocalStorage are BLE round-trips that share the link with
// the frames. Reads are capped (a flaky hop can hang ~30 s); writes are debounced.
// The WebView's own localStorage mirrors every value so a read never blocks the
// UI on the link, and the glasses copy stays the durable one.

function mirrorGet(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function mirrorSet(key: string, value: string) {
  try { window.localStorage.setItem(key, value) } catch { /* private mode, quota — the glasses copy still lands */ }
}

export async function storageGet(key: string): Promise<string | null> {
  const local = mirrorGet(key)
  const remote = await withTimeout(
    serial(() => bridge.getLocalStorage(key)).catch(() => null as string | null),
    2000,
    null as string | null,
  )
  if (remote) { mirrorSet(key, remote); return remote }
  return local
}

const pendingWrites = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>()
export function storageSet(key: string, value: string, debounceMs = 1500) {
  mirrorSet(key, value)
  const prev = pendingWrites.get(key)
  if (prev) clearTimeout(prev.timer)
  const timer = setTimeout(() => {
    pendingWrites.delete(key)
    void serial(() => bridge.setLocalStorage(key, value)).catch(() => {})
  }, debounceMs)
  pendingWrites.set(key, { value, timer })
}

/** Push every debounced write now — on background, exit, and session end. */
export async function storageFlush() {
  const entries = [...pendingWrites.entries()]
  pendingWrites.clear()
  for (const [key, { value, timer }] of entries) {
    clearTimeout(timer)
    await serial(() => bridge.setLocalStorage(key, value)).catch(() => {})
  }
}

// ── IMU ────────────────────────────────────────────────────────────────────
let imuOn = false
export const imu = {
  async start(pace: ImuReportPace = ImuReportPace.P200) {
    if (imuOn) return
    imuOn = true
    await serial(() => bridge.imuControl(true, pace)).catch(() => { imuOn = false })
  },
  async stop() {
    if (!imuOn) return
    imuOn = false
    await serial(() => bridge.imuControl(false)).catch(() => {})
  },
  get active() { return imuOn },
}

// ── Events ─────────────────────────────────────────────────────────────────
export type GlassesEvent =
  | { kind: 'menu'; itemID: number }
  | { kind: 'tap' }
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'doubleTap' }
  | { kind: 'fgEnter' }
  | { kind: 'fgExit' }
  | { kind: 'exit' }
  | { kind: 'imu'; x: number; y: number; z: number }

export function onGlassesEvent(cb: (e: GlassesEvent) => void): () => void {
  return bridge.onEvenHubEvent((event: any) => {
    // Menu clicks ride their own top-level field, independent of which
    // container is capturing — read them before any sysEvent guard.
    const itemID = event.menuItemClickEvent?.itemID
    if (itemID !== undefined) { cb({ kind: 'menu', itemID: Number(itemID) }); return }
    if (event.textEvent) {
      const t = event.textEvent.eventType ?? 0
      if (t === 1) cb({ kind: 'up' })
      else if (t === 2) cb({ kind: 'down' })
      return
    }
    if (!event.sysEvent) return
    // Protobuf drops zero values: a single tap arrives with no eventType at all.
    const t = event.sysEvent.eventType ?? 0
    switch (t) {
      case 0: cb({ kind: 'tap' }); return
      case 3: cb({ kind: 'doubleTap' }); return
      case 4: cb({ kind: 'fgEnter' }); return
      case 5: cb({ kind: 'fgExit' }); return
      case 6: case 7: cb({ kind: 'exit' }); return
      case 8: {
        const d = event.sysEvent.imuData ?? {}
        cb({ kind: 'imu', x: Number(d.x ?? 0), y: Number(d.y ?? 0), z: Number(d.z ?? 0) })
        return
      }
    }
  })
}

/** Double-tap contract: show the system confirm dialog. Cleanup happens on the exit event, not here — the user may cancel. */
export function requestExit() {
  return serial(() => bridge.shutDownPageContainer(1))
}
