// Scope derivation for ownership ingestion — pure, no I/O.
//
// Contract (spec §4.1, §8, RFC §18): persisted scopes are the repository
// scope plus DIRECTORY scopes only. File paths may exist transiently in
// memory during enumeration but a scope candidate for durable persistence
// can never be a file. Vendor/generated/build/dependency/submodule trees
// are filtered in memory and NEVER become ownership_scopes rows — not even
// as excluded=true rows; that flag is reserved for the cardinality cap.

import { createHash } from 'node:crypto'

export const MAX_DEPTH = 4
export const MAX_DISPLAY_PATH_LENGTH = 200
export const MAX_DIR_SCOPES = 500

// Repository-scope hash sentinel: a fixed constant carrying no repository
// name, owner login, full_name, or GitHub id. Uniqueness comes from the
// (repository_id, scope_path_hash) pair, so one sentinel is safe. The 'dir'
// prefix on directory hashes gives the two namespaces domain separation.
export const REPO_SCOPE_SENTINEL = 'devledger-ownership-scope-v1:repo'
const DIR_HASH_PREFIX = 'devledger-ownership-scope-v1:dir:'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

export function repoScopePathHash() {
  return sha256(REPO_SCOPE_SENTINEL)
}

// Deliberately NOT rename-stable: the hash tracks the current normalized
// path (spec §8 — a rename produces a new scope identity in V1).
export function dirScopePathHash(normalizedPath) {
  return sha256(DIR_HASH_PREFIX + normalizedPath)
}

// Path normalization for hashing/persistence:
//   canonical '/' separators, no leading/trailing slash, no empty segments.
// Rejects (returns null): non-strings, empty/blank paths, traversal-like
// segments ('.', '..'), and NUL/control characters.
export function normalizePath(raw) {
  if (typeof raw !== 'string') return null
  const collapsed = raw.replace(/\\/g, '/').replace(/\/+/g, '/')
  const trimmed = collapsed.replace(/^\/+|\/+$/g, '')
  if (trimmed === '') return null
  const segments = trimmed.split('/')
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..' || seg.trim() === '') return null
    if (/[\x00-\x1f]/.test(seg)) return null
  }
  return segments.join('/')
}

export function pathDepth(normalizedPath) {
  return normalizedPath === null ? 0 : normalizedPath.split('/').length
}

// A normalized directory path qualifies as a persisted dir scope only when
// it fits the bounded envelope.
export function isValidDirScopePath(normalizedPath) {
  return (
    normalizedPath !== null &&
    normalizedPath.length <= MAX_DISPLAY_PATH_LENGTH &&
    pathDepth(normalizedPath) <= MAX_DEPTH
  )
}

// ── exclusion policy ──────────────────────────────────────────────────────
// Conservative, high-confidence classes only — this list must never grow
// into a generic ignore file that silently drops legitimate source dirs.
// Matching is per path SEGMENT, so nested vendored trees (e.g.
// packages/x/node_modules) are caught without enumerating them.
//
//   dependency / vendored: node_modules, bower_components, vendor, Pods,
//     Python virtualenvs (.venv/venv/.tox)
//   generated / build output: dist, build, out, target, obj, coverage,
//     generated/__generated__, framework output dirs (.next/.nuxt/.output/
//     .svelte-kit/.turbo/.cache)
//   VCS internals (defensive): .git/.svn/.hg — a real tree never contains
//     these, but a hostile path name should not become a scope either.
// Submodules are excluded by git ENTRY TYPE ('commit' gitlink), never by a
// filename guess — see deriveScopeCandidates.
const EXCLUDED_SEGMENT_NAMES = new Set([
  'node_modules', 'bower_components', 'vendor', 'pods',
  '.venv', 'venv', '.tox',
  'dist', 'build', 'out', 'target', 'obj', 'coverage',
  'generated', '__generated__',
  '.next', '.nuxt', '.output', '.svelte-kit', '.turbo', '.cache',
  '.git', '.svn', '.hg',
])

export function isExcludedPath(normalizedPath) {
  if (normalizedPath === null) return false
  return normalizedPath
    .split('/')
    .some((seg) => EXCLUDED_SEGMENT_NAMES.has(seg.toLowerCase()))
}

