<#
.SYNOPSIS
    Sobe um LiveKit local em modo de desenvolvimento, para o teste de ponta a ponta da transmissão.

.DESCRIPTION
    Na primeira vez, baixa o livekit-server mais recente do GitHub para desktop\.livekit\ (fora do
    git). Depois, roda em ws://127.0.0.1:7880 com a chave "devkey" e o segredo "secret", que é o
    que o media/share_e2e.rs usa. Ctrl+C para parar.

    Noutra aba, em desktop\src-tauri:
        cargo test --lib share_e2e -- --ignored --nocapture
#>
$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot '..\.livekit'
$exe = Join-Path $dir 'livekit-server.exe'

if (-not (Test-Path $exe)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $release = Invoke-RestMethod 'https://api.github.com/repos/livekit/livekit/releases/latest'
    $asset = $release.assets | Where-Object { $_.name -like '*windows_amd64.zip' } | Select-Object -First 1
    if (-not $asset) { throw "A versão $($release.tag_name) não tem o livekit-server para Windows." }
    $zip = Join-Path $dir $asset.name
    Write-Host "Baixando o livekit-server $($release.tag_name)..." -ForegroundColor Cyan
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip
    Expand-Archive $zip -DestinationPath $dir -Force
    Remove-Item $zip
}

Write-Host 'LiveKit local em ws://127.0.0.1:7880 (devkey / secret). Ctrl+C para parar.' -ForegroundColor Cyan
& $exe --dev --bind 127.0.0.1
