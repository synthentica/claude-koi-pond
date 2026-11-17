// Generates the pixel-art koi pond backdrop and writes it to hooks/pond.js.
// Usage: node tools/gen-pond.mjs hooks/pond.js [preview.svg]
import { writeFileSync } from 'node:fs'

const [out, previewOut] = process.argv.slice(2)

let seed = 11
const rnd = () => {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}
const r = (a, b) => a + (b - a) * rnd()
const ri = (a, b) => Math.floor(r(a, b + 1))
const pick = list => list[Math.floor(rnd() * list.length)]

// SMIL only, and every animation starts at 0s with its offset baked into the
// keyframes.
// shift() starts a discrete loop `ahead` seconds into its cycle.
const shift = (values, times, dur, ahead) => {
  const frac = ((ahead % dur) + dur) % dur / dur
  if (frac === 0) return [values, times]
  let at = 0
  times.forEach((t, i) => { if (t <= frac) at = i })
  const v = [values[at]]
  const k = [0]
  for (let i = at + 1; i < times.length; i++) { v.push(values[i]); k.push(times[i] - frac) }
  for (let i = 0; i < at; i++) { v.push(values[i]); k.push(times[i] + 1 - frac) }
  return [v, k]
}
const keys = times => times.map(t => +t.toFixed(4)).join(';')
const blink = (values, times, dur, begin = 0) => {
  const [v, k] = shift(values, times, dur, -begin)
  return `<animate attributeName="opacity" values="${v.join(';')}" keyTimes="${keys(k)}" calcMode="discrete" dur="${dur}s" repeatCount="indefinite"/>`
}
// track() loops linearly through [time in s, [numbers]] points within a `dur`
// loop. `ahead` starts it that far into its cycle: the loop is cut there and
// the value interpolated, so the offset stays in the keyframes. Equal keyTimes
// make a jump.
const track = (points, dur, ahead) => {
  const pts = points.map(([t, v]) => [t / dur, v])
  if (pts[0][0] > 0) pts.unshift([0, pts[pts.length - 1][1]])
  if (pts[pts.length - 1][0] < 1) pts.push([1, pts[pts.length - 1][1]])
  const frac = ((ahead % dur) + dur) % dur / dur
  const valueAt = f => {
    for (let i = 1; i < pts.length; i++) {
      const [t0, v0] = pts[i - 1]
      const [t1, v1] = pts[i]
      if (f <= t1) return v0.map((a, k) => (t1 === t0 ? v1[k] : a + ((v1[k] - a) * (f - t0)) / (t1 - t0)))
    }
    return pts[pts.length - 1][1]
  }
  const start = valueAt(frac)
  const later = pts.filter(([t]) => t > frac).map(([t, v]) => [t - frac, v])
  const wrapped = pts.filter(([t]) => t <= frac).map(([t, v]) => [t + 1 - frac, v])
  const all = [[0, start], ...later, ...wrapped]
  if (all[all.length - 1][0] < 1) all.push([1, start])
  const values = all.map(([, v]) => v.map(n => +n.toFixed(2)).join(' ')).join(';')
  return `values="${values}" keyTimes="${keys(all.map(([t]) => t))}" dur="${dur}s" repeatCount="indefinite"`
}
const fade = (points, dur, ahead) =>
  `<animate attributeName="opacity" ${track(points.map(([t, o]) => [t, [o]]), dur, ahead)}/>`
const move = (points, dur, ahead, type = 'translate') =>
  `<animateTransform attributeName="transform" type="${type}" ${track(points, dur, ahead)}/>`
const hop = (points, times, dur, begin = 0) => {
  const [v, k] = shift(points.map(([x, y]) => x + ' ' + y), times, dur, -begin)
  return `<animateTransform attributeName="transform" type="translate" values="${v.join(';')}" keyTimes="${keys(k)}" calcMode="discrete" dur="${dur}s" repeatCount="indefinite"/>`
}