// ── binary-blob exclusion ─────────────────────────────────────────────────
// Conservative extension classes only — high-confidence non-source content.
// Deliberately NOT an asset blacklist: SVG (XML text), source maps, lockfiles,
// configs, scripts, and ordinary text/source formats stay eligible. A blob
// classified binary never causes ancestor directories to become scopes, so a
// directory containing only binaries produces no scope.
const BINARY_EXTENSIONS = new Set([
  // raster images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff', 'tif',
  'heic', 'heif', 'psd',
  // audio / video
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a',
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'm4v',
  // archives / packages
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
  'jar', 'war', 'ear', 'apk', 'dmg', 'iso', 'msi', 'nupkg',
  // compiled objects / binaries
  'exe', 'dll', 'so', 'dylib', 'a', 'o', 'obj', 'class',
  'pyc', 'pyo', 'wasm', 'lib', 'bin',
  // fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // binary documents / data stores
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'db', 'sqlite', 'sqlite3', 'parquet',
])

export function isBinaryBlobPath(normalizedPath) {
  if (normalizedPath === null) return false
  const name = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false // dotfiles and extensionless names are not binary by convention
  return BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

// ── scope candidates ──────────────────────────────────────────────────────

function dirCandidate(normalizedPath) {
  return {
    scope_type: 'dir',
    display_path: normalizedPath,
    depth: pathDepth(normalizedPath),
    scope_path_hash: dirScopePathHash(normalizedPath),
  }
}

export function repoScopeCandidate() {
  return {
    scope_type: 'repo',
    display_path: null,
    depth: 0,
    scope_path_hash: repoScopePathHash(),
  }
}

// Deterministic ordering independent of API/tree response order:
// shallower depth first, then normalized path ascending (UTF-16 code-unit
// comparison — stable across processes and locales).
function compareDirs(a, b) {
  if (a.depth !== b.depth) return a.depth - b.depth
  return a.display_path < b.display_path ? -1 : a.display_path > b.display_path ? 1 : 0
}

// Turn raw tree enumeration output into persistable scope candidates.
//
// entries: [{ path, type }] where type is the git object type — 'tree'
// (directory), 'blob' (file), 'commit' (submodule gitlink), or anything
// else (ignored).
//
// Rules:
//  - 'commit' entries are submodules: excluded in memory, never scopes.
//  - 'tree' entries never create scopes by themselves — directory
//    candidates are derived from ELIGIBLE DESCENDANT BLOBS (Git does not
//    track empty directories; a dir containing only binary or
//    excluded-class content is not a scope).
//  - a 'blob' qualifies only when its path is valid, not exclusion-class,
//    and not a binary extension — it then marks every ancestor directory.
//  - blob paths themselves NEVER become scope candidates.
//  - >MAX_DIR_SCOPES otherwise-valid dirs resolve deterministically by
//    compareDirs; overflow is returned (NOT persisted, NOT marked here)
//    so the persistence tranche can flag it 'cardinality_cap'.
//
// Returns { scopes, overflow } — 'scopes' always begins with the repo
// scope followed by <= MAX_DIR_SCOPES dir candidates; 'overflow' holds the
// deterministic remainder (possibly empty). No file path ever appears in
// either list.
export function deriveScopeCandidates(entries, { maxDirScopes = MAX_DIR_SCOPES } = {}) {
  const dirs = new Set()
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.path !== 'string' || entry.type !== 'blob') continue
    const normalized = normalizePath(entry.path)
    if (normalized === null) continue
    if (isExcludedPath(normalized) || isBinaryBlobPath(normalized)) continue
    const segments = normalized.split('/')
    // ancestors only — the file's own path never enters the scope set
    for (let i = 1; i < segments.length; i++) {
      dirs.add(segments.slice(0, i).join('/'))
    }
  }

  const candidates = []
  for (const dir of dirs) {
    if (!isValidDirScopePath(dir) || isExcludedPath(dir)) continue
    candidates.push(dirCandidate(dir))
  }
  candidates.sort(compareDirs)

  const selected = candidates.slice(0, maxDirScopes)
  const overflow = candidates.slice(maxDirScopes)
  return { scopes: [repoScopeCandidate(), ...selected], overflow }
}
