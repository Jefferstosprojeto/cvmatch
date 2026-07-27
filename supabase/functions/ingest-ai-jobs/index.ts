import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-secret',
}

function regionFlag(region: string): string {
  return { dach: '🇩🇪', eu: '🇪🇺', brazil: '🇧🇷', usa: '🇺🇸', worldwide: '🌐' }[region] || '🌐'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // Protects this endpoint from being an open, unauthenticated write to the shared jobs
    // table — only the local script (which knows the secret) can post here. Not tied to a
    // user session because it runs unattended on a schedule, not from a logged-in browser.
    const secret = req.headers.get('X-Ingest-Secret')
    if (!secret || secret !== Deno.env.get('INGEST_SECRET')) {
      return new Response(JSON.stringify({ success: false, error: 'unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    const { jobs } = await req.json()
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'jobs array required' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Same staleness rule as search-jobs (21 days) — this endpoint bypassed it entirely
    // before, so AI-found postings never got cleaned up automatically. Also reject
    // incoming rows that are already stale by Claude's own reported posted_date, instead
    // of storing dead-on-arrival listings.
    const staleCutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000)
    const staleCutoffStr = staleCutoff.toISOString().split('T')[0]
    await supabase.from('jobs').update({ is_active: false }).lt('posted_at', staleCutoffStr).eq('is_active', true)

    const rows = jobs.map((j: any) => ({
      id: `aisearch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: j.title, company: j.company,
      region: j.region || 'worldwide', country: j.country || 'Remote', flag: regionFlag(j.region || 'worldwide'),
      regime: j.regime || 'remote', languages_accepted: j.languages_required || ['english'],
      salary: j.salary || '—', skills_required: j.skills_mentioned || [], skills_nice: [], experience_min: 0,
      source: 'AI Search (local)', url: j.url,
      posted_at: j.posted_date || new Date().toISOString().split('T')[0], is_active: true
    }))
      .filter((r: any) => r.title && r.company && r.url)
      .filter((r: any) => r.posted_at >= staleCutoffStr)

    const { data, error } = await supabase.from('jobs').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }).select('id')
    if (error) throw error

    return new Response(JSON.stringify({ success: true, inserted: data?.length || 0 }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