// One pixel is one unit; the app scales the scene up.
// The layout was drawn for 320 x 200; ZOOM spreads it over a wider pond while
// every sprite keeps its pixel size, so the pond reads further away.
const ZOOM = 1.25
const W = 320 * ZOOM
const H = 200 * ZOOM
const spread = v => Math.round(v * ZOOM)

const C = {
  deep: '#123b3f',
  base: '#15444a',
  mid: '#194e53',
  shallow: '#1e5a5e',
  pebble: '#2c6c6c',
  pebbleDark: '#123a3d',
  caustic: '#4f9e98',
  sparkle: '#bfe7de',
}

// Rows of same-colored pixels merged into one rect.
const runs = (cells, cell = 1) => {
  let s = ''
  for (const [color, grid] of Object.entries(cells)) {
    let d = ''
    for (const [y, xs] of grid) {
      xs.sort((a, b) => a - b)
      let start = xs[0]
      let prev = xs[0]
      for (let i = 1; i <= xs.length; i++) {
        const x = xs[i]
        if (x === prev + 1) {
          prev = x
          continue
        }
        d += `M${start * cell} ${y * cell}h${(prev - start + 1) * cell}v${cell}h-${(prev - start + 1) * cell}z`
        start = x
        prev = x
      }
    }
    s += `<path fill="${color}" d="${d}"/>`
  }
  return s
}
const addCell = (cells, color, x, y) => {
  cells[color] ??= new Map()
  const row = cells[color].get(y) ?? []
  row.push(x)
  cells[color].set(y, row)
}

// Water depth: smooth noise in 4 px cells, dithered between shades.
const noise = (x, y) =>
  Math.sin(x * 0.045 + 1.3) * 0.5 +
  Math.sin(y * 0.06 + x * 0.02) * 0.45 +
  Math.sin((x + y) * 0.03 + 2.1) * 0.35 +
  Math.sin(x * 0.11 - y * 0.09) * 0.15
const depth = {}
const CELL = 4
for (let cy = 0; cy < H / CELL; cy++) {
  for (let cx = 0; cx < W / CELL; cx++) {
    const v = noise(cx * CELL, cy * CELL)
    const dither = (cx + cy) % 2 === 0 ? 0.05 : -0.05
    const t = v + dither
    if (t < -0.55) addCell(depth, C.deep, cx, cy)
    else if (t > 0.75) addCell(depth, C.shallow, cx, cy)
    else if (t > 0.3) addCell(depth, C.mid, cx, cy)
  }
}
const depthSvg = runs(depth, CELL)

// Pebbles on the bottom.
const pebbles = {}
for (let i = 0; i < 180 * ZOOM * ZOOM; i++) {
  const x = ri(0, W - 1)
  const y = ri(0, H - 1)
  addCell(pebbles, rnd() < 0.6 ? C.pebbleDark : C.pebble, x, y)
  if (rnd() < 0.3) addCell(pebbles, C.pebbleDark, x + 1, y)
}
const pebbleSvg = runs(pebbles)

// Caustic glints that blink in three phases.
let caustics = ''
for (let g = 0; g < 3; g++) {
  const cells = {}
  for (let i = 0; i < 38 * ZOOM * ZOOM; i++) {
    const x = ri(0, W - 6)
    const y = ri(0, H - 1)
    const len = ri(2, 5)
    for (let k = 0; k < len; k++) addCell(cells, C.caustic, x + k, y + (k > 2 ? 1 : 0))
  }
  caustics += `<g opacity=".1">${blink([0.1, 0.55, 0.25, 0], [0, 0.3, 0.6, 0.85], [3.6, 4.4, 5.2][g], [0, -1.4, -2.9][g])}${runs(cells)}</g>`
}

