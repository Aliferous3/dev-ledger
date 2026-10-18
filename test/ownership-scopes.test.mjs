// Phase 1C-A scope/tree contract — normalization, exclusion classes,
// file-path-never-persisted, deterministic caps, and hash semantics.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  MAX_DEPTH,
  MAX_DISPLAY_PATH_LENGTH,
  MAX_DIR_SCOPES,
  REPO_SCOPE_SENTINEL,
  repoScopePathHash,
  dirScopePathHash,
  normalizePath,
  pathDepth,
  isValidDirScopePath,
  isExcludedPath,
  repoScopeCandidate,
  deriveScopeCandidates,
} = await import('../lib/ownership/scopes.mjs')

/* ── normalization ───────────────────────────────────────────────────── */

test('paths normalize to canonical form', () => {
  assert.equal(normalizePath('src/api/routes'), 'src/api/routes')
  assert.equal(normalizePath('/src/api/'), 'src/api')
  assert.equal(normalizePath('src//api///routes'), 'src/api/routes')
  assert.equal(normalizePath('src\\api\\routes'), 'src/api/routes')
  assert.equal(normalizePath('a'), 'a')
  assert.equal(pathDepth('a/b/c/d'), 4)
})

test('malformed/traversal/empty paths are rejected', () => {
  for (const bad of ['', '/', '///', ' ', null, undefined, 42, {},
    'a/./b', 'a/../b', '..', '.', '../x', 'a/b/../c',
    'a\0b', 'ab']) {
    assert.equal(normalizePath(bad), null, `rejected ${JSON.stringify(bad)}`)
  }
})

test('dir scope envelope: depth <= 4, length <= 200', () => {
  assert.equal(isValidDirScopePath('a/b/c/d'), true)
  assert.equal(isValidDirScopePath('a/b/c/d/e'), false, 'depth 5')
  assert.equal(isValidDirScopePath('x'.repeat(200)), true)
  assert.equal(isValidDirScopePath('x'.repeat(201)), false, '>200')
  assert.equal(isValidDirScopePath(null), false)
})

/* ── hashes ──────────────────────────────────────────────────────────── */

test('scope hashes are deterministic, domain-separated, and sentinel-free of identity', () => {
  const a = dirScopePathHash('src/api')
  assert.equal(a, dirScopePathHash('src/api'), 'deterministic')
  assert.match(a, /^[0-9a-f]{64}$/)
  const r = repoScopePathHash()
  assert.equal(r, repoScopePathHash(), 'repo hash deterministic')
  assert.match(r, /^[0-9a-f]{64}$/)
  assert.notEqual(a, r, 'dir and repo hash namespaces are separated')
  assert.ok(!REPO_SCOPE_SENTINEL.includes('github'), 'sentinel carries no provider identity')
  // not rename-stable by design — a moved directory is a new scope identity
  assert.notEqual(dirScopePathHash('old/dir'), dirScopePathHash('new/dir'))
})

/* ── exclusion classes ───────────────────────────────────────────────── */

test('vendor/generated/build/dependency segments are excluded at any depth', () => {
  for (const p of ['node_modules', 'src/node_modules/x', 'a/vendor/b',
    'packages/web/dist', 'lib/build', 'x/out/y', 'srv/target', 'app/coverage',
    'api/generated', 'x/__generated__', 'a/Pods/b', 'e/.venv/lib',
    'repo/.git/objects']) {
    assert.equal(isExcludedPath(p), true, p)
  }
})

test('legitimate source directories are NOT excluded', () => {
  for (const p of ['src', 'src/api', 'app/components', 'lib', 'packages/core',
    'internal/server', 'docs', 'scripts', 'bin', 'test', 'web/public',
    'generator', 'vendorsmith', 'distributor', 'outlines', 'builder']) {
    assert.equal(isExcludedPath(p), false, p)
  }
})

/* ── enumeration → candidates ────────────────────────────────────────── */

test('repo scope is always present with fixed shape', () => {
  const { scopes } = deriveScopeCandidates([])
  assert.deepEqual(scopes[0], {
    scope_type: 'repo', display_path: null, depth: 0,
    scope_path_hash: repoScopePathHash(),
  })
  assert.equal(scopes.length, 1)
})

