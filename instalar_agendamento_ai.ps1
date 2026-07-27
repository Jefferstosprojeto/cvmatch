# CVMatch AI Job Search - Instalar tarefa no Windows Task Scheduler
# Usa Register-ScheduledTask sem privilegios de administrador

$ScriptPath = 'C:\Users\jssantos\Documents\CLAUDE CODE\Primeiro Projeto\CVMatch\update_ai_jobs.ps1'

$Action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$ScriptPath"""

$Trigger = New-ScheduledTaskTrigger -Daily -At '07:00AM'

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew

$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERDOMAIN\$env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

Get-ScheduledTask -TaskName 'CVMatch_AI_JobSearch' -ErrorAction SilentlyContinue |
    Unregister-ScheduledTask -Confirm:$false

try {
    Register-ScheduledTask `
        -TaskName 'CVMatch_AI_JobSearch' `
        -Description 'CVMatch Pro - Pesquisa diaria de vagas via IA (Claude CLI local)' `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Principal $Principal | Out-Null
    Write-Host 'OK  CVMatch_AI_JobSearch criada - todos os dias as 07:00'
} catch {
    Write-Host "ERRO CVMatch_AI_JobSearch: $_"
}

Write-Host ''
Write-Host 'IMPORTANTE: antes de a tarefa correr, define a variavel de ambiente CVMATCH_INGEST_SECRET'
Write-Host '(User, permanente) com o valor que o Claude te deu na configuracao. Sem isso, o script para logo no inicio.'
Write-Host ''
Write-Host 'Agendamento instalado! Sem expiracao, sem necessidade de renovar.'
Write-Host "Script : $ScriptPath"
Write-Host "Logs   : $(Split-Path $ScriptPath)\logs\"