// Stones and moss in two corners.
const stones = {}
const stone = (cx, cy, rx, ry) => {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const d = (x * x) / (rx * rx) + (y * y) / (ry * ry)
      if (d > 1) continue
      let color = '#7d8380'
      if (x + y < -rx * 0.6) color = '#a7aca6'
      else if (x + y > rx * 0.7) color = '#555c5b'
      if (d > 0.82 && x + y > 0) color = '#3f4646'
      addCell(stones, color, cx + x, cy + y)
    }
  }
  // Shadow on the water, down and right.
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const d = ((x - 3) * (x - 3)) / (rx * rx) + ((y - 3) * (y - 3)) / (ry * ry)
      const inside = (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1
      if (d <= 1 && !inside) addCell(stones, '#0c2a2d', cx + x, cy + y)
    }
  }
}
const moss = (cx, cy, n) => {
  for (let i = 0; i < n; i++) {
    addCell(stones, pick(['#4f7a3a', '#5f8c45', '#3c642f']), cx + ri(-14, 14), cy + ri(-10, 10))
  }
}
moss(8, 10, 120)
stone(-2, 8, 20, 14)
stone(22, -2, 13, 9)
stone(36, 6, 6, 4)
moss(W - 8, H - 8, 120)
stone(W - 2, H - 14, 18, 15)
stone(W - 24, H, 12, 8)
stone(W - 32, H - 14, 5, 4)
const stoneSvg = runs(stones)

// Lily pads, each bobbing by a pixel. Drops keep off them and off the stones.
let pads = ''
const dry = [[0, 4, 26], [24, -2, 16], [W - 8, H - 10, 24], [W - 24, H, 14]]
const pad = (i, x0, y0, rad, notch, flower) => {
  const [cx, cy] = [spread(x0), spread(y0)]
  dry.push([cx, cy, rad + 2])
  const cells = {}
  for (let y = -rad; y <= rad; y++) {
    for (let x = -rad; x <= rad; x++) {
      const d = Math.sqrt(x * x + y * y)
      if (d > rad + 0.3) continue
      const a = Math.atan2(y, x)
      if (d > 1 && Math.abs(a - notch) < 0.32) continue
      let color = '#4e8a3e'
      if (d > rad - 1.2) color = '#386d2f'
      else if (x + y < -rad * 0.5) color = '#6aa64f'
      if (d > 1.5 && d < rad - 1.5 && Math.abs(Math.atan2(y, x) - notch - Math.PI) % 1.1 < 0.12) color = '#3f7533'
      addCell(cells, color, cx + x, cy + y)
    }
  }
  // Shadow
  const sh = {}
  for (let y = -rad; y <= rad; y++) {
    for (let x = -rad; x <= rad; x++) {
      if (Math.sqrt(x * x + y * y) <= rad) addCell(sh, '#0b2a2c', cx + x + 2, cy + y + 2)
    }
  }
  let fl = ''
  if (flower) {
    const fc = {}
    const px = [
      [0, -2], [-1, -1], [0, -1], [1, -1], [-2, 0], [-1, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2],
    ]
    for (const [x, y] of px) addCell(fc, Math.abs(x) + Math.abs(y) === 2 ? '#f4c3d2' : '#e996b1', cx + x - 2, cy + y - 1)
    addCell(fc, '#f6d36b', cx - 2, cy - 1)
    fl = runs(fc)
  }
  pads += `<g>${hop([[0, 0], [1, 0], [1, 1]], [0, 0.5, 0.75], +r(4, 7).toFixed(1), -r(0, 6))}<g opacity=".55">${runs(sh)}</g>${runs(cells)}${fl}</g>`
}
pad(0, 262, 34, 11, 0.7, true)
pad(1, 284, 52, 7, 2.6, false)
pad(2, 246, 56, 6, -2.2, false)
pad(3, 52, 164, 10, -0.9, false)
pad(4, 74, 182, 6, 1.9, true)
pad(5, 30, 146, 5, 3.0, false)
pad(6, 300, 128, 8, 2.2, false)
pad(7, 18, 60, 6, -0.4, false)

