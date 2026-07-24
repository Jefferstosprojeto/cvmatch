import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { skills = [], regions = ['worldwide'], user_id } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const newJobs: any[] = []
    const allSources: string[] = []

    // 1. Remotive API — free, no key, reliable for remote jobs
    try {
      const query = skills.slice(0, 3).join(' ')
      const r = await fetch(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=30`)
      if (r.ok) {
        const { jobs } = await r.json()
        for (const j of (jobs || [])) {
          const region = detectRegion(j.candidate_required_location || '')
          newJobs.push({
            id: `remotive-${j.id}`,
            title: j.title,
            company: j.company_name,
            region,
            country: j.candidate_required_location || 'Worldwide',
            flag: regionFlag(region),
            regime: 'remote',
            languages_accepted: ['english'],
            salary: j.salary || '—',
            skills_required: extractSkills(j.description || '', skills),
            skills_nice: [],
            experience_min: 0,
            source: 'Remotive',
            url: j.url,
            posted_at: j.publication_date?.split('T')[0] || new Date().toISOString().split('T')[0],
            is_active: true
          })
        }
        allSources.push('Remotive')
      }
    } catch (_) {}

    // 2. Upsert new jobs into DB
    let newCount = 0
    if (newJobs.length > 0) {
      const { data: upserted } = await supabase
        .from('jobs')
        .upsert(newJobs, { onConflict: 'id', ignoreDuplicates: true })
        .select('id')
      newCount = upserted?.length || 0
    }

    // 3. Log search history
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

function detectRegion(location: string): string {
  const l = location.toLowerCase()
  if (/brazil|brasil|são paulo|rio de janeiro|brazil/i.test(l)) return 'brazil'
  if (/germany|austria|switzerland|dach|deutschland|schweiz/i.test(l)) return 'dach'
  if (/europe|eu|uk|france|spain|portugal|netherlands|belgium|italy/i.test(l)) return 'eu'
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
