/* Tiny deterministic Git-topology model for the login page's interactive
   toy. Pure functions, in-memory only — nothing here is the visitor's
   data and nothing persists.

   Layout space is a fixed viewBox; the seed graph is a short main line
   with one low branch and one twig — sparse by design. */

export const TOPO_W = 460
export const TOPO_H = 220
const MAIN_Y = 104
const STEP = 54
const LANE = 42

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clampX = (x) => Math.min(Math.max(x, 14), TOPO_W - 14)
const clampY = (y) => Math.min(Math.max(y, 22), TOPO_H - 22)

/* Seed graph: node0 → n1 → n2 → n3 → n4 along main; a branch leaves n2
   down-right; a short twig rises off n4. Each element carries a `d`
   entrance delay so the toy self-assembles inside login PHASE 5. */
export function seedTopology({ seed = 11, base = 2.0, step = 0.14 } = {}) {
  const rand = mulberry32(seed)
  const j = () => (rand() - 0.5) * 6
  const nodes = [
    { id: 'n0', x: 22, y: MAIN_Y + j(), parentId: null, lane: 0 },
    { id: 'n1', x: 76, y: MAIN_Y + j(), parentId: 'n0', lane: 0 },
    { id: 'n2', x: 130, y: MAIN_Y + j(), parentId: 'n1', lane: 0 },
    { id: 'n3', x: 184, y: MAIN_Y + j(), parentId: 'n2', lane: 0 },
    { id: 'n4', x: 238, y: MAIN_Y + j(), parentId: 'n3', lane: 0 },
    { id: 'n5', x: 168, y: MAIN_Y + LANE + j(), parentId: 'n2', lane: 1 },
    { id: 'n6', x: 224, y: MAIN_Y + LANE + j(), parentId: 'n5', lane: 1 },
    { id: 'n7', x: 292, y: MAIN_Y - LANE * 0.62 + j(), parentId: 'n4', lane: -1 },
  ]
  let d = base
  for (const n of nodes) {
    n.d = +d.toFixed(2)
    d += step
  }
  const edges = nodes
    .filter((n) => n.parentId)
    .map((n) => ({ id: `e-${n.parentId}-${n.id}`, a: n.parentId, b: n.id, d: +(n.d - 0.09).toFixed(2) }))
  return { nodes, edges, nextId: 8, lastMain: 'n4' }
}

/* SVG path for an edge — straight within a lane, shallow S-curve when
   crossing lanes. */
export function edgePath(a, b) {
  if (Math.abs(a.y - b.y) < 2) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  const mx = a.x + (b.x - a.x) * 0.55
  return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`
}

export function nearestNode(topo, x, y) {
  let best = null
  let bd = Infinity
  for (const n of topo.nodes) {
    const d = (n.x - x) ** 2 + (n.y - y) ** 2
    if (d < bd) { bd = d; best = n }
  }
  return best
}

/* Create a child commit. `at` is optional (drag/double-click supplies a
   point); without it the commit continues the parent's lane, or drops to
   the next free lane when the lane ahead is occupied. */
export function addCommit(topo, parentId, at = null) {
  const parent = topo.nodes.find((n) => n.id === parentId)
  if (!parent) return topo
  const id = `n${topo.nextId}`
  let x, y, lane
  if (at) {
    x = clampX(at.x)
    y = clampY(at.y)
    lane = Math.round((y - MAIN_Y) / LANE)
  } else {
    const occupied = new Set(topo.nodes.filter((n) => n.x > parent.x + STEP * 0.5).map((n) => n.lane))
    lane = parent.lane
    if (occupied.has(lane)) lane = lane <= 0 ? minLane(topo) - 1 : maxLane(topo) + 1
    x = clampX(parent.x + STEP)
    y = clampY(MAIN_Y + lane * LANE)
  }
  const node = { id, x, y, parentId, lane, d: 0 }
  const edge = { id: `e-${parentId}-${id}`, a: parentId, b: id, d: 0 }
  return {
    nodes: [...topo.nodes, node],
    edges: [...topo.edges, edge],
    nextId: topo.nextId + 1,
    lastMain: lane === 0 ? id : topo.lastMain,
    added: id,
  }
}

const minLane = (t) => Math.min(...t.nodes.map((n) => n.lane))
const maxLane = (t) => Math.max(...t.nodes.map((n) => n.lane))
