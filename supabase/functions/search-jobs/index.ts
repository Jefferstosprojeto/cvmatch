import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 6000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

// Relevance gate: only title/tags count (high-precision fields). Full descriptions are
// intentionally excluded — a long description almost always contains some skill by chance,
// which let generic, unrelated roles slip in as "matches".
function matchesSkills(title: string, tags: string, skills: string[]): boolean {
  if (!skills.length) return true
  const t = title.toLowerCase()
  if (skills.some(s => t.includes(s.toLowerCase()))) return true
  const tg = tags.toLowerCase()
  return skills.some(s => tg.includes(s.toLowerCase()))
}

function detectRegion(location: string): string {
  const l = location.toLowerCase()
  if (/brazil|brasil|são paulo|rio de janeiro/i.test(l)) return 'brazil'
  if (/germany|austria|switzerland|dach|deutschland|schweiz/i.test(l)) return 'dach'
  if (/europe|eu\b|uk|united kingdom|france|spain|portugal|netherlands|belgium|italy|poland|ireland/i.test(l)) return 'eu'
  if (/usa|united states|america|canada/i.test(l)) return 'usa'
  return 'worldwide'
}

function regionFlag(region: string): string {
  return { dach: '🇩🇪', eu: '🇪🇺', brazil: '🇧🇷', usa: '🇺🇸', worldwide: '🌐' }[region] || '🌐'
}

function extractSkills(text: string, cvSkills: string[]): string[] {
  const found: string[] = []
  const lower = text.toLowerCase()
  for (const sk of cvSkills) {
    if (lower.includes(sk.toLowerCase())) found.push(sk)
  }
  return found.slice(0, 8)
}

// ── Source fetchers — each isolated, returns [] on any failure ──

