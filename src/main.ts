import './style.css'
import { setBrightness } from './glasses/page'
import { attachGlassesEvents, showIdle, startRoutine } from './engine/session'
import { loadAll, settings, saveSettings } from './data/store'
import { exercise } from './engine/registry'
import { routineById } from './data/presets'
import { initUI } from './phone/ui'

// Order matters and was paid for on hardware: the page goes up FIRST so the
// lenses are never blank, then storage (a BLE round-trip, capped) fills in
// settings, then the phone UI binds to state that already exists.
attachGlassesEvents()
await showIdle()
await loadAll()
setBrightness(settings.brightness)
initUI()

// Headless test entry — the simulator drives glasses gestures but not phone
// DOM clicks. ?autotest=<exerciseId> runs one exercise with defaults;
// ?autotest=preset:<routineId> runs a built-in routine. Skips the first-run
// expectations screen so a scripted run lands on the instruction screen.
const autotest = new URLSearchParams(location.search).get('autotest')
if (autotest) {
  saveSettings({ expectationsSeen: true })
  if (autotest.startsWith('preset:')) {
    const r = routineById(autotest.slice('preset:'.length))
    if (r) void startRoutine(r)
    else console.warn('[FocusDots] autotest: unknown preset', autotest)
  } else {
    const def = exercise(autotest)
    if (def) {
      void startRoutine({
        id: `auto-${def.id}`, name: def.name, description: '',
        steps: [{ exerciseId: def.id }], restSeconds: 3,
      })
    } else console.warn('[FocusDots] autotest: unknown exercise', autotest)
  }
}
