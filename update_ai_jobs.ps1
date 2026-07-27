# ============================================================
# CVMatch Pro — Pesquisa diária de vagas via IA (Claude CLI local)
# Corre no PC de Jefferson Santos, usa a subscrição Claude existente
# (sem custo de API), e alimenta a tabela `jobs` partilhada do Supabase.
# ============================================================

$LogDir  = "$PSScriptRoot\logs"
$LogFile = "$LogDir\$(Get-Date -Format 'yyyy-MM-dd').log"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

function Write-Log {
    param([string]$Msg)
    $line = "$(Get-Date -Format 'HH:mm:ss') $Msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

Write-Log "=== CVMatch AI Job Search — Início ==="

$SupabaseUrl    = "https://pgscdvsmlojpfitbzrmo.supabase.co"
$SupabaseAnonKey = "sb_publishable_67Q2CrO9g_bhKZFGp0Iv6g_56DczwE7"
$IngestSecret   = $env:CVMATCH_INGEST_SECRET

if (-not $IngestSecret) {
    Write-Log "ERRO: variável de ambiente CVMATCH_INGEST_SECRET não definida. A terminar."
    exit 1
}

# ── PASSO 1 — Obter as skills distintas de todos os CVs guardados ──
Write-Log "A obter skills distintas dos CVs..."
try {
    $skillsResp = Invoke-RestMethod -Uri "$SupabaseUrl/functions/v1/get-distinct-skills" `
        -Headers @{ "apikey" = $SupabaseAnonKey; "Authorization" = "Bearer $SupabaseAnonKey" } `
        -Method Get -TimeoutSec 20
} catch {
    Write-Log "ERRO ao obter skills: $_"
    exit 1
}

if (-not $skillsResp.success -or $skillsResp.skills.Count -eq 0) {
    Write-Log "Sem CVs/skills na base de dados. A terminar sem pesquisar."
    exit 0
}

$SkillList = $skillsResp.skills -join ', '
Write-Log "Skills encontradas: $SkillList"

# ── PASSO 2 — Pedir ao Claude CLI para pesquisar vagas na web ──
$Prompt = @"
Pesquisa vagas de emprego reais e atuais na web para estas competências técnicas: $SkillList

Usa a ferramenta WebSearch para procurar em: LinkedIn, Indeed, Glassdoor, StepStone, RemoteRocketship, Jobgether, Himalayas, e agências como Nigel Frank International, Hays, Michael Page, Robert Half, REVOLENT, Duerenhoff, Ratbacher.

Para cada competência da lista, encontra até 5 vagas reais publicadas nos últimos 30 dias. Máximo 40 vagas no total.

IMPORTANTE: Responde APENAS com um array JSON válido, sem markdown, sem explicação, neste formato exato:
[{
  "title": "título exato da vaga",
  "company": "nome da empresa",
  "url": "link direto para a vaga",
  "salary": "intervalo salarial ou —",
  "regime": "remote" ou "hybrid" ou "onsite",
  "country": "país ou região",
  "region": "dach" ou "eu" ou "brazil" ou "usa" ou "worldwide",
  "posted_date": "AAAA-MM-DD",
  "languages_required": ["english"],
  "skills_mentioned": ["skill1","skill2"]
}]

Se não encontrares nenhuma vaga real, responde apenas: []
"@

Write-Log "A chamar Claude CLI com WebSearch..."
$ClaudeExe = "$env:USERPROFILE\.local\bin\claude.exe"

if (-not (Test-Path $ClaudeExe)) {
    Write-Log "ERRO: claude.exe não encontrado em $ClaudeExe"
    exit 1
}

try {
    $Output = & $ClaudeExe --print $Prompt --allowedTools "WebSearch" 2>&1
    $OutputText = $Output -join "`n"
} catch {
    Write-Log "ERRO ao executar Claude: $_"
    exit 1
}

Write-Log "Claude concluído. A processar resposta..."

# ── PASSO 3 — Extrair o JSON da resposta ──
$jsonStart = $OutputText.IndexOf('[')
$jsonEnd   = $OutputText.LastIndexOf(']')

if ($jsonStart -eq -1 -or $jsonEnd -eq -1) {
    Write-Log "AVISO: Claude não devolveu JSON reconhecível. Resposta:"
    Add-Content -Path $LogFile -Value $OutputText -Encoding UTF8
    exit 0
}

$jsonText = $OutputText.Substring($jsonStart, $jsonEnd - $jsonStart + 1)

try {
    $jobs = $jsonText | ConvertFrom-Json
} catch {
    Write-Log "ERRO ao interpretar JSON: $_"
    exit 1
}

if ($jobs.Count -eq 0) {
    Write-Log "Nenhuma vaga nova encontrada hoje."
    exit 0
}

Write-Log "$($jobs.Count) vagas encontradas."

# Claude nem sempre preenche "skills_mentioned" mesmo quando pedido — sem isso, o score
# de competências fica a 0% no match, mesmo em vagas claramente relevantes (ex: título
# "SAP BW/4HANA Consultant"). Preenche a partir do título quando vier vazio.
foreach ($job in $jobs) {
    if (-not $job.skills_mentioned -or $job.skills_mentioned.Count -eq 0) {
        $titleLower = $job.title.ToLower()
        $matched = @($skillsResp.skills | Where-Object { $titleLower.Contains($_.ToLower()) })
        $job | Add-Member -Force -NotePropertyName skills_mentioned -NotePropertyValue $matched
    }
}

Write-Log "A enviar para a base de dados..."

# ── PASSO 4 — Enviar para o Supabase via ingest-ai-jobs ──
# @() força um array PowerShell "limpo" — sem isto, o array vindo de ConvertFrom-Json
# serializa como {"value":[...],"Count":N} em vez de [...], e o servidor rejeita o pedido.
$body = @{ jobs = @($jobs) } | ConvertTo-Json -Depth 10

try {
    $ingestResp = Invoke-RestMethod -Uri "$SupabaseUrl/functions/v1/ingest-ai-jobs" `
        -Headers @{
            "apikey"          = $SupabaseAnonKey
            "Authorization"   = "Bearer $SupabaseAnonKey"
            "X-Ingest-Secret" = $IngestSecret
            "Content-Type"    = "application/json"
        } `
        -Method Post -Body $body -TimeoutSec 30

    Write-Log "Concluído: $($ingestResp.inserted) vagas novas gravadas na base de dados."
} catch {
    $respBody = ""
    if ($_.Exception.Response) {
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $respBody = $reader.ReadToEnd()
        } catch {}
    }
    Write-Log "ERRO ao enviar vagas: $_ | Resposta: $respBody"
    exit 1
}

Write-Log "=== CVMatch AI Job Search — Concluído ==="