async function fromRemotive(skills: string[]): Promise<any[]> {
  const query = skills.slice(0, 3).join(' ')
  const r = await fetchWithTimeout(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=30`)
  if (!r.ok) return []
  const { jobs } = await r.json()
  return (jobs || []).map((j: any) => {
    const region = detectRegion(j.candidate_required_location || '')
    return {
      id: `remotive-${j.id}`, title: j.title, company: j.company_name, region,
      country: j.candidate_required_location || 'Worldwide', flag: regionFlag(region),
      regime: 'remote', languages_accepted: ['english'], salary: j.salary || '—',
      skills_required: extractSkills(j.description || '', skills), skills_nice: [], experience_min: 0,
      source: 'Remotive', url: j.url,
      posted_at: j.publication_date?.split('T')[0] || new Date().toISOString().split('T')[0], is_active: true
    }
  })
}

async function fromArbeitnow(skills: string[]): Promise<any[]> {
  const r = await fetchWithTimeout('https://www.arbeitnow.com/api/job-board-api')
  if (!r.ok) return []
  const { data } = await r.json()
  return (data || [])
    .filter((j: any) => matchesSkills(j.title || '', (j.tags || []).join(' '), skills))
    .slice(0, 15)
    .map((j: any) => {
      const location = j.remote ? `Remote (${j.location || 'EU'})` : (j.location || 'Europe')
      const region = detectRegion(location)
      return {
        id: `arbeitnow-${j.slug}`, title: j.title, company: j.company_name, region,
        country: j.location || 'Europe', flag: regionFlag(region),
        regime: j.remote ? 'remote' : 'onsite', languages_accepted: ['english'], salary: '—',
        skills_required: extractSkills(`${j.title} ${(j.tags || []).join(' ')}`, skills), skills_nice: [], experience_min: 0,
        source: 'Arbeitnow', url: j.url,
        posted_at: j.created_at ? new Date(j.created_at * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        is_active: true
      }
    })
}

async function fromRemoteOK(skills: string[]): Promise<any[]> {
  const r = await fetchWithTimeout('https://remoteok.com/api', {
    headers: { 'User-Agent': 'CVMatchPro/1.0 (+https://jefferstosprojeto.github.io/cvmatch/)' }
  })
  if (!r.ok) return []
  const list = await r.json()
  return (list || [])
    .filter((j: any) => j.id && j.position)
    .filter((j: any) => matchesSkills(j.position || '', (j.tags || []).join(' '), skills))
    .slice(0, 15)
    .map((j: any) => {
      const location = j.location || 'Worldwide'
      const region = detectRegion(location)
      const salary = j.salary_min && j.salary_max ? `$${j.salary_min}-$${j.salary_max}` : '—'
      return {
        id: `remoteok-${j.id}`, title: j.position, company: j.company, region,
        country: location, flag: regionFlag(region),
        regime: 'remote', languages_accepted: ['english'], salary,
        skills_required: extractSkills(`${j.position} ${(j.tags || []).join(' ')}`, skills), skills_nice: [], experience_min: 0,
        source: 'RemoteOK', url: j.url || j.apply_url,
        posted_at: j.date ? j.date.split('T')[0] : new Date().toISOString().split('T')[0], is_active: true
      }
    })
}

async function fromJobicy(skills: string[]): Promise<any[]> {
  const r = await fetchWithTimeout('https://jobicy.com/api/v2/remote-jobs?count=40')
  if (!r.ok) return []
  const { jobs } = await r.json()
  return (jobs || [])
    .filter((j: any) => matchesSkills(j.jobTitle || '', j.jobExcerpt || '', skills))
    .slice(0, 15)
    .map((j: any) => {
      const region = detectRegion(j.jobGeo || '')
      return {
        id: `jobicy-${j.id}`, title: j.jobTitle, company: j.companyName, region,
        country: j.jobGeo || 'Worldwide', flag: regionFlag(region),
        regime: 'remote', languages_accepted: ['english'], salary: '—',
        skills_required: extractSkills(`${j.jobTitle} ${j.jobExcerpt || ''}`, skills), skills_nice: [], experience_min: 0,
        source: 'Jobicy', url: j.url,
        posted_at: j.pubDate ? j.pubDate.split(' ')[0] : new Date().toISOString().split('T')[0], is_active: true
      }
    })
}

async function fromTheMuse(skills: string[]): Promise<any[]> {
  const cats = ['Software Engineering', 'Data and Analytics', 'IT'].map(c => `category=${encodeURIComponent(c)}`).join('&')
  const r = await fetchWithTimeout(`https://www.themuse.com/api/public/jobs?${cats}&page=0`)
  if (!r.ok) return []
  const { results } = await r.json()
  return (results || [])
    .filter((j: any) => matchesSkills(j.name || '', (j.tags || []).map((t: any) => t.name).join(' '), skills))
    .slice(0, 15)
    .map((j: any) => {
      const locNames = (j.locations || []).map((l: any) => l.name).join(', ') || 'USA'
      const region = detectRegion(locNames)
      return {
        id: `muse-${j.id}`, title: j.name, company: j.company?.name || 'N/A', region,
        country: locNames, flag: regionFlag(region),
        regime: /flexible|remote/i.test(locNames) ? 'remote' : 'onsite', languages_accepted: ['english'], salary: '—',
        skills_required: extractSkills(`${j.name} ${(j.tags || []).map((t: any) => t.name).join(' ')}`, skills), skills_nice: [], experience_min: 0,
        source: 'The Muse', url: j.refs?.landing_page,
        posted_at: j.publication_date ? j.publication_date.split('T')[0] : new Date().toISOString().split('T')[0], is_active: true
      }
    })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { skills = [], regions = ['worldwide'], user_id } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Free plan: 5 searches per user per UTC day. Enforced here — the only authoritative check.
    const DAILY_LIMIT = 5
    if (user_id) {
      const startOfDay = new Date()
      startOfDay.setUTCHours(0, 0, 0, 0)
      const { count } = await supabase
        .from('search_history')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user_id)
        .gte('searched_at', startOfDay.toISOString())
      if ((count || 0) >= DAILY_LIMIT) {
        return new Response(JSON.stringify({
          success: false, error: 'quota_exceeded', searches_used: count, searches_limit: DAILY_LIMIT
        }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } })
      }
    }

    // Housekeeping: deactivate postings older than 21 days on every search — most tech
    // postings fill or get pulled well before 45 days, so that window was too generous.
    const staleCutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    await supabase.from('jobs').update({ is_active: false }).lt('posted_at', staleCutoff).eq('is_active', true)

    const sourceFns: [string, (skills: string[]) => Promise<any[]>][] = [
      ['Remotive', fromRemotive],
      ['Arbeitnow', fromArbeitnow],
      ['RemoteOK', fromRemoteOK],
      ['Jobicy', fromJobicy],
      ['The Muse', fromTheMuse],
    ]

    const settled = await Promise.allSettled(sourceFns.map(([, fn]) => fn(skills)))

    const newJobs: any[] = []
    const allSources: string[] = []
    settled.forEach((result, i) => {
      const [name] = sourceFns[i]
      if (result.status === 'fulfilled') {
        newJobs.push(...result.value)
        if (result.value.length > 0) allSources.push(name)
      } else {
        console.error(`${name} failed:`, result.reason)
      }
    })

    // Upsert new jobs into DB
    let newCount = 0
    if (newJobs.length > 0) {
      const { data: upserted } = await supabase
        .from('jobs')
        .upsert(newJobs, { onConflict: 'id', ignoreDuplicates: true })
        .select('id')
      newCount = upserted?.length || 0
    }

    // Log search history
    if (user_id) {
      await supabase.from('search_history').insert({
        user_id,
        query_skills: skills,
        sources_searched: allSources,
        jobs_found: newJobs.length,
        new_jobs: newCount
      })
    }

    return new Response(JSON.stringify({
      success: true,
      jobs_found: newJobs.length,
      new_in_db: newCount,
      sources: allSources
    }), { headers: { ...cors, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('search-jobs error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
