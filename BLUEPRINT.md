# Focus Dots — build blueprint (frozen rules for every contributor)

Read this in full before touching any file. It is the contract every module is built against. It exists because the constraints below were each paid for by a real bug on real glasses; the simulator does not reproduce most of them.

## What this app is

A vision-training app for the Even Realities G2 glasses. A library of amblyopia ("lazy eye") exercises with deep per-parameter control and preset routines. **Training, not treatment.** It does not cure amblyopia; it trains coordination and the weaker eye's engagement. Not a medical device. The app says so, plainly, on first run and in About. Voice: plain, direct, functional. No marketing tone, no hype, no medical claims.

## Hardware facts (verified from the SDK type definitions — not assumptions)

- Display 576×288, **16 gray levels (0–15)**, monochrome green on black.
- **Both eyes always see the identical image. There is no per-lens rendering in the SDK.** Dichoptic (different-per-eye) stimuli are impossible. Monocular exercises work by *instructing* the user to cover the stronger eye (hand or patch). The app never claims to do this in software.
- **Text size is fixed by firmware** — `TextContainerProperty` has no font size. Anything that must vary in size (acuity targets, reading text) is drawn as an image.
- Text brightness: `textColor` 1–4 on `TextContainerProperty` / `TextContainerUpgrade`.
- Images: `ImageContainerProperty` max 288×144 each, max 4 per page, tiled 2×2 = full screen. Pixels are raw 4-bit `number[]` (0–15), one entry per pixel. **Never base64/PNG** — the simulator decodes PNG, the glasses return `sendFailed`.
- **Cost:** 0.5–2 s per tile over Bluetooth → 2–8 s per full-screen image frame. Image stimuli are *stepped*, never animated.
- **Cheap motion:** `bridge.textContainerUpgrade()` on a small text strip carries no image payload and is near-free. A moving target is `' '.repeat(col) + '●'` in a strip.
- **Upgrading a text container repaints its region opaquely** over anything beneath it. A full-screen text upgrade wipes the image layer. Never upgrade the event layer while an image stimulus is showing; use the label strip.
- Glyphs outside the firmware font are silently dropped. Known-good: `●` `·` `~` ASCII letters/digits. Do not use other unicode.
- Page limits: `containerTotalNum` 1–12, text ≤ 8, image ≤ 4. `containerName` ≤ 16 chars. Text `content` ≤ 1000 chars.
- Exactly ONE container per page has `isEventCapture: 1`. Image containers cannot capture input.
- `zOrderIndex` is all-or-nothing per page, values unique, larger = front. Violation → `createStartUpPageContainer` returns `invalid` / `rebuildPageContainer` returns `false`.
- `createStartUpPageContainer` exactly once per app lifetime; everything after is `rebuildPageContainer` (full layout swap) or `textContainerUpgrade`/`updateImageRawData` (in-place).
- `menuObject` must be passed on **every** rebuild or the custom menu is cleared. Menu: ≤10 items, verb labels ≤32 bytes, itemID non-zero unique. The OS never re-renders labels — labels are verbs, never state ("Pause", never "Paused: yes").
- After `createStartUpPageContainer` wait ~1000 ms before the first image send (first send returned `sendFailed` every time otherwise).
- `getLocalStorage`/`setLocalStorage` are BLE round-trips. Reads: `Promise.race` with a 2000 ms timeout, never on the startup path before the page exists. Writes: debounced ≥1500 ms.
- Never blank the only visible container on a failed send. Name the failure on the label strip instead.
- IMU: `bridge.imuControl(true, pace)` starts head-motion reports (`sysEvent.eventType === 8`, `sysEvent.imuData {x,y,z}`); **must** be stopped with `imuControl(false)` when the exercise ends and on exit.

## Input (`OsEventTypeList`) — protobuf drops zero values, so read with `?? 0`