// Koi: drawn facing +x around their center, 18 px long.
const halfWidth = [0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 2, 2, 1]
const MID = 13
const darken = (hex, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('')
const varieties = {
  kohaku: { base: '#f3ede3', fin: '#f7f2ea', patches: [[19, 0, 3.6, '#d9442c'], [10, -1, 3.0, '#d9442c'], [5, 1, 1.6, '#d9442c']] },
  tancho: { base: '#f3ede3', fin: '#f7f2ea', patches: [[21, 0, 2.0, '#d9442c']] },
  showa: { base: '#1d1b1c', fin: '#4a4344', patches: [[17, 1, 3.0, '#d9442c'], [9, -1, 2.6, '#f3ede3'], [22, -1, 1.6, '#f3ede3'], [6, 1, 1.4, '#d9442c']] },
  sanke: { base: '#f3ede3', fin: '#f7f2ea', patches: [[16, -1, 3.4, '#d9442c'], [8, 1, 2.0, '#d9442c'], [11, 2, 1.0, '#1d1b1c'], [13, -2, 0.8, '#1d1b1c'], [6, -1, 0.8, '#1d1b1c']] },
  ogon: { base: '#e9b440', fin: '#f2cd70', patches: [[14, 0, 1.2, '#f8dd88'], [20, 0, 1.0, '#f8dd88']] },
  chagoi: { base: '#b9773f', fin: '#cf9358', patches: [[16, 0, 1.0, '#cf9358']] },
  asagi: { base: '#6e8fa6', fin: '#e0703a', patches: [[14, 3, 1.6, '#e0703a'], [14, -3, 1.6, '#e0703a'], [22, 0, 1.3, '#9db6c5']] },
  orange: { base: '#ec7b2f', fin: '#f39b55', patches: [[18, 0, 1.8, '#f7a659']] },
}
// Each koi is drawn inline where it appears (no <mpath>); only the drop rings
// are shared through <use>.
const koiArt = Object.fromEntries(Object.entries(varieties).map(([name, v]) => {
  const body = {}
  const sil = {}
  for (let x = 0; x < halfWidth.length; x++) {
    const h = halfWidth[x]
    for (let y = -h; y <= h; y++) {
      let color = v.base
      for (const [px, py, pr, pc] of v.patches) {
        if ((x - px) ** 2 + ((y - py) * 1.3) ** 2 <= pr * pr) color = pc
      }
      if (h > 0 && Math.abs(y) === h) color = darken(color, 0.82)
      addCell(body, color, x - MID, y)
      addCell(sil, '#000', x - MID, y)
    }
  }
  // Pectoral fins, two frames.
  const finA = {}
  const finB = {}
  for (const sg of [-1, 1]) {
    for (const [x, y] of [[6, 5], [5, 5], [4, 5], [5, 6], [4, 6], [3, 6], [3, 7], [2, 7]]) addCell(finA, v.fin, x, sg * y)
    for (const [x, y] of [[6, 5], [5, 5], [4, 5], [4, 6], [3, 6]]) addCell(finB, v.fin, x, sg * y)
  }
  // Tail fan in three frames: spread, flicked one way, flicked the other.
  const fan = [[-14, [-1, 0, 1]], [-15, [-2, -1, 0, 1, 2]], [-16, [-3, -2, -1, 1, 2, 3]], [-17, [-4, -3, -2, 2, 3, 4]], [-18, [-4, -3, 3, 4]]]
  const bend = [0, 1, 1, 2, 2]
  const tails = [0, 1, -1].map(dir => {
    const t = {}
    fan.forEach(([x, ys], i) => ys.forEach(y => addCell(t, v.fin, x, y + dir * bend[i])))
    return t
  })
  fan.forEach(([x, ys]) => ys.forEach(y => addCell(sil, '#000', x, y)))
  return [name, {
    fish:
    `<g>` +
    `<g opacity=".9">${blink([0.9, 0, 0.9, 0], [0, 0.25, 0.5, 0.75], 0.9)}${runs(tails[0])}</g>` +
    `<g opacity="0">${blink([0, 0.9, 0], [0, 0.25, 0.5], 0.9)}${runs(tails[1])}</g>` +
    `<g opacity="0">${blink([0, 0.9], [0, 0.75], 0.9)}${runs(tails[2])}</g>` +
    `<g opacity=".8">${blink([0.8, 0], [0, 0.5], 1.3)}${runs(finA)}</g><g opacity="0">${blink([0, 0.8], [0, 0.5], 1.3)}${runs(finB)}</g>` +
    runs(body) +
    `</g>`,
    shadow: `<g>${runs(sil)}</g>`,
  }]
}))

// Swim paths: closed loops that cross the middle of the pond, resampled into
// translate and rotate keyframes at equal distances so the speed stays even.
const SWIM_STEPS = 48
const route = (cx, cy, rx, ry, wobble, ccw) => {
  const pts = []
  const n = 10
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 * (ccw ? -1 : 1)
    const w = 1 + Math.sin(i * 2.3) * wobble
    pts.push([cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w])
  }
  // Closed Catmull-Rom spline, sampled densely.
  const dense = []
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    for (let k = 0; k < 40; k++) {
      const t = k / 40
      const t2 = t * t
      const t3 = t2 * t
      dense.push([0, 1].map(c =>
        0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t3)))
    }
  }
  dense.push(dense[0])
  const cum = [0]
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]))
  const total = cum[cum.length - 1]
  const at = dist => {
    let i = 1
    while (i < cum.length - 1 && cum[i] < dist) i++
    const f = (dist - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
    return [dense[i - 1][0] + (dense[i][0] - dense[i - 1][0]) * f, dense[i - 1][1] + (dense[i][1] - dense[i - 1][1]) * f]
  }
  return { at, total }
}
const loop = ({ at, total }, phase) => {
  const samples = []
  for (let k = 0; k < SWIM_STEPS; k++) samples.push(at((((k / SWIM_STEPS) + phase) % 1) * total))
  // Heading from neighbours, unwrapped so rotation never spins the long way.
  const angles = []
  for (let k = 0; k < SWIM_STEPS; k++) {
    const a = samples[(k - 1 + SWIM_STEPS) % SWIM_STEPS]
    const b = samples[(k + 1) % SWIM_STEPS]
    let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
    if (k > 0) {
      while (deg - angles[k - 1] > 180) deg -= 360
      while (deg - angles[k - 1] < -180) deg += 360
    }
    angles.push(deg)
  }
  const last = angles[SWIM_STEPS - 1]
  let closing = angles[0]
  while (closing - last > 180) closing -= 360
  while (closing - last < -180) closing += 360
  return {
    moves: samples.concat([samples[0]]).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(';'),
    turns: angles.concat([closing]).map(a => Math.round(a)).join(';'),
    start: samples[0],
  }
}
// Every loop time divides one 240 s cycle, so the whole pond repeats only
// every four minutes, and the start points can be chosen so that no two koi
// ever swim over each other within it.
const swimmers = [
  ['kohaku', route(spread(90), spread(75), spread(60), spread(40), 0.12, false), 48],
  ['ogon', route(spread(250), spread(65), spread(50), spread(35), 0.18, true), 40],
  ['showa', route(spread(150), spread(112), spread(40), spread(40), 0.15, false), 40],
  ['tancho', route(spread(80), spread(140), spread(55), spread(35), 0.2, true), 40],
  ['asagi', route(spread(248), spread(150), spread(52), spread(30), 0.1, true), 48],
  ['sanke', route(spread(165), spread(35), spread(55), spread(20), 0.2, false), 48],
  ['chagoi', route(spread(160), spread(155), spread(90), spread(30), 0.08, true), 60],
  ['orange', route(spread(210), spread(110), spread(35), spread(35), 0.25, false), 30],
]
const CYCLE = 240
// Each koi as its body line: 22 px through its center along its heading.
const TABLE = 480
const bodies = swimmers.map(([, { at, total }]) => {
  const pts = []
  for (let k = 0; k < TABLE; k++) pts.push(at((k / TABLE) * total))
  return pts.map((p, k) => {
    const a = pts[(k - 1 + TABLE) % TABLE]
    const b = pts[(k + 1) % TABLE]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const [ux, uy] = [((b[0] - a[0]) / len) * 11, ((b[1] - a[1]) / len) * 11]
    return [p[0] - ux, p[1] - uy, p[0] + ux, p[1] + uy]
  })
})
const segGap = ([ax, ay, bx, by], [cx, cy, dx, dy]) => {
  const toSeg = (px, py, x0, y0, x1, y1) => {
    const vx = x1 - x0
    const vy = y1 - y0
    const t = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / (vx * vx + vy * vy || 1)))
    return Math.hypot(px - x0 - vx * t, py - y0 - vy * t)
  }
  const cross = (x0, y0, x1, y1, x2, y2) => (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
  const d1 = cross(ax, ay, bx, by, cx, cy)
  const d2 = cross(ax, ay, bx, by, dx, dy)
  const d3 = cross(cx, cy, dx, dy, ax, ay)
  const d4 = cross(cx, cy, dx, dy, bx, by)
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0
  return Math.min(toSeg(ax, ay, cx, cy, dx, dy), toSeg(bx, by, cx, cy, dx, dy), toSeg(cx, cy, ax, ay, bx, by), toSeg(dx, dy, ax, ay, bx, by))
}
// Closest approach of any two bodies over the cycle; CLEAR px between body
// lines keeps two 8 px wide koi apart.
const CLEAR = 12
const closeness = phases => {
  let penalty = 0
  let nearest = Infinity
  for (let t = 0; t < CYCLE; t += 0.5) {
    const now = bodies.map((b, i) => b[Math.floor((((t / swimmers[i][2] + phases[i]) % 1) * TABLE)) % TABLE])
    for (let i = 0; i < now.length; i++) {
      for (let j = i + 1; j < now.length; j++) {
        const gap = segGap(now[i], now[j])
        nearest = Math.min(nearest, gap)
        // A quick crossing reads as one koi passing under another; swimming
        // stacked side by side reads as a glitch, so parallel overlap costs most.
        const [ax, ay, bx, by] = now[i]
        const [cx, cy, dx, dy] = now[j]
        const parallel = Math.abs((bx - ax) * (dx - cx) + (by - ay) * (dy - cy)) / 484
        if (gap < CLEAR) penalty += (CLEAR - gap) ** 2 * (0.15 + parallel ** 2)
      }
    }
  }
  return { penalty, nearest }
}
// Search start points with its own random stream, so the rest of the pond
// keeps its layout: random tries, then nudge one koi at a time.
let searchSeed = 7
const searchRnd = () => {
  searchSeed = (searchSeed * 48271) % 2147483647
  return searchSeed / 2147483647
}
let phases = swimmers.map(() => searchRnd())
let best = closeness(phases)
for (let n = 0; n < 300 && best.penalty > 0; n++) {
  const tryPhases = swimmers.map(() => searchRnd())
  const score = closeness(tryPhases)
  if (score.penalty < best.penalty) [phases, best] = [tryPhases, score]
}
for (let round = 0; round < 6 && best.penalty > 0; round++) {
  for (let i = 0; i < phases.length; i++) {
    for (let k = 0; k < 48; k++) {
      const tryPhases = phases.slice()
      tryPhases[i] = k / 48
      const score = closeness(tryPhases)
      if (score.penalty < best.penalty) [phases, best] = [tryPhases, score]
    }
  }
}
console.log('koi overlap penalty', best.penalty.toFixed(1), '; phases', phases.map(p => p.toFixed(4)).join(' '))
// Each koi carries its own shadow: one translate list moves both, which keeps
// the scene under the backdrop size limit. The turning groups drop crispEdges:
// a rotating crispEdges group stalls the desktop app's renderer (Electron).
let fish = ''
for (const [k, [name, path, dur]] of swimmers.entries()) {
  const { moves, turns, start } = loop(path, phases[k])
  const timing = `dur="${dur}s" repeatCount="indefinite"`
  const turn = `<animateTransform attributeName="transform" type="rotate" values="${turns}" ${timing}/>`
  fish +=
    `<g transform="translate(${start[0].toFixed(1)} ${start[1].toFixed(1)})">` +
    `<animateTransform attributeName="transform" type="translate" values="${moves}" ${timing}/>` +
    `<g opacity=".35" transform="translate(4 5)"><g shape-rendering="auto">${turn}${koiArt[name].shadow}</g></g>` +
    `<g shape-rendering="auto">${turn}${koiArt[name].fish}</g></g>`
}

