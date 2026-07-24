import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SKILLS = [
  'SAP BW/4HANA', 'SAP BW', 'SAP Datasphere', 'SAP Analytics Cloud', 'SAP SAC', 'SAP BDC',
  'SAP HANA', 'SAP S/4HANA', 'ABAP', 'CDS Views', 'Databricks', 'Data Lake', 'ETL',
  'Power BI', 'Tableau', 'Qlik', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Python', 'R',
  'Java', 'JavaScript', 'TypeScript', 'Spark', 'Hadoop', 'AWS', 'Azure', 'GCP',
  'Docker', 'Kubernetes', 'CI/CD', 'Git', 'Scrum', 'Agile', 'PMP', 'Excel',
  'Salesforce', 'Oracle', 'Snowflake', 'Looker', 'dbt', 'Airflow'
]

const INDUSTRIES = [
  'SAP', 'Data Analytics', 'Finance', 'Banking', 'Insurance', 'Retail', 'Consulting',
  'IT', 'Telecom', 'Manufacturing', 'Pharma', 'Healthcare', 'Automotive', 'Energy', 'Logistics'
]

const CERT_PATTERNS = [
  /SAP\s+Certified[^,.\n]*/gi, /PMP/g, /Scrum\s*Master[^,.\n]*/gi, /AWS\s+Certified[^,.\n]*/gi,
  /Azure\s+Certified[^,.\n]*/gi, /ITIL[^,.\n]*/gi, /Six\s*Sigma[^,.\n]*/gi
]

