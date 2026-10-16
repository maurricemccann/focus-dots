# PL FOCUS

Vision-training drills for the Even Realities G2 glasses, built as an Even Hub app.
Ten exercises, four built-in routines, and per-parameter control from the phone.

**Training, not treatment.** PL FOCUS is not a medical device and does not cure
amblyopia. It gives the weaker eye regular, deliberate work between appointments with
an optometrist or vision therapist. The app says this on first run and in About.

## Exercises

Grouped on the glasses the way the eye is asked to work.

| Group | Exercise | What it does | Eyes |
|---|---|---|---|
| Track | Smooth Pursuit | Follow a bright ball along a dim path (line, vertical, circle, square, figure 8, zigzag, arc, sweep). Head motion is measured through the IMU. | both |
| Track | Saccade | The dot jumps; the eyes snap to it. | both |
| Focus | Fixation Hold | Hold the gaze on one still target. | both |
| Focus | Free Dot | Place a dot anywhere; move it from the phone while the drill runs. | both |
| Focus | Near / Far | Alternate focus between a near dot and a far dot, with an optional blink cue. | both |
| Focus | Convergence | Two dots step closer together (or apart). Tap when they read as one. | both |
| Focus | Brock String | A dot sweeps near, mid, far. Tap when it reads single and clear. | both |
| See | Acuity & Crowding | A shrinking E, with optional crowding bars. Answer up or down. | one |
| See | Contrast Sensitivity | A fixed-size E fades toward black. Answer while you can tell. | one |
| See | Weak-Eye Reading | Read text at a chosen size, stronger eye covered. | one |

"One eye" exercises ask you to cover the stronger eye by hand or patch. The G2 shows
both eyes the same image, so the app cannot do this in software and never claims to.

## Routines

| Routine | Contents | Length |
|---|---|---|
| Daily (all nine) | Every exercise except Free Dot, at defaults | about 20 to 25 min |
| Binocular, short | Near / Far, Convergence, Brock, Fixation | about 10 min |
| Weak eye, short | Acuity, Contrast, Reading | about 10 min |
| Tracking | Pursuit, Saccade | two drills |

## Controls

| On the glasses | Action |
|---|---|
| Tap | begin, continue, answer |
| Swipe down | skip this exercise |
| Swipe up | restart this exercise |
| Tap, then long press | menu: pause, skip, restart, end |
| Double tap | exit (system confirm dialog) |

The phone holds the deep settings: weak eye, rest length, brightness, every exercise
parameter, custom routines and progress history. The glasses carry a card chooser so
a session can start without taking the phone out.

## Requirements

- Even Realities G2 glasses and the Even Realities app (`app.json` sets minimum app version 2.2.9)
- Node.js and npm for development
- Even Hub SDK 0.0.14 or later

## Run it

```bash
npm install
npm run dev          # Vite dev server on http://localhost:5173
```

Load it on the glasses through the Even Hub CLI (`npx evenhub qr --url http://<your-lan-ip>:5173`),
or in the desktop simulator:

```bash
npx evenhub-simulator -g http://localhost:5173 --automation-port 9898
```

Headless test entry points: `?autotest=<exerciseId>` runs one exercise with defaults,
`?autotest=preset:<routineId>` runs a routine, and any other query parameter is passed
through as an exercise parameter (for example `?autotest=pursuit&path=circle`).

## Build and package

```bash
npm run build                          # tsc && vite build, into dist/
npx evenhub pack app.json dist -o pl-focus.ehpk
```

The simulator checks flow and gestures only. Image stimuli are verified on real glasses.

## How it works

- **One serial owner of the bridge.** Every SDK call goes through `serial()` in
  `src/glasses/bridge.ts`. Concurrent image sends are dropped by the glasses and
  concurrent render plus storage calls have dropped the BLE link, so no module calls
  the bridge directly.
- **Fixed layouts.** `src/glasses/page.ts` owns four page layouts (text, dots, tracer,
  image) with fixed container IDs. Motion is a cheap text-container upgrade; image
  stimuli are stepped, never animated, because a full-screen image costs 2 to 8 s over
  Bluetooth.
- **Exercise contract.** Each file in `src/exercises/` exports one `ExerciseDef` with
  typed parameters and a `start / tick / onInput / stop / result` instance. Exercises
  never touch the bridge; they return a wait duration from `tick()`.
- **Storage.** Settings, routines and progress live in the glasses' storage (capped
  reads, debounced writes), mirrored to the WebView's `localStorage` so the phone UI
  never waits on the link.

`BLUEPRINT.md` records every hardware constraint the code is built against.

## Project structure

```
src/
  main.ts            startup order: lens first, then storage, then phone UI
  engine/            session runner, exercise registry, glasses card chooser, types
  exercises/         one file per exercise (+ pursuit.check.ts self-check)
  glasses/           bridge, page layouts, canvas and Glyph rasterising, pursuit paths
  phone/             React phone UI on even-toolkit
  data/              copy, built-in routines, storage, live target
icon/                24x24 icon generator and notes
app.json             Even Hub app definition
```

## License

All rights reserved. Public to read; no licence is granted to copy, modify or
redistribute. See [LICENSE](LICENSE).

Made by [Psyched Luxuries](https://psychedluxuries.com).