// Raindrops: now and then a drop lands and rings spread out.
const T = [7.3, 9.1, 11.7, 13.9]
// Each phase of a drop as [time in s, opacity] points. The rings spread fast
// and each one cross-fades into the next, wider one. The last ring fades out
// slowly, so the drop dies away the way it came in.
const PHASES = [
  [[0, 1], [0.08, 1], [0.2, 0]],
  [[0.06, 0], [0.1, 0.9], [0.22, 0.9], [0.36, 0]],
  [[0.2, 0], [0.26, 0.75], [0.42, 0.75], [0.6, 0]],
  [[0.42, 0], [0.5, 0.5], [0.7, 0.5], [0.95, 0]],
  [[0.72, 0], [0.82, 0.32], [1.05, 0.25], [1.7, 0]],
]
// A pixel ring drawn cell by cell, so it stays crisp at any scale.
const ring = (cx, cy, rad) => {
  const cells = {}
  const seen = new Set()
  for (let a = 0; a < 360; a += 2) {
    const x = Math.round(cx + Math.cos((a * Math.PI) / 180) * rad)
    const y = Math.round(cy + Math.sin((a * Math.PI) / 180) * rad * 0.92)
    const key = x + ',' + y
    if (seen.has(key)) continue
    seen.add(key)
    addCell(cells, C.sparkle, x, y)
  }
  return runs(cells)
}
const splash = () => { const c = {}; for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) addCell(c, '#ffffff', dx, dy); return runs(c) }
// The five phases of a drop around (0, 0): splash, then wider and fainter rings.
// Drawn once in <defs> and placed with <use href="#rN">: the desktop app's
// scrub keeps <use> with a same-document href, and the copies would not fit
// under the backdrop size limit.
const ringDefs = [splash(), ring(0, 0, 3), ring(0, 0, 6) + ring(0, 0, 2), ring(0, 0, 10) + ring(0, 0, 5), ring(0, 0, 14) + ring(0, 0, 8)]
  .map((art, n) => `<g id="r${n}">${art}</g>`)
  .join('')