const DEGREE_PATTERNS: [RegExp, string][] = [
  [/doutoramento|phd|doutorado/i, 'Doutoramento'],
  [/mestrado|master(?:'s)?\s+degree|msc|mba/i, 'Mestrado'],
  [/licenciatura|bachelor(?:'s)?\s+degree|bsc/i, 'Licenciatura'],
  [/curso\s+t[eé]cnico|técnico\s+profissional/i, 'Curso Técnico'],
]

const LANGUAGES: { key: string; name: string; patterns: RegExp[] }[] = [
  { key: 'portuguese', name: 'Portuguese', patterns: [/portugu[eê]s/i, /portuguese/i] },
  { key: 'english', name: 'English', patterns: [/ingl[eê]s/i, /english/i] },
  { key: 'spanish', name: 'Spanish', patterns: [/espanhol/i, /spanish/i, /español/i] },
  { key: 'german', name: 'German', patterns: [/alem[aã]o/i, /german/i, /deutsch/i] },
  { key: 'french', name: 'French', patterns: [/franc[eê]s/i, /french/i, /français/i] },
]

const LEVEL_SCORES: [RegExp, string, number][] = [
  [/nativ[oa]|native/i, 'native', 100],
  [/fluente|fluent|c2|c1/i, 'fluent', 92],
  [/avan[cç]ado|advanced|b2/i, 'advanced', 78],
  [/intermedi[aá]rio|intermediate|b1/i, 'intermediate', 55],
  [/b[aá]sico|basic|a1|a2/i, 'basic', 30],
]

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function detectSkills(text: string): { primary: string[]; secondary: string[] } {
  const found = SKILLS.filter(s => new RegExp(`\\b${escapeRegex(s)}\\b`, 'i').test(text))
  return { primary: found.slice(0, 10), secondary: found.slice(10, 20) }
}

function detectIndustries(text: string): string[] {
  const lower = text.toLowerCase()
  return INDUSTRIES.filter(i => lower.includes(i.toLowerCase())).slice(0, 5)
}

function detectCertifications(text: string): string[] {
  const found = new Set<string>()
  for (const re of CERT_PATTERNS) {
    for (const m of text.matchAll(re)) found.add(m[0].trim())
  }
  return [...found].slice(0, 8)
}

function detectEducation(text: string): string {
  for (const [re, label] of DEGREE_PATTERNS) {
    if (re.test(text)) return label
  }
  return 'Não especificado'
}

function detectExperienceYears(text: string): number {
  const explicit = text.match(/(\d{1,2})\s*(?:\+)?\s*anos?\s+de\s+experi[eê]ncia|(\d{1,2})\s*(?:\+)?\s*years?\s+of\s+experience/i)
  if (explicit) return parseInt(explicit[1] || explicit[2], 10)

  const ranges = [...text.matchAll(/(19|20)\d{2}\s*[-–—até]{1,4}\s*((19|20)\d{2}|atual|present|current|hoje)/gi)]
  if (ranges.length > 0) {
    const currentYear = new Date().getFullYear()
    let minYear = currentYear
    for (const r of ranges) {
      const start = parseInt(r[0].match(/(19|20)\d{2}/)?.[0] || `${currentYear}`, 10)
      if (start < minYear) minYear = start
    }
    return Math.max(0, currentYear - minYear)
  }
  return 0
}

function detectSeniority(text: string, years: number): string {
  if (/principal|executive|director|diretor/i.test(text)) return 'principal'
  if (/senior|sénior|sr\./i.test(text)) return 'senior'
  if (/pleno|mid[- ]level/i.test(text)) return 'mid'
  if (/j[uú]nior|junior|jr\./i.test(text)) return 'junior'
  if (years >= 10) return 'principal'
  if (years >= 6) return 'senior'
  if (years >= 2) return 'mid'
  return 'junior'
}

function detectRegime(text: string): string {
  if (/remoto|remote/i.test(text)) return 'remote'
  if (/h[ií]brido|hybrid/i.test(text)) return 'hybrid'
  if (/presencial|onsite|on-site/i.test(text)) return 'onsite'
  return 'remote'
}

function detectLanguages(text: string) {
  // Split into segments so comma/line-separated "Language: level" pairs don't bleed into each other
  const segments = text.split(/[,;\n]+/)
  const result = []
  for (const lang of LANGUAGES) {
    const segment = segments.find(seg => lang.patterns.some(p => p.test(seg)))
    if (!segment) continue

    let level = 'intermediate', score = 55
    for (const [re, lvl, sc] of LEVEL_SCORES) {
      if (re.test(segment)) { level = lvl; score = sc; break }
    }
    result.push({ name: lang.name, key: lang.key, level, score })
  }
  if (result.length === 0) {
    result.push({ name: 'Portuguese', key: 'portuguese', level: 'native', score: 100 })
  }
  return result
}

function detectLocation(text: string): string {
  const cities = ['Lisboa', 'Porto', 'Montijo', 'Coimbra', 'Braga', 'São Paulo', 'Rio de Janeiro', 'Madrid', 'Berlin', 'Munich', 'Zurich', 'London', 'Amsterdam']
  for (const c of cities) {
    if (new RegExp(c, 'i').test(text)) return c
  }
  return 'Não especificado'
}

function detectAvailability(text: string): string {
  if (/imediata|immediate/i.test(text)) return 'immediate'
  if (/2\s*semanas|2\s*weeks/i.test(text)) return '2weeks'
  if (/1\s*m[eê]s|1\s*month|30\s*dias/i.test(text)) return '1month'
  if (/3\s*meses|3\s*months|90\s*dias/i.test(text)) return '3months'
  return 'immediate'
}

function detectTitle(lines: string[]): string {
  for (const line of lines.slice(0, 8)) {
    const l = line.trim()
    if (l.length > 3 && l.length < 80 && /consultant|consultor|engineer|engenheiro|analyst|analista|architect|arquiteto|manager|gestor|developer|programador|specialist|especialista/i.test(l)) {
      return l
    }
  }
  return 'Não especificado'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { cv_text } = await req.json()

    if (!cv_text || cv_text.trim().length < 50) {
      return new Response(JSON.stringify({ success: false, error: 'CV text too short' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    const text: string = cv_text.slice(0, 20000)
    const lines = text.split('\n').filter((l: string) => l.trim().length > 0)

    const name = (lines[0] || 'Não especificado').trim().slice(0, 80)
    const title = detectTitle(lines)
    const { primary, secondary } = detectSkills(text)
    const experience_years = detectExperienceYears(text)
    const seniority = detectSeniority(text, experience_years)
    const languages = detectLanguages(text)
    const education = detectEducation(text)
    const certifications = detectCertifications(text)
    const preferred_regime = detectRegime(text)
    const industries = detectIndustries(text)
    const location = detectLocation(text)
    const availability = detectAvailability(text)

    const strengths = primary.slice(0, 3).length > 0
      ? primary.slice(0, 3)
      : ['Perfil em análise — adiciona mais detalhe técnico ao CV']

    const target_roles = primary.length > 0
      ? [`${seniority === 'junior' ? 'Junior' : seniority === 'mid' ? '' : seniority.charAt(0).toUpperCase() + seniority.slice(1)} ${primary[0]} Consultant`.replace(/\s+/g, ' ').trim()]
      : ['Não especificado']

    const summary = `${title !== 'Não especificado' ? title : 'Profissional'} com ${experience_years > 0 ? experience_years + ' anos' : 'experiência'} de experiência${primary.length > 0 ? ', com foco em ' + primary.slice(0, 3).join(', ') : ''}.`

    const filledFields = [
      title !== 'Não especificado', primary.length > 0, experience_years > 0,
      languages.length > 1, education !== 'Não especificado', certifications.length > 0,
      location !== 'Não especificado'
    ]
    const profile_score = Math.round((filledFields.filter(Boolean).length / filledFields.length) * 100)

    const improvement_tips: string[] = []
    if (experience_years === 0) improvement_tips.push('Indica explicitamente os teus anos de experiência')
    if (primary.length === 0) improvement_tips.push('Lista as tuas competências técnicas principais')
    if (certifications.length === 0) improvement_tips.push('Adiciona certificações relevantes, se as tiveres')
    if (education === 'Não especificado') improvement_tips.push('Indica a tua formação académica')
    if (improvement_tips.length === 0) improvement_tips.push('CV bem estruturado — mantém atualizado')

    const analysis = {
      name, title, summary, experience_years, seniority,
      skills_primary: primary, skills_secondary: secondary,
      languages, education, certifications, preferred_regime,
      industries, strengths, target_roles, location, availability,
      profile_score, improvement_tips
    }

    return new Response(JSON.stringify({ success: true, analysis }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('analyse-cv error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
