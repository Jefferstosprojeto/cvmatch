import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // No PII here — just the technical skill tags already extracted from CVs, deduped.
  const { data: cvs, error } = await supabase.from('cvs').select('skills_primary').eq('status', 'done')
  if (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const skillSet = new Set<string>()
  for (const cv of cvs || []) {
    for (const s of (cv.skills_primary || []).slice(0, 3)) skillSet.add(s)
  }

  return new Response(JSON.stringify({ success: true, skills: [...skillSet].slice(0, 30) }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
