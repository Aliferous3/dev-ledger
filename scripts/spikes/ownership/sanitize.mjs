// Sanitization helpers for committed spike output.
//
// The committed report must never disclose private repository names,
// contributor logins, commit SHAs, or private file paths. Raw results stay
// in the gitignored .tmp/ directory; anything rendered into the committed
// markdown report goes through these helpers.

const SHA_RE = /\b[0-9a-f]{40}\b/gi
const SHA7_RE = /\b[0-9a-f]{7}\b/g

// Stable anonymized label per private repo, assigned in encounter order.
export function makeRepoLabeler() {
  const map = new Map()
  let n = 0
  return (fullName, isPrivate) => {
    if (!isPrivate) return fullName
    if (!map.has(fullName)) map.set(fullName, `PRIVATE_${'ABCDEFGH'[n++]}`)
    return map.get(fullName)
  }
}

// Strip identifiers from a string destined for committed output.
export function sanitizeText(s, { repoNames = [], logins = [] } = {}) {
  let out = String(s)
  for (const name of repoNames) out = out.split(name).join('<repo>')
  for (const login of logins) out = out.split(login).join('<contributor>')
  out = out.replace(SHA_RE, '<sha40>')
  return out
}

// Reduce raw measurements into the committed-report-safe shape: counts and
// aggregates only, no identity fields.
export function summarizeBlameRanges(ranges) {
  let lines = 0
  const contributors = new Set()
  const commits = new Set()
  let unlinkedRanges = 0
  let unlinkedLines = 0
  for (const r of ranges || []) {
    const span = r.endingLine - r.startingLine + 1
    lines += span
    commits.add(r.commit?.oid)
    const login = r.commit?.author?.user?.login || null
    if (login) contributors.add(login)
    else {
      unlinkedRanges++
      unlinkedLines += span
    }
  }
  return {
    ranges: (ranges || []).length,
    lines,
    distinctCommits: commits.size,
    linkedContributors: contributors.size,
    unlinkedRanges,
    unlinkedLines,
    linkedRangeShare: ranges?.length ? (ranges.length - unlinkedRanges) / ranges.length : 0,
    linkedLineShare: lines ? (lines - unlinkedLines) / lines : 0,
    unlinkedRangeShare: ranges?.length ? unlinkedRanges / ranges.length : 0,
    unlinkedLineShare: lines ? unlinkedLines / lines : 0,
  }
}
