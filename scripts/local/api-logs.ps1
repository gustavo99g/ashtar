<#
.SYNOPSIS
    Roda a API do Ashtar mostrando os logs, e guarda uma cópia em logs\api-AAAA-MM-DD.log.

.DESCRIPTION
    É o que a aba "API" do iniciar.ps1 executa. Ctrl+C para a API. Se ela cair, a aba continua
    aberta para dar tempo de ler o motivo.
#>
Set-Location $PSScriptRoot
# A API escreve em UTF-8; sem isto os acentos saem quebrados no terminal e no arquivo de log.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = 'Ashtar API'

New-Item -ItemType Directory -Force -Path 'logs' | Out-Null
$log = Join-Path 'logs' ('api-{0:yyyy-MM-dd}.log' -f (Get-Date))

Write-Host "Ashtar API em http://127.0.0.1:3000   (log: $log)   Ctrl+C para parar" -ForegroundColor Cyan
Write-Host ''

# `cmd /c ... 2>&1` junta stdout e stderr como texto comum. Redirecionar o stderr no próprio
# PowerShell 5.1 transforma cada linha dele em um erro vermelho com prefixo.
cmd.exe /c '.\api.exe 2>&1' | Tee-Object -FilePath $log -Append

Write-Host ''
Write-Host "A API parou (código $LASTEXITCODE). Para subir de novo: .\api-logs.ps1" -ForegroundColor Yellow
