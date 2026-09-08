// Weak-Eye Reading — read plain text with the stronger eye covered.
// Text size must vary and firmware text is fixed-size, so every page is a
// canvas image (2-8 s per send over Bluetooth): one image per page, stepped,
// never animated. Pages turn on a dwell of lineSec x lines-on-page; a tap
// turns early. Everything is drawn inside y < 256 so the label strip
// (y >= 260) never covers a line.
import { clamp, otherEye, type ExerciseContext, type ExerciseDef, type ExerciseInstance, type Input, type Params } from '../engine/types'

const DRAW_W = 576
const DRAW_H = 256          // label strip starts at 260
const MARGIN = 16
const LINE_H = 1.35         // line pitch as a multiple of fontPx; glyph box is ~1.2x so lines never touch

// Plain, neutral, everyday. Nothing brand, nothing medical.
const SENTENCES = [
  'The kettle clicked off and the kitchen went quiet.',
  'A blue bicycle leaned against the garden fence.',
  'She folded the map and put it back in the glove box.',
  'The bus was late again, so we walked the last mile.',
  'Fresh bread sat cooling on the counter by the window.',
  'He counted the coins twice before paying for the paper.',
  'The dog waited by the door with the leash in its mouth.',
  'Rain tapped on the roof for most of the afternoon.',
  'The library closes early on Sundays in the winter.',
  'We planted tomatoes along the sunny side of the wall.',
  'The train slowed as it crossed the old iron bridge.',
  'A stack of letters waited on the hall table.',
  'The lamp flickered once and then stayed on.',
  'They painted the front door a deep shade of green.',
  'The market opens at seven and sells out by ten.',
  'Her umbrella turned inside out in the wind.',
  'The cat slept on the warm hood of the parked car.',
  'He tuned the guitar and played the first few notes.',
  'Snow covered the path from the gate to the porch.',
  'The clock in the hall runs about four minutes fast.',
  'We shared an orange on the bench near the pond.',
  'The last ferry leaves the island at half past six.',
  'A row of jars lined the shelf above the stove.',
  'The children chalked a hopscotch grid on the pavement.',
]

const WORDS = [
  'house', 'river', 'table', 'window', 'garden', 'bread', 'light', 'stone', 'paper', 'water',
  'green', 'chair', 'road', 'cloud', 'apple', 'music', 'north', 'field', 'summer', 'bottle',
  'candle', 'pocket', 'letter', 'silver', 'morning', 'basket', 'orange', 'button', 'ladder', 'market',
  'pencil', 'winter', 'shadow', 'yellow', 'coffee', 'bridge', 'forest', 'kitchen', 'number', 'jacket',
  'harbor', 'ticket', 'corner', 'planet', 'rocket', 'meadow', 'hammer', 'island', 'branch', 'circle',
  'mirror', 'needle', 'anchor', 'carpet', 'engine', 'feather', 'glove', 'honey', 'lantern', 'marble',
]

const rand = (n: number) => Math.floor(Math.random() * n)
const font = (px: number) => `${px}px sans-serif`
const lineH = (px: number) => Math.round(px * LINE_H)
const linesPerPage = (px: number) => clamp(Math.floor((DRAW_H - MARGIN) / lineH(px)), 2, 4)
const pageCount = (lines: number, px: number) => Math.ceil(lines / linesPerPage(px))

/** An endless stream of tokens for the chosen source. */
function tokenSource(source: string): () => string {
  if (source === 'letters') return () => Array.from({ length: 5 + rand(3) }, () => String.fromCharCode(65 + rand(26))).join('')
  if (source === 'words') return () => WORDS[rand(WORDS.length)]
  let s = rand(SENTENCES.length)
  let queue: string[] = []
  return () => {
    if (!queue.length) queue = SENTENCES[s++ % SENTENCES.length].split(' ')
    return queue.shift()!
  }
}

/** Greedy fill: pack tokens into `count` lines no wider than maxW. A token wider than maxW gets its own line, so this always terminates. */
function fillLines(measure: (t: string) => number, next: () => string, count: number, maxW: number): string[] {
  const out: string[] = []
  let line = ''
  let tok = next()
  while (out.length < count) {
    const cand = line ? line + ' ' + tok : tok
    if (line && measure(cand) > maxW) { out.push(line); line = '' }
    else { line = cand; tok = next() }
  }
  return out
}

