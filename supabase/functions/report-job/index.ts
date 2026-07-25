import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { job_id } = await req.json()
    if (!job_id || typeof job_id !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'job_id required' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // Any authenticated user can report a job — regular users have no UPDATE
    // rights on `jobs` (RLS only allows read + insert), so this runs with the
    // service role. Low-risk: worst case is a still-live job gets hidden, which
    // simply gets re-added the next time a search finds it again.
    const authHeader = req.headers.get('Authorization') || ''
    const supabaseAuthed = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await supabaseAuthed.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ success: false, error: 'unauthenticated' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const { error } = await supabase.from('jobs').update({ is_active: false }).eq('id', job_id)
    if (error) throw error

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
