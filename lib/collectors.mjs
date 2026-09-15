import { exec, execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { promisify } from 'node:util'


const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

function shellEscape(arg){
  if (/[\s"'&|<>^%]/.test(arg)) return JSON.stringify(arg)
  return arg
}
const clocCache = new Map()
const CLOC_CACHE_MS = 20 * 60 * 1000

function isoDay(d){
  const pad2 = (x) => String(x).padStart(2,'0')
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`
}

function validateRange(from, to){
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

function expandRange(mode){
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

function parseRange(query){
  const mode = query.range || null
  if(mode){
    if(!['7d','30d','90d','ytd','1y','all'].includes(mode)) throw new Error('Invalid range')
    return expandRange(mode)
  }
  const from = query.from || null
  const to = query.to || null
  return validateRange(from, to)
}
const skipDirs = new Set(['.git','node_modules','.next','dist','build','out','coverage','.turbo','.venv','venv','vendor','target','.cache','.idea','.vscode'])
const generatedFile = p => /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|dist|build|out|coverage|\.next|generated|vendor)(\/|$)/i.test(p.replaceAll('\\','/')) || /\.(map|min\.js|min\.css)$/i.test(p)
const ancillaryFile = p => /\.(json|jsonc|md|mdx|markdown|ya?ml|toml|ini|cfg|conf|csv|tsv|txt|xml|svg|lock)$/i.test(p) || /(^|\/)(license|readme|changelog|authors|contributors)(\.|$)/i.test(p.replaceAll('\\','/'))
const sourceFile = p => !generatedFile(p) && !ancillaryFile(p) && !/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp4|mov|mp3|wav)$/i.test(p)

async function run(cmd,args=[],cwd=undefined,timeout=12000){
  try {
    const { stdout } = await execFileAsync(cmd,args,{cwd,encoding:'utf8',timeout,maxBuffer:64*1024*1024,windowsHide:true,env:{...process.env,NO_COLOR:'1',FORCE_COLOR:'0'}})
    return String(stdout || '').trim()
  } catch { return '' }
}
async function runDetailed(cmd,args=[],cwd=undefined,timeout=12000,shell=false){
  try {
    const {stdout,stderr}=await execFileAsync(cmd,args,{cwd,encoding:'utf8',timeout,maxBuffer:64*1024*1024,windowsHide:true,shell,env:{...process.env,NO_COLOR:'1',FORCE_COLOR:'0'}})
    return {ok:true,stdout:String(stdout||'').trim(),stderr:String(stderr||'').trim(),error:''}
  } catch(e){
    return {ok:false,stdout:String(e.stdout||'').trim(),stderr:String(e.stderr||'').trim(),error:e.killed?`Timed out after ${timeout/1000}s`:(e.message||'Command failed')}
  }
}

async function resolveCloc(){
  const candidates = [
    'cloc',
    path.join(process.env.LOCALAPPDATA || '','Microsoft','WinGet','Links','cloc.exe'),
    path.join(process.env.ProgramFiles || '','cloc','cloc.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '','cloc','cloc.exe'),
  ]
  for(const c of candidates){
    if(!c) continue
    try{ if(fs.existsSync(c)) return c }catch{}
  }
  const found = await run(process.platform==='win32'?'where.exe':'which',['cloc'],undefined,3000)
  return found ? 'cloc' : null
}
async function existsCmd(cmd){ return !!(await run(process.platform==='win32'?'where.exe':'which',[cmd],undefined,3000)) }

async function collectCandidates(root){
  const out=[]
  const walk=(dir,depth=0)=>{
    if(depth>4) return
    let entries=[]
    try { entries=fs.readdirSync(dir,{withFileTypes:true}) } catch { return }
    const hasGit=entries.some(e=>e.name==='.git')
    if(hasGit && dir!==root){
      out.push(path.resolve(dir)); return
    }
    for(const e of entries){
      if(!e.isDirectory() || skipDirs.has(e.name)) continue
      if(e.name.startsWith('.')) continue
      walk(path.join(dir,e.name),depth+1)
    }
  }
  walk(root)
  if(!out.length && fs.existsSync(path.join(root,'.git'))) out.push(path.resolve(root))
  return out
}

function normalizeRemote(url){
  if(!url) return ''
  const u=url.replace(/\.git$/i,'').replace(/^git@([^:]+):/,'$1/').replace(/^https?:\/\//,'').replace(/^ssh:\/\//,'').replace(/\\/g,'/').toLowerCase()
  return u
}

async function auditRepos(root){
  const candidates = await collectCandidates(root)
  const details=[]
  for(const c of candidates){
    const gitPath=path.join(c,'.git')
    let gitType='unknown', gitTopLevel=c, gitCommon='', gitDir='', remote='', included=false, reason=''
    try {
      gitTopLevel = path.resolve(await run('git',['rev-parse','--show-toplevel'],c,8000) || c)
      gitCommon = await run('git',['rev-parse','--git-common-dir'],c,8000) || ''
      if(gitCommon) gitCommon = path.resolve(gitTopLevel, gitCommon)
      gitDir = await run('git',['rev-parse','--git-dir'],c,8000) || ''
      if(gitDir) gitDir = path.resolve(gitTopLevel, gitDir)
      remote = await run('git',['remote','get-url','origin'],gitTopLevel,5000) || ''
    } catch(e){ reason=`git metadata read failed: ${e.message}` }

    if(!reason){
      const relCommon = gitCommon ? path.relative(gitTopLevel, gitCommon).replace(/\\/g,'/') : ''
      const relGit = gitDir ? path.relative(gitTopLevel, gitDir).replace(/\\/g,'/') : ''
      if(relGit==='.git'){ gitType='main' }
      else if(/(?:^|\/)worktrees\//.test(gitDir.replace(/\\/g,'/'))){ gitType='worktree' }
      else if(/(?:^|\/)modules\//.test(gitDir.replace(/\\/g,'/'))){ gitType='submodule' }
      else if(relGit && !relGit.startsWith('..')){ gitType='main' }
      else if(fs.existsSync(gitPath) && fs.lstatSync(gitPath).isFile()){ gitType='worktree' }
      else { gitType='unknown' }
    }

    details.push({
      path: c,
      repoName: path.basename(c),
      gitType,
      gitTopLevel,
      gitCommon,
      gitDir,
      remote,
      normalizedRemote: normalizeRemote(remote),
      included,
      reason
    })
  }

  // Dedupe by canonical key (remote, else common git dir).
  const byKey = new Map()
  for(const d of details){
    const key = d.normalizedRemote || d.gitCommon || d.gitTopLevel
    const list = byKey.get(key) || []
    list.push(d); byKey.set(key, list)
  }

  const chosen = new Map()
  for(const [key, list] of byKey){
    // Prefer a main repo; if not present, prefer the shallowest path.
    let best = list.find(d=>d.gitType==='main') || list.slice().sort((a,b)=>a.gitTopLevel.length-b.gitTopLevel.length)[0]
    chosen.set(key, best)
    for(const d of list){
      if(d.gitTopLevel === best.gitTopLevel) continue
      if(d.gitType==='submodule'){ d.included=false; d.reason=`submodule (nested dependency) of ${path.basename(best.gitTopLevel)}` }
      else if(d.gitType==='worktree'){ d.included=false; d.reason=`linked worktree of ${path.basename(best.gitTopLevel)}` }
      else if(d.gitTopLevel.startsWith(best.gitTopLevel + path.sep)){
        d.included=false; d.reason=`nested working copy inside ${path.basename(best.gitTopLevel)}`
      } else if(list.length>1){
        d.included=false; d.reason=`duplicate of ${path.basename(best.gitTopLevel)} (${best.gitCommon||best.normalizedRemote})`
      }
    }
  }

  for(const best of chosen.values()){
    if(best.gitType==='submodule'){ best.included=false; best.reason='submodule (nested dependency)' }
    else if(best.gitType==='worktree' && !details.some(d=>d.gitType==='main' && (d.normalizedRemote===best.normalizedRemote || d.gitCommon===best.gitCommon) && d!==best)){
      // Worktree whose main is not under the root: keep as the canonical working copy.
      best.included=true; best.reason='canonical working copy (main not under scan root)'
    } else {
      best.included=true; best.reason='canonical repository'
    }
  }

  // Exclude local clones whose origin is another repo already discovered under the scan root.
  const includedTops = new Map(details.filter(d=>d.included).map(d=>[d.gitTopLevel.toLowerCase(), d]))
  for(const d of details){
    if(!d.included || !d.remote) continue
    if(/^https?:\/\/|^[a-z][a-z0-9-]*@|^[a-z][a-z0-9-]+:/i.test(d.remote)) continue
    const target = path.resolve(d.remote).toLowerCase()
    const other = includedTops.get(target)
    if(other && other.gitTopLevel.toLowerCase() !== d.gitTopLevel.toLowerCase()){
      d.included=false; d.reason=`local clone of ${other.repoName}`
    }
  }

  return {candidates: details, included: details.filter(d=>d.included).map(d=>d.gitTopLevel)}
}

async function discoverRepos(root){
  if(!fs.existsSync(root)) return []
  const { included } = await auditRepos(root)
  return [...new Set(included)]
}

async function parseLog(repo, from=null, to=null){
  const args=['log','--all','--pretty=format:@@C@@|%H|%aI|%s','--numstat']
  if(from) args.push(`--since=${from}T00:00:00Z`)
  if(to){
    const end = new Date(to + 'T00:00:00Z')
    end.setUTCDate(end.getUTCDate() + 1)
    const endIso = end.toISOString().slice(0,10)
    args.push(`--until=${endIso}T00:00:00Z`)
  }
  const txt=await run('git',args,repo,15000)
  const daily=new Map(), dates=new Set(), files=new Set(), rhythm=new Map()
  let commits=0, allAdded=0, allDeleted=0, sourceAdded=0, sourceDeleted=0, first=null,last=null, firstIso=null,lastIso=null, currentDate=null, currentIso=null
  for(const line of txt.split(/\r?\n/)){
    if(line.startsWith('@@C@@|')){
      const p=line.split('|'); currentIso=p[2]; const d=new Date(currentIso)
      const y=d.getFullYear(), mo=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0')
      currentDate=`${y}-${mo}-${da}`
      commits++; dates.add(currentDate)
      if(!first||currentDate<first){ first=currentDate; firstIso=currentIso }
      if(!last||currentDate>last){ last=currentDate; lastIso=currentIso }
      if(!daily.has(currentDate)) daily.set(currentDate,{date:currentDate,commits:0,added:0,deleted:0,changed:0})
      daily.get(currentDate).commits++
      const wd=d.getDay(), hr=d.getHours()
      const key=`${wd}-${hr}`
      if(!rhythm.has(key)) rhythm.set(key,{weekday:wd,hour:hr,commits:0,dates:new Set()})
      const rc=rhythm.get(key); rc.commits++; rc.dates.add(currentDate)
      continue
    }
    const m=line.match(/^(\d+)\s+(\d+)\s+(.+)$/); if(!m) continue
    const a=Number(m[1]),d=Number(m[2]),f=m[3]
    allAdded+=a; allDeleted+=d; files.add(f)
    if(sourceFile(f)){
      sourceAdded+=a; sourceDeleted+=d
      if(currentDate){ const x=daily.get(currentDate); x.added+=a; x.deleted+=d; x.changed+=a+d }
    }
  }
  const rhythmArr=[...rhythm.values()].map(r=>({weekday:r.weekday,hour:r.hour,commits:r.commits,days:r.dates.size}))
  return {commits,allAdded,allDeleted,sourceAdded,sourceDeleted,activeDays:dates.size,firstCommit:first,lastCommit:last,firstCommitAt:firstIso,lastCommitAt:lastIso,uniqueFiles:files.size,daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)),rhythm:rhythmArr}
}

async function clocRepo(repo, clocPath){
  if(!clocPath) return {loc:null,ancillaryLoc:null,languages:[],ancillaryLanguages:[]}
  const raw=await run(clocPath,[repo,'--json','--quiet','--vcs=git'],undefined,120000)
  try{
    const j=JSON.parse(raw), languages=[], ancillaryLanguages=[]
    const ancillaryNames=new Set(['JSON','Markdown','YAML','XML','TOML','INI','CSV','Text','SVG','JSON5'])
    for(const [k,v] of Object.entries(j)) if(!['header','SUM'].includes(k) && v?.code){
      const row={language:k,code:Number(v.code),files:Number(v.nFiles||0)}
      ;(ancillaryNames.has(k)?ancillaryLanguages:languages).push(row)
    }
    return {loc:languages.reduce((a,x)=>a+x.code,0),ancillaryLoc:ancillaryLanguages.reduce((a,x)=>a+x.code,0),languages,ancillaryLanguages}
  }catch{return {loc:0,ancillaryLoc:0,languages:[],ancillaryLanguages:[]}}
}

async function cachedCloc(repo, clocPath){
  if(!clocPath) return {loc:null,ancillaryLoc:null,languages:[],ancillaryLanguages:[]}
  const old = clocCache.get(repo)
  if(old && Date.now()-old.at < CLOC_CACHE_MS) return old.data
  const data = await clocRepo(repo, clocPath)
  clocCache.set(repo, { at: Date.now(), data })
  return data
}

function longestStreak(dates){
  const uniq=[...new Set(dates)].sort(); let max=0,cur=0,prev=null
  for(const s of uniq){ const d=new Date(s+'T00:00:00Z'); if(prev && (d-prev)===86400000) cur++; else cur=1; max=Math.max(max,cur); prev=d }
  return max
}

async function mapLimit(items,limit,fn){
  const out=new Array(items.length); let next=0
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){ const i=next++; if(i>=items.length) return; out[i]=await fn(items[i],i) }
  })
  await Promise.all(workers); return out
}

async function collectLocal(root, from=null, to=null){
  const repos=await discoverRepos(root)
  const clocPath=await resolveCloc()
  const rows=await mapLimit(repos,2,async repo=>{
    const [g,c]=await Promise.all([parseLog(repo,from,to),cachedCloc(repo,clocPath)])
    const vc=vercelProjectJson(repo)
    const row={name:path.basename(repo),path:repo,currentLoc:c.loc,ancillaryLoc:c.ancillaryLoc,primaryLanguage:(c.languages[0]?.language||''),languages:c.languages,ancillaryLanguages:c.ancillaryLanguages,vercelProjectId:vc?.projectId||'',vercelOrgId:vc?.orgId||'',...g}
    if(!row.rhythm) row.rhythm=[]
    return row
  })
  const languageMap=new Map(), dailyMap=new Map(), rhythmMap=new Map(), allDates=[]
  for(const r of rows){
    for(const l of r.languages){ const x=languageMap.get(l.language)||{language:l.language,code:0,files:0}; x.code+=l.code; x.files+=l.files; languageMap.set(l.language,x) }
    for(const d of r.daily){ const x=dailyMap.get(d.date)||{date:d.date,commits:0,added:0,deleted:0,changed:0}; x.commits+=d.commits;x.added+=d.added;x.deleted+=d.deleted;x.changed+=d.changed;dailyMap.set(d.date,x); allDates.push(d.date) }
    for(const c of (r.rhythm||[])){ const x=rhythmMap.get(`${c.weekday}-${c.hour}`)||{weekday:c.weekday,hour:c.hour,commits:0,days:0}; x.commits+=c.commits; x.days+=c.days; rhythmMap.set(`${c.weekday}-${c.hour}`,x) }
    delete r.languages; delete r.ancillaryLanguages
  }
  const sum=k=>rows.reduce((a,r)=>a+Number(r[k]||0),0)
  const daily=[...dailyMap.values()].sort((a,b)=>a.date.localeCompare(b.date))
  const peak=daily.reduce((a,b)=>!a||b.commits>a.commits?b:a,null)
  const rhythm=[...rhythmMap.values()].sort((a,b)=>a.weekday-b.weekday||a.hour-b.hour)
  return {generatedAt:new Date().toISOString(),range:{from,to},tools:{git:true,cloc:!!clocPath},summary:{repos:rows.length,currentLoc:clocPath?sum('currentLoc'):null,ancillaryLoc:clocPath?sum('ancillaryLoc'):null,commits:sum('commits'),sourceAdded:sum('sourceAdded'),sourceDeleted:sum('sourceDeleted'),allAdded:sum('allAdded'),allDeleted:sum('allDeleted'),allChurn:sum('allAdded')+sum('allDeleted'),activeDays:new Set(allDates).size,longestStreak:longestStreak(allDates),peakDayCommits:peak?.commits||0},repositories:rows.sort((a,b)=>(b.sourceAdded+b.sourceDeleted)-(a.sourceAdded+a.sourceDeleted)),languages:[...languageMap.values()].sort((a,b)=>b.code-a.code),daily,rhythm}
}

async function githubStats(from=null, to=null){
  if(!(await existsCmd('gh'))) return {connected:false,error:'GitHub CLI not found'}
  const profileRaw=await run('gh',['api','user'],undefined,8000)
  if(!profileRaw) return {connected:false,error:'GitHub CLI is not authenticated or timed out'}
  try{
    const p=JSON.parse(profileRaw), login=p.login
    const qBase = `author:${login} type:pr`
    const qMergedBase = `author:${login} type:pr is:merged`
    const qRange = (from && to) ? ` created:${from}..${to}` : ''
    const apiCount=async q=>{ try{return Number(JSON.parse(await run('gh',['api',`search/issues?q=${encodeURIComponent(q)}&per_page=1`],undefined,8000)).total_count||0)}catch{return 0} }
    const [prs,merged]=await Promise.all([apiCount(qBase+qRange),apiCount(qMergedBase+qRange)])
    const ownedRaw=await run('gh',['api','user/repos?per_page=100&affiliation=owner','--paginate'],undefined,10000)
    let owned=[]; try{owned=JSON.parse(ownedRaw)}catch{}
    const gFrom = from ? `${from}T00:00:00Z` : '1970-01-01T00:00:00Z'
    const gTo = to ? `${to}T23:59:59Z` : new Date().toISOString()
    const query='query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){totalCommitContributions totalPullRequestContributions totalPullRequestReviewContributions contributionCalendar{totalContributions}}}}'
    let cc={}; try{ cc=JSON.parse(await run('gh',['api','graphql','-f',`query=${query}`,'-F',`login=${login}`,'-F',`from=${gFrom}`,'-F',`to=${gTo}`],undefined,10000)).data.user.contributionsCollection }catch{}
    return {connected:true,login,avatar:p.avatar_url,pullRequests:prs,mergedPrs:merged,contributions:Number(cc.contributionCalendar?.totalContributions||0),commitContributions:Number(cc.totalCommitContributions||0),reviewContributions:Number(cc.totalPullRequestReviewContributions||0),ownedRepos:owned.length,stars:owned.reduce((a,x)=>a+Number(x.stargazers_count||0),0),forks:owned.reduce((a,x)=>a+Number(x.forks_count||0),0)}
  }catch{return {connected:false,error:'GitHub response could not be parsed'}}
}

function vercelProjectJson(repo){
  try{
    const raw=fs.readFileSync(path.join(repo,'.vercel','project.json'),'utf8')
    const j=JSON.parse(raw)
    return {projectId:j.projectId,orgId:j.orgId}
  }catch{ return null }
}

function safeParseJson(text){
  if(!text) return null
  const start=text.search(/[\[{]/)
  if(start===-1) return null
  try{ return JSON.parse(text.slice(start)) }catch{ return null }
}

function loadVercelToken(){
  try{
    if(process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN
    const base = process.env.APPDATA ? path.join(process.env.APPDATA,'com.vercel.cli','Data','auth.json') : null
    if(!base || !fs.existsSync(base)) return null
    const raw=fs.readFileSync(base,'utf8')
    const j=JSON.parse(raw)
    return j.token || null
  }catch{ return null }
}

function vercelCliVersion(){
  try{
    const pkg=JSON.parse(fs.readFileSync(path.join(os.homedir(),'AppData','Roaming','npm','node_modules','vercel','package.json'),'utf8'))
    return pkg.version
  }catch{ return null }
}

async function vercelApi(p){
  const token=loadVercelToken()
  if(!token) throw new Error('Vercel token not found')
  const res=await fetch(`https://api.vercel.com${p}`,{headers:{Authorization:`Bearer ${token}`}})
  if(!res.ok){
    const body=await res.text().catch(()=>''), safe=body.replace(/token[:=]\s*['"]?[\w-]+['"]?/gi,'token:<redacted>').slice(0,200)
    throw new Error(`Vercel API ${res.status}: ${safe}`)
  }
  return await res.json()
}

async function vercelStats(from=null, to=null){
  const version=vercelCliVersion()
  let account=''
  try{
    const token=loadVercelToken()
    if(!token) return {status:'error',connected:false,projects:0,deployments:0,productionDeployments:0,previewDeployments:0,readyDeployments:0,errorDeployments:0,deploymentList:[],projectList:[],monthly:[],authStatus:'not_authenticated',error:'Vercel token not found',cliVersion:version}
    const projectRes=await vercelApi('/v9/projects?limit=100')
    const list=projectRes.projects||[]
    let allDeployments=[]; const deploymentErrors=[]
    await mapLimit(list,4,async p=>{
      try{
        const params=new URLSearchParams(); params.set('projectId',p.id); params.set('limit','100');
        if(from) params.set('since',String(new Date(from+'T00:00:00Z').getTime()))
        if(to) params.set('until',String(new Date(to+'T23:59:59Z').getTime()))
        let cursor=null, pages=0
        const MAX_PAGES=20
        do{
          const q=new URLSearchParams(params)
          if(cursor) q.set('until',String(cursor))
          const depRes=await vercelApi(`/v6/deployments?${q.toString()}`)
          const parsed=depRes.deployments||[]
          for(const dep of parsed){
            if(!dep||(!dep.uid&&!dep.id)) continue
            if(!account && dep.creator?.username) account=dep.creator.username
            allDeployments.push({
              id:dep.uid||dep.id,
              url:dep.url||null,
              name:dep.name||p.name,
              state:String(dep.state||dep.readyState||'').toUpperCase(),
              target:String(dep.target||'').toLowerCase(),
              createdAt:new Date(Number(dep.created||dep.createdAt)||0).toISOString(),
              readyAt:dep.ready ? new Date(Number(dep.ready)).toISOString() : null,
              branch:dep.meta?.githubCommitRef||null,
              commit:dep.meta?.githubCommitSha||null,
              commitMessage:dep.meta?.githubCommitMessage||null,
              projectId:p.id,
              projectName:p.name,
            })
          }
          cursor = depRes.pagination?.next || null
          pages++
        }while(cursor && pages<MAX_PAGES)
      }catch(e){ deploymentErrors.push(`${p.name}: ${e.message}`) }
    })
    if(from) allDeployments = allDeployments.filter(d=>new Date(d.createdAt) >= new Date(from+'T00:00:00Z'))
    if(to) allDeployments = allDeployments.filter(d=>new Date(d.createdAt) <= new Date(to+'T23:59:59Z'))
    const production=allDeployments.filter(d=>d.target==='production').length
    const preview=allDeployments.filter(d=>d.target!=='production').length
    const ready=allDeployments.filter(d=>['READY','SUCCEEDED','SUCCESS'].includes(d.state)).length
    const errors=allDeployments.filter(d=>['ERROR','FAILED','CANCELED'].includes(d.state)).length
    const rangeMonths=()=>{
      if(!allDeployments.length) return []
      const times=allDeployments.map(d=>new Date(d.createdAt).getTime()).sort((a,b)=>a-b)
      const start=new Date(times[0]), end=new Date(times[times.length-1])
      const out=[]
      let y=start.getUTCFullYear(), m=start.getUTCMonth()
      const endY=end.getUTCFullYear(), endM=end.getUTCMonth()
      while(y<endY || (y===endY && m<=endM)){
        out.push(`${y}-${String(m+1).padStart(2,'0')}`)
        m++; if(m===12){ m=0; y++ }
      }
      return out
    }
    const monthlyMap=new Map()
    for(const d of allDeployments){
      const date=new Date(d.createdAt)
      const key=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`
      const bucket=monthlyMap.get(key)||{month:key,production:0,preview:0,succeeded:0,failed:0,total:0}
      bucket.total++
      if(d.target==='production') bucket.production++; else bucket.preview++
      if(['READY','SUCCEEDED','SUCCESS'].includes(d.state)) bucket.succeeded++; else if(['ERROR','FAILED','CANCELED'].includes(d.state)) bucket.failed++
      monthlyMap.set(key,bucket)
    }
    const monthly=rangeMonths().map(m=>monthlyMap.get(m)||{month:m,production:0,preview:0,succeeded:0,failed:0,total:0})
    const productionDeploys=allDeployments.filter(d=>d.target==='production').sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt))
    const cadence={
      averageDaysBetweenProductionDeploys:null,
      longestProductionDeploymentGap:null,
      mostProductionDeploymentsInADay:null,
      partial: deploymentErrors.length>0,
    }
    if(productionDeploys.length>1){
      let totalGap=0, maxGap=0, maxCount=0
      const dayMap=new Map()
      for(const d of productionDeploys){
        const key=d.createdAt.slice(0,10)
        dayMap.set(key,(dayMap.get(key)||0)+1)
        if(dayMap.get(key)>maxCount) maxCount=dayMap.get(key)
      }
      for(let i=1;i<productionDeploys.length;i++){
        const prev=new Date(productionDeploys[i-1].createdAt).getTime()
        const cur=new Date(productionDeploys[i].createdAt).getTime()
        const gap=Math.round((cur-prev)/86400000)
        totalGap+=gap
        if(gap>maxGap) maxGap=gap
      }
      cadence.averageDaysBetweenProductionDeploys=Number((totalGap/(productionDeploys.length-1)).toFixed(2))
      cadence.longestProductionDeploymentGap=maxGap
      cadence.mostProductionDeploymentsInADay=maxCount
    } else if (productionDeploys.length===1){
      cadence.mostProductionDeploymentsInADay=1
    }
    return {
      status:'ready',
      connected:true,
      cliVersion:version,
      authStatus:'authenticated',
      account:account||'unknown',
      projects:list.length,
      deployments:allDeployments.length,
      productionDeployments:production,
      previewDeployments:preview,
      readyDeployments:ready,
      errorDeployments:errors,
      deploymentList:allDeployments,
      cadence,
      projectList:list.map(p=>({
        id:p.id,
        name:p.name,
        framework:p.framework,
        updatedAt:p.updatedAt?new Date(p.updatedAt).toISOString():null,
        linked:!!p.link,
        repo:p.link?.repo||'',
        org:p.link?.org||'',
        type:p.link?.type||'',
      })),
      monthly,
      updatedAt:new Date().toISOString(),
      error:deploymentErrors.length?deploymentErrors.slice(0,3).join(' | '):null
    }
  }catch(e){
    return {status:'error',connected:false,projects:0,deployments:0,productionDeployments:0,previewDeployments:0,readyDeployments:0,errorDeployments:0,deploymentList:[],projectList:[],monthly:[],authStatus:'unknown',error:e.message,cliVersion:version}
  }
}
export { collectLocal, githubStats, vercelStats, discoverRepos, auditRepos }
