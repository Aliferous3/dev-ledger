export function isoDay(d){
  const pad2 = (x) => String(x).padStart(2,'0')
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`
}

export function validateRange(from, to){
  if(!from && !to) return { from:null, to:null }
  const re = /^\d{4}-\d{2}-\d{2}$/
  if(from && !re.test(from)) throw new Error('Invalid from date; expected YYYY-MM-DD')
  if(to && !re.test(to)) throw new Error('Invalid to date; expected YYYY-MM-DD')
  if(from && to && from > to) throw new Error('from must not be after to')
  const now = isoDay(new Date())
  if(from && from > now) throw new Error('from cannot be in the future')
  if(to && to > now) throw new Error('to cannot be in the future')
  return { from: from || null, to: to || null }
}

export function expandRange(mode){
  const t = new Date(); t.setUTCHours(0,0,0,0)
  const end = isoDay(t)
  const d = new Date(t)
  switch(mode){
    case '7d': d.setUTCDate(d.getUTCDate() - 6); return {from: isoDay(d), to: end}
    case '30d': d.setUTCDate(d.getUTCDate() - 29); return {from: isoDay(d), to: end}
    case '90d': d.setUTCDate(d.getUTCDate() - 89); return {from: isoDay(d), to: end}
    case 'ytd': return {from: `${t.getUTCFullYear()}-01-01`, to: end}
    case '1y': d.setUTCDate(d.getUTCDate() - 364); return {from: isoDay(d), to: end}
    case 'all': return {from: null, to: null}
    default: return {from: null, to: null}
  }
}

export function parseRange(query){
  const mode = query.range || null
  if(mode){
    if(!['7d','30d','90d','ytd','1y','all'].includes(mode)) throw new Error('Invalid range')
    return expandRange(mode)
  }
  const from = query.from || null
  const to = query.to || null
  return validateRange(from, to)
}