const ringArt = [0, 1, 2, 3, 4].map(n => `<use href="#r${n}"/>`)
let drops = ''
for (let i = 0; i < 9; i++) {
  // The widest ring reaches 14 px, so a drop lands at least that far from a pad or stone.
  let x, y
  do {
    x = ri(30, W - 30)
    y = ri(20, H - 20)
  } while (dry.some(([cx, cy, rad]) => Math.hypot(x - cx, y - cy) < rad + 15))
  const t = T[i % T.length]
  const delay = -r(0, t)
  PHASES.forEach((points, n) => {
    const anim = fade(points, t, -delay)
    drops += `<g transform="translate(${x} ${y})" opacity="0">${anim}${ringArt[n]}</g>`
  })
}

// Cherry blossoms: now and then one falls into the pond, lands with a small
// ripple, then drifts with the current until it leaves the picture. Each one
// loops on its own long cycle, so landings stay rare and spread out.
const petalArt = i => {
  const cells = {}
  if (i % 5 < 3) {
    // A whole blossom: five rounded petals with a notch at each tip.
    const R = i % 2 === 0 ? 4.6 : 3.6
    const turn = r(0, Math.PI * 2)
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const d = Math.hypot(dx, dy)
        const a = Math.atan2(dy, dx) - turn
        const petal = 0.62 + 0.38 * Math.cos(5 * a)
        const notch = Math.abs(Math.sin(5 * a / 2 + Math.PI / 2)) < 0.12 && d > R * 0.75
        if (d > R * petal + 0.4 || notch) continue
        const color = d < 1.1 ? '#f6d36b' : d < R * petal - 1 ? '#f2b3c6' : '#fbe1e8'
        addCell(cells, color, dx, dy)
      }
    }
  } else {
    // A loose petal, two or three pixels.
    const color = pick(['#f2b6c8', '#f7cfdb', '#ea9db4'])
    addCell(cells, color, 0, 0)
    addCell(cells, color, 1, 0)
    if (rnd() < 0.5) addCell(cells, color, 0, 1)
  }
  return cells
}
const PETALS = 14
const FALL = 3
const current = 0.3
let floats = ''
for (let i = 0; i < PETALS; i++) {
  const cells = petalArt(i)
  const x = ri(30, W - 60)
  const y = ri(15, H - 15)
  // Drift with the current, right and a little down, until well past the edge.
  const angle = current + r(-0.4, 0.4)
  const speed = r(1.6, 2.6)
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)]
  const exits = [(W + 10 - x) / ux, uy > 0 ? (H + 10 - y) / uy : (y + 10) / -uy].filter(d => d > 0)
  const reach = Math.min(...exits)
  const drift = reach / speed
  const cycle = Math.max(r(150, 220), FALL + drift + 20)
  const ahead = (i / PETALS) * cycle + r(0, 8)
  const end = FALL + drift
  // The path sways a little across the current.
  // The fall drifts down from up-left with a sway, slowing as it nears the water.
  const path = []
  for (let k = 0; k <= 6; k++) {
    const u = k / 6
    const left = (1 - u) ** 1.6
    path.push([FALL * u, [-12 * left + Math.sin(u * Math.PI * 2) * 3 * (1 - u), -24 * left]])
  }
  const steps = Math.max(6, Math.round(drift / 4))
  for (let k = 1; k <= steps; k++) {
    const u = k / steps
    const side = Math.sin(u * drift * 0.5) * 0.8
    path.push([FALL + u * drift, [ux * reach * u - uy * side, uy * reach * u + ux * side]])
  }
  const shown = fade([[0, 0], [0.5, 1], [end, 1], [end + 0.01, 0]], cycle, ahead)
  // It starts large, as if close to the eye, and its shadow closes in as it lands.
  const fall = move([[0, [2.6]], [FALL * 0.6, [1.4]], [FALL, [1]]], cycle, ahead, 'scale')
  const shadowFall = move([[0, [12, 16]], [FALL * 0.6, [5, 7]], [FALL, [1, 1]]], cycle, ahead)
  const art = runs(cells)
  const shadow = art.replace(/fill="#[0-9a-f]+"/g, 'fill="#0b2a2c"')
  const ripple = [[1, 0, 0.5], [2, 0.25, 1.1], [3, 0.6, 1.8]]
    .map(([n, on, off]) => `<g opacity="0">${fade([[FALL + on, 0], [FALL + on + 0.1, 0.55], [FALL + off, 0]], cycle, ahead)}${ringArt[n]}</g>`)
    .join('')
  floats +=
    `<g transform="translate(${x} ${y})">${ripple}` +
    `<g>${move(path, cycle, ahead)}<g opacity="0">${shown}` +
    `<g opacity=".4"><g>${shadowFall}<g>${fall}${shadow}</g></g></g><g>${fall}${art}</g></g></g></g>`
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges">` +
  `<defs>${ringDefs}</defs>` +
  `<rect width="${W}" height="${H}" fill="${C.base}"/>` +
  depthSvg +
  pebbleSvg +
  fish +
  caustics +
  pads +
  floats +
  stoneSvg +
  drops +
  `</svg>`

writeFileSync(out, `// Generated by tools/gen-pond.mjs: a pixel-art koi pond seen from above.\nexport const SCENE = ${JSON.stringify(svg)}\n`)
if (previewOut) writeFileSync(previewOut, svg)
console.log('chars', svg.length)