function chunk(lines: string[], n: number): string[][] {
  const pages: string[][] = []
  for (let i = 0; i < lines.length; i += n) pages.push(lines.slice(i, i + n))
  return pages
}

export const def: ExerciseDef = {
  id: 'reading',
  name: 'Weak-Eye Reading',
  kind: 'monocular',
  summary: 'Read text at a chosen size with the stronger eye covered.',
  instructions: (weakEye) => [
    `Cover your ${otherEye(weakEye).toUpperCase()} eye.`,
    'Read each line with the open eye.',
    'Pages turn on their own.',
    'Tap to turn a page early.',
  ],
  params: [
    { key: 'fontPx', label: 'Text size', type: 'number', default: 24, min: 14, max: 48, step: 2, unit: 'px', help: 'Height of the letters. Smaller is harder.' },
    { key: 'lineSec', label: 'Seconds per line', type: 'number', default: 5, min: 2, max: 15, step: 1, unit: 's', help: 'How long each line stays up before the page turns.' },
    { key: 'lines', label: 'Lines to read', type: 'number', default: 10, min: 4, max: 30, step: 2, help: 'Total lines in the exercise.' },
    { key: 'source', label: 'Text', type: 'select', default: 'sentences', options: [
      { value: 'sentences', label: 'Sentences' },
      { value: 'words', label: 'Random words' },
      { value: 'letters', label: 'Random letters' },
    ], help: 'Sentences read naturally; words and letters remove guessing from context.' },
  ],
  estimateSeconds: (p) => Number(p.lines) * Number(p.lineSec) + pageCount(Number(p.lines), Number(p.fontPx)) * 4,
  create: (ctx: ExerciseContext, p: Params): ExerciseInstance => {
    const fontPx = clamp(Number(p.fontPx), 14, 48)
    const lineSec = clamp(Number(p.lineSec), 2, 15)
    const lines = clamp(Number(p.lines), 4, 30)
    const source = String(p.source)
    const measurer = document.createElement('canvas').getContext('2d')!
    measurer.font = font(fontPx)

    let pages: string[][] = []
    let pageIdx = 0
    let shownAt = 0
    let linesRead = 0
    let done = false

    const label = () => `read each line · page ${pageIdx + 1}/${pages.length} · tap for next`
    const draw = (page: string[]) => (c: CanvasRenderingContext2D) => {
      c.font = font(fontPx)
      c.textBaseline = 'top'
      c.fillStyle = '#fff'
      const lh = lineH(fontPx)
      const top = Math.floor((DRAW_H - page.length * lh) / 2)
      page.forEach((l, i) => c.fillText(l, MARGIN, top + i * lh))
    }
    const show = async () => {
      await ctx.page.image(draw(pages[pageIdx]), label())
      shownAt = ctx.now()          // dwell starts once the page is on the lenses, not when the send began
    }
    const advance = async () => {
      if (done) return
      linesRead += pages[pageIdx].length
      pageIdx++
      if (pageIdx >= pages.length) { done = true; return }
      await show()
    }

    return {
      async start() {
        pages = chunk(fillLines(t => measurer.measureText(t).width, tokenSource(source), lines, DRAW_W - MARGIN * 2), linesPerPage(fontPx))
        pageIdx = 0
        linesRead = 0
        await show()
      },
      async tick() {
        if (done) return 'done'
        const dwell = lineSec * pages[pageIdx].length * 1000
        const left = dwell - (ctx.now() - shownAt)
        if (left > 0) return Math.max(50, left)
        await advance()
        return done ? 'done' : Math.max(50, lineSec * pages[pageIdx].length * 1000)
      },
      async onInput(input: Input) {
        if (input.type === 'tap') await advance()
      },
      async stop() { done = true },
      result: () => ({
        exerciseId: 'reading',
        completed: linesRead >= lines,
        durationMs: 0,
        metrics: { linesRead, fontPx, pages: pages.length || pageCount(lines, fontPx) },
      }),
    }
  },
}