test('file paths NEVER become scope candidates', () => {
  const entries = [
    { path: 'src/api/index.ts', type: 'blob' },
    { path: 'src/api/routes/user.ts', type: 'blob' },
    { path: 'README.md', type: 'blob' },
    { path: 'src/api/routes', type: 'tree' },
    { path: 'src/api', type: 'tree' },
    { path: 'src', type: 'tree' },
  ]
  const { scopes, overflow } = deriveScopeCandidates(entries)
  const paths = scopes.map((s) => s.display_path).filter(Boolean)
  for (const p of paths) {
    for (const e of entries.filter((e) => e.type === 'blob')) {
      assert.notEqual(p, e.path, `file path ${e.path} became a scope`)
    }
  }
  assert.deepEqual(new Set(paths), new Set(['src', 'src/api', 'src/api/routes']))
  assert.equal(overflow.length, 0)
  // no candidate ever carries a 'file' scope type
  for (const s of scopes) assert.ok(s.scope_type === 'repo' || s.scope_type === 'dir')
})

test('blob ancestors are inferred when the tree is a flat file listing', () => {
  const { scopes } = deriveScopeCandidates([
    { path: 'a/b/file1.ts', type: 'blob' },
    { path: 'a/c/file2.ts', type: 'blob' },
  ])
  const paths = scopes.map((s) => s.display_path)
  assert.ok(paths.includes('a') && paths.includes('a/b') && paths.includes('a/c'))
})

test('submodule gitlinks are excluded by entry type, never by name', () => {
  const { scopes } = deriveScopeCandidates([
    { path: 'third_party/repo', type: 'commit' },      // submodule — excluded
    { path: 'third_party/normal/file.ts', type: 'blob' }, // its sibling dir survives
  ])
  const paths = scopes.map((s) => s.display_path)
  assert.ok(!paths.includes('third_party/repo'), 'submodule path must not be a scope')
  assert.ok(paths.includes('third_party') && paths.includes('third_party/normal'))
})

test('excluded-class paths never appear in candidates OR overflow', () => {
  const entries = [
    { path: 'src/ok.ts', type: 'blob' },
    { path: 'node_modules/pkg/index.js', type: 'blob' },
    { path: 'a/node_modules/deep/x.js', type: 'blob' },
    { path: 'dist/bundle.js', type: 'blob' },
    { path: 'api/generated/client.ts', type: 'blob' },
  ]
  const { scopes, overflow } = deriveScopeCandidates(entries)
  const all = [...scopes, ...overflow].map((s) => s.display_path).filter(Boolean)
  for (const p of all) assert.equal(isExcludedPath(p), false, `${p} leaked`)
  // 'a' and 'api' are real dirs whose only listed subtree is excluded — the
  // dirs themselves remain valid scopes; the excluded paths do not appear
  assert.deepEqual(all, ['a', 'api', 'src'])
})

test('>500 otherwise-valid dirs resolve deterministically (depth, then path)', () => {
  const entries = []
  // 4 shallow dirs each with 200 children = 800 otherwise-valid dir scopes
  for (const top of ['a', 'b', 'c', 'd']) {
    for (let i = 0; i < 200; i++) {
      entries.push({ path: `${top}/d${String(i).padStart(3, '0')}/f.ts`, type: 'blob' })
    }
  }
  const { scopes, overflow } = deriveScopeCandidates(entries)
  const dirs = scopes.slice(1)
  assert.equal(dirs.length, MAX_DIR_SCOPES)
  assert.ok(overflow.length > 0)
  // ordering: depth 1 first (a,b,c,d), then depth 2 lexical — never input order
  assert.deepEqual(dirs.slice(0, 4).map((s) => s.display_path), ['a', 'b', 'c', 'd'])
  assert.equal(dirs[4].display_path, 'a/d000')
  // determinism: shuffled input produces the same selection
  const shuffled = [...entries].reverse()
  const again = deriveScopeCandidates(shuffled)
  assert.deepEqual(again.scopes, scopes)
  assert.deepEqual(again.overflow, overflow)
  // overflow entries are valid-but-omitted dirs — persistence may later mark
  // them 'cardinality_cap'; nothing here fabricates exclusion rows
  for (const o of overflow) {
    assert.equal(o.scope_type, 'dir')
    assert.equal(isExcludedPath(o.display_path), false)
  }
})

test('candidate shape maps onto ownership_scopes columns only', () => {
  const { scopes } = deriveScopeCandidates([{ path: 'x/y/f.ts', type: 'blob' }])
  for (const s of scopes) {
    assert.deepEqual(Object.keys(s).sort(),
      ['depth', 'display_path', 'scope_path_hash', 'scope_type'])
    if (s.scope_type === 'dir') {
      assert.equal(s.depth, s.display_path.split('/').length)
      assert.equal(s.scope_path_hash, dirScopePathHash(s.display_path))
    }
  }
})
