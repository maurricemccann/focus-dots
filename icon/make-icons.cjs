// 24x24 monochrome app icons for Even Hub.
//
// The spec, from Even Realities' own design guidelines: pixel art authored for
// 24x24, strokes at least 2px, 1-bit monochrome with every pixel fully on or
// off, and built from 2x2 blocks minimum — which means the real detail budget
// is 12x12, not 24x24. Colour assets are rejected outright.
//
// So each icon is DESIGNED on a 12x12 grid and doubled. That makes the 2px
// minimum stroke automatic rather than something to remember: one cell in the
// grid below is exactly one 2x2 block on the lens, and there is no way to draw
// a hairline by accident.
//
// Written by hand as ASCII art rather than drawn in a tool, because at this
// size every single cell is a design decision and a downscale of anything
// larger turns to mush. '#' is lit, '.' is ground.
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

// An eye: a lens outline with an iris. Reads as sight, which is what the app
// trains. The outline is one cell thick so the shape stays open at 24px —
// a filled almond at this size reads as a leaf, not an eye.
const EYE = [
  '............',
  '............',
  '...######...',
  '.##......##.',
  '#...####...#',
  '#..######..#',
  '#..######..#',
  '#...####...#',
  '.##......##.',
  '...######...',
  '............',
  '............',
]

// A pencil, tip down-left, tapering to a point. A diagonal shaft is the only
// pencil that survives 12x12: a vertical one loses the taper that makes it a
// pencil rather than a bar.
const PENCIL = [
  '.........###',
  '........####',
  '.......####.',
  '......####..',
  '.....####...',
  '....####....',
  '...####.....',
  '..####......',
  '.####.......',
  '.###........',
  '.##.........',
  '.#..........',
]

const SIZE = 24
const SCALE = 2

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = c ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

// RGBA, colour type 6, fully opaque.
//
// Arrived at by elimination against the Hub's actual validator, not by reading
// a spec — the spec says only "24 x 24 px monochrome PNG". Two rejections, both
// "invalid icon pixel: 0,0":
//   1. pure #000000/#FFFFFF, colour type 2 (RGB)  -> rejected
//   2. #0d0d0d/#f2f2f2,      colour type 2 (RGB)  -> rejected
// The colour VALUES were not the variable; the colour TYPE was. Even Hub's own
// icon tool is a browser page, and a canvas only ever exports RGBA, so RGBA is
// what the validator has actually been fed by every icon that ever passed it.
//
// Values stay #f2f2f2 / #0d0d0d to match that tool rather than reverting to
// pure black and white, since those are what its accepted output contains.
// Converged on by reading the validator's own error, which names the offending
// pixel. Transparent ground moved it from "0,0" to "6,4" — the first LIT pixel
// — proving the ground was right and the ink was not. Pure #FFFFFF is rejected;
// #f2f2f2 is the value Even Hub's own icon tool writes, so it is the value the
// validator has always accepted.
const FG = 0xff
function png(grid) {
  const raw = []
  for (let y = 0; y < SIZE; y++) {
    raw.push(0) // filter: none
    for (let x = 0; x < SIZE; x++) {
      const on = grid[Math.floor(y / SCALE)][Math.floor(x / SCALE)] === '#'
      // TRANSPARENT where unlit. Every rejected attempt had an OPAQUE pixel at
      // 0,0 — which is exactly the pixel the Hub named — whether that pixel was
      // black, near-black, or carried no alpha channel at all. The variable was
      // never the colour; it was opacity. This field is the icon's FOREGROUND
      // layer, and the guidelines list foreground and background separately, so
      // ground here means absent, not dark.
      raw.push(on ? 0xff : 0x00, on ? 0xff : 0x00, on ? 0xff : 0x00, 0xff)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // colour type 6 = truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from(raw), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const outDir = process.argv[2]
const assert = require('assert')

for (const [name, grid] of [['focus-eye', EYE], ['prompter-pencil', PENCIL]]) {
  // Every grid must be exactly 12x12 — a ragged row would shift the whole
  // design silently rather than throwing.
  assert.strictEqual(grid.length, 12, `${name}: ${grid.length} rows, want 12`)
  grid.forEach((r, i) => assert.strictEqual(r.length, 12, `${name} row ${i}: ${r.length} cols, want 12`))
  const lit = grid.join('').split('').filter(c => c === '#').length
  // Ink sanity: an icon that is nearly empty or nearly solid is unreadable on a
  // see-through display, where every lit pixel costs you a pixel of the world.
  const pct = (lit / 144) * 100
  assert.ok(pct > 8 && pct < 55, `${name}: ${pct.toFixed(0)}% ink is outside the readable band`)

  const buf = png(grid)
  const file = path.join(outDir, `${name}-24.png`)
  fs.writeFileSync(file, buf)
  // Re-read and check the signature, so "written" means "a real PNG is there".
  const back = fs.readFileSync(file)
  assert.ok(back.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${name}: bad PNG signature`)
  console.log(`${name.padEnd(18)} 24x24  ${String(buf.length).padStart(4)} bytes  ${pct.toFixed(0)}% ink`)
}

// Print them so they can be judged before they are uploaded, rather than after.
for (const [name, grid] of [['focus-eye', EYE], ['prompter-pencil', PENCIL]]) {
  console.log(`\n${name}:`)
  for (const row of grid) console.log('  ' + row.replace(/#/g, '██').replace(/\./g, '  '))
}