| Arrives as | eventType | Meaning |
|---|---|---|
| `event.menuItemClickEvent.itemID` | — | contextual menu action. **Check this first**, before any sysEvent guard. |
| `event.textEvent` | 1 | swipe up |
| `event.textEvent` | 2 | swipe down |
| `event.sysEvent` | absent / 0 | single tap |
| `event.sysEvent` | 3 | double-tap → `bridge.shutDownPageContainer(1)` (system confirm dialog). Do NOT clean up here — user may cancel. |
| `event.sysEvent` | 4 / 5 | menu overlay open / close — **not gestures, ignore** |
| `event.sysEvent` | 6 / 7 | abnormal / system exit → stop IMU, flush state |
| `event.sysEvent` | 8 | IMU report |

## The one rule that matters most: ONE serial owner of every bridge call

All bridge calls go through `serial()` in `src/glasses/bridge.ts`. Concurrent `updateImageRawData` calls are dropped; concurrent render + storage calls have crashed the BLE link. No module calls `bridge.*` directly. No `setInterval` that sends. The session runner is the only loop; exercises return "wait N ms" from `tick()` and the runner sleeps (interruptibly) between ticks.

## Page layouts (fixed container IDs and z-order — do not invent new ones)

| ID | name | z | what |
|---|---|---|---|
| 1 | `event` | 1 | full-screen text, `isEventCapture: 1`. Holds instruction/summary text on text-only layouts. Never upgraded while an image layout is showing. |
| 2–5 | `tl` `tr` `bl` `br` | 2–5 | image tiles (288×144 each), only on the **image** layout |
| 6 | `label` | 6 | bottom strip, 576×28 at y=260. Exercise status ("Converge 3/20"). Cheap to upgrade. |
| 7–12 | `d1`…`d6` | 7–12 | dot/target containers on the **dots** layout (small text containers holding `●` / `·`) — or **rows** `r1`…`r5` on the tracer layout (5 stacked 576×40 strips at y=20,66,112,158,204; a target moves by upgrading row content) |

Three layouts, switched by `rebuildPageContainer` (a few times per session, never per frame):
- **text** — `event` + `label`. Instruction, rest, summary screens.
- **dots** — `event` (content ' ') + `label` + up to 6 dot containers positioned by x/y. Near/far, converge, Brock. Re-positioning a dot = rebuild (fine, text-only rebuilds are fast; the prototype already did this).
- **tracer** — `event` (' ') + `label` + 5 rows. Pursuit, saccade. Motion = `textContainerUpgrade` of a row's content. Clear the old row when the target changes rows.
- **image** — `event` (' ') + 4 tiles + `label`. Contrast, acuity, fixation, reading. Draw with canvas 2D via `page.image(draw)`; keep stimuli inside y < 256 so the label strip (y ≥ 260) never covers them.

`src/glasses/page.ts` owns all of this. Exercises call `page.*` only.

## Exercise contract (`src/engine/types.ts`)

Every exercise is one file in `src/exercises/` exporting a `const def: ExerciseDef`. It declares its params (`ParamSpec[]`, with defaults, ranges, help text) and creates an `ExerciseInstance` with `start / tick / onInput / stop / result`. It never touches the bridge; it uses `ctx.page` and returns wait durations from `tick()`. `result()` returns metrics the progress screen can chart (e.g. contrast threshold reached). Exercises must respect `ctx.weakEye` when giving patch cues (they cue "cover your **stronger** eye" — i.e. the eye that is NOT the weak one).

Copy rules inside exercises: short, imperative, plain. Every monocular exercise's first instruction line names which eye to cover. No exercise promises an outcome.

## Verification

- `npm run build` must pass (`tsc && vite build`) — strict, `noUnusedLocals`.
- Simulator (`evenhub-simulator -g http://localhost:5173 --automation-port 9898`) verifies flow and gestures only. **Every image stimulus is verified on the real glasses** before it is called done.
- `?autotest=<exerciseId>` starts that exercise headlessly with defaults; `?autotest=preset:<presetId>` runs a preset.
