import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { seedTopology, addCommit, nearestNode, edgePath, TOPO_W, TOPO_H } from '../src/gitGraph.js'

test('seed topology is deterministic', () => {
  assert.deepEqual(seedTopology(), seedTopology())
})

test('seed graph is a connected main line with branches', () => {
  const t = seedTopology()
  const main = t.nodes.filter((n) => n.lane === 0)
  const branches = t.nodes.filter((n) => n.lane !== 0)
  assert.ok(main.length >= 4, 'main line has several commits')
  assert.ok(branches.length >= 2, 'at least one branch exists')
  for (const e of t.edges) {
    assert.ok(t.nodes.some((n) => n.id === e.a) && t.nodes.some((n) => n.id === e.b))
  }
})

test('click-to-commit creates a child linked to its parent', () => {
  const t = seedTopology()
  const next = addCommit(t, 'n4')
  const node = next.nodes.find((n) => n.id === next.added)
  assert.equal(next.nodes.length, t.nodes.length + 1)
  assert.equal(node.parentId, 'n4')
  assert.ok(next.edges.some((e) => e.a === 'n4' && e.b === node.id))
  assert.ok(node.x > 0 && node.x <= TOPO_W && node.y > 0 && node.y <= TOPO_H)
})

test('node ids stay unique across many commits', () => {
  let t = seedTopology()
  for (let i = 0; i < 12; i++) t = addCommit(t, t.nodes[t.nodes.length - 1].id)
  const ids = new Set(t.nodes.map((n) => n.id))
  assert.equal(ids.size, t.nodes.length)
})

test('drag/double-click placement clamps inside the viewBox', () => {
  const t = seedTopology()
  const next = addCommit(t, 'n1', { x: 9999, y: -50 })
  const node = next.nodes.find((n) => n.id === next.added)
  assert.ok(node.x <= TOPO_W - 14 && node.y >= 22)
})

test('nearestNode returns the closest commit', () => {
  const t = seedTopology()
  const n0 = t.nodes[0]
  assert.equal(nearestNode(t, n0.x + 3, n0.y - 2).id, 'n0')
})

test('edgePath: straight within a lane, curved across lanes', () => {
  assert.match(edgePath({ x: 0, y: 100 }, { x: 50, y: 100 }), /^M .* L /)
  assert.match(edgePath({ x: 0, y: 100 }, { x: 50, y: 140 }), /^M .* C /)
})

test('app background token is #131413', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(css, /--app-bg:\s*#131413/)
  assert.doesNotMatch(css, /--bg:\s*#0a0a0a/)
})
