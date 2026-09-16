# App icons — the 24×24 grid, and what the Hub's validator actually wants

`make-icons.cjs` generates both fleet icons (the eye for PL FOCUS, the pencil
for PL PROMPTER) as 24×24 PNGs. Run it with an output directory:

```
node make-icons.cjs .
```

## Design rules (from Even Realities' published guidelines)

- Pixel art authored for **24 × 24**, strokes **at least 2px**.
- Store icons are stricter: **1-bit monochrome**, every pixel fully on or off,
  built from **2×2 blocks minimum** — so the real detail budget is **12 × 12**.
- Colour assets are rejected outright.

Both icons are therefore drawn as 12×12 ASCII grids in `make-icons.cjs` and
doubled. That makes the 2px minimum automatic: one grid cell is exactly one 2×2
block, and there is no way to draw a hairline by accident.

## UNRESOLVED: the Hub rejects generated PNGs

Uploading these through **Store listing → Edit basic info → App icon** fails with
`Failed to save — invalid icon pixel: X, Y`. Four formats were tried against the
live validator; the error names the first offending pixel, which makes it a
usable oracle:

| Ground | Ink | Colour type | Result |
|---|---|---|---|
| `#000000` opaque | `#FFFFFF` | 2 (RGB) | `invalid icon pixel: 0, 0` |
| `#0d0d0d` opaque | `#f2f2f2` | 2 (RGB) | `invalid icon pixel: 0, 0` |
| `#0d0d0d` opaque | `#f2f2f2` | 6 (RGBA) | `invalid icon pixel: 0, 0` |
| **transparent** | `#FFFFFF` | 6 (RGBA) | `invalid icon pixel: 6, 4` |
| **transparent** | `#f2f2f2` | 6 (RGBA) | `invalid icon pixel: 6, 4` |

**What that proves:** `0,0` is the top-left ground pixel and `6,4` is the first
LIT pixel of the eye. The error moving from one to the other means the
**transparent ground is accepted** — the remaining problem is the ink, and it is
not a matter of which shade of white, since pure and near-white fail
identically.

### The g2-icon-studio lead, and why it does not settle it

`naotake/g2-icon-studio` was recommended on the strength of "it exports exactly
what Even Hub's submission form accepts." **Read its source before trusting
that.** Its Even Hub preset is:

```js
if (p === 'evenhub') { fg = '#f2f2f2'; bg = '#0d0d0d'; }   // bgTrans = false
canvas.toBlob(b => { /* … */ }, 'image/png');              // => RGBA, opaque
```

That is **row 3 of the table above** — the exact format the Hub rejected from
us. So either the claim was an inference from the preset's *name* rather than a
verified upload, or the difference lies somewhere below the pixel values: the
PNG chunk structure or row filtering a browser's encoder emits versus this
minimal hand-rolled one. The pixel data is identical either way.

The current committed PNGs are the last untried cell of the matrix — **pure
`#000000`/`#FFFFFF`, opaque, RGBA**. Generated and verified on disk, **not yet
put to the validator.** Try that upload first; it costs one attempt.

Still untried after that: bit depth 1, and indexed colour with a two-entry
palette — both the literal reading of "monochrome PNG".

## The way that definitely works

The Hub ships its own editor: **Edit basic info → Create with a tool**. It is a
24×24 grid with a **2×2** brush, Draw/Erase, and Clear — i.e. exactly the 12×12
design surface these grids are authored on. Whatever it writes is accepted by
definition. Click the filled cells of the grid below with 2×2 selected.

Driving it through browser automation was abandoned: the window resizes on its
own between actions, which smears click coordinates mid-drawing. By hand it is
about two minutes.

### PL FOCUS — eye (48 blocks lit)

```
. . . . . . . . . . . .
. . . . . . . . . . . .
. . . # # # # # # . . .
. # # . . . . . . # # .
# . . . # # # # . . . #
# . . # # # # # # . . #
# . . # # # # # # . . #
# . . . # # # # . . . #
. # # . . . . . . # # .
. . . # # # # # # . . .
. . . . . . . . . . . .
. . . . . . . . . . . .
```

### PL PROMPTER — pencil (40 blocks lit)

```
. . . . . . . . . # # #
. . . . . . . . # # # #
. . . . . . . # # # # .
. . . . . . # # # # . .
. . . . . # # # # . . .
. . . . # # # # . . . .
. . . # # # # . . . . .
. . # # # # . . . . . .
. # # # # . . . . . . .
. # # # . . . . . . . .
. # # . . . . . . . . .
. # . . . . . . . . . .
```
