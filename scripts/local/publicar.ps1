<#
.SYNOPSIS
    Compila a API e o admin em release e manda o necessário para a pasta local de produção.

.DESCRIPTION
    Manda para a pasta de destino (padrão: C:\Users\<você>\ashtar):
      - api.exe e admin.exe, recém-compilados;
      - os scripts de uso (iniciar.ps1, api-logs.ps1 e admin-shell.ps1);
      - o .env, só se ainda não existir (um .env que já está lá nunca é sobrescrito).

    Antes de trocar os arquivos:
      - para a API, se ela estiver rodando a partir da pasta de destino (o .exe fica travado);
      - faz um backup do banco com o admin que já está lá (VACUUM INTO, seguro com a API no ar).

    No fim, confere se o banco abre com o admin novo e cria o atalho "Ashtar API" na área de
    trabalho, que abre a API (com os logs) e o terminal do admin.

.EXAMPLE
    .\publicar.ps1
    .\publicar.ps1 -SemCompilar      # só manda o que já está compilado
    .\publicar.ps1 -Destino D:\ashtar
#>
param(
    [string]$Destino = (Join-Path $env:USERPROFILE 'ashtar'),
    [switch]$SemCompilar,
    [switch]$SemAtalho
)

$ErrorActionPreference = 'Stop'
# Os programas escrevem em UTF-8; sem isto os acentos da saída saem quebrados aqui.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$apiDir = Join-Path $repo 'api'
$release = Join-Path $apiDir 'target\release'

function Titulo($texto) { Write-Host "`n== $texto" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "   ok  $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "   !!  $texto" -ForegroundColor Yellow }

# 1. Compilar -----------------------------------------------------------------------------------
if (-not $SemCompilar) {
    Titulo 'Compilando a API e o admin (release)'
    Push-Location $apiDir
    try {
        cargo build --release
        if ($LASTEXITCODE -ne 0) { throw "cargo build falhou (código $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
foreach ($nome in 'api.exe', 'admin.exe') {
    if (-not (Test-Path (Join-Path $release $nome))) {
        throw "Não achei $nome em $release. Rode sem -SemCompilar."
    }
}

# 2. Preparar a pasta ---------------------------------------------------------------------------
Titulo "Pasta de destino: $Destino"
New-Item -ItemType Directory -Force -Path $Destino | Out-Null
$destApi = Join-Path $Destino 'api.exe'
$destAdmin = Join-Path $Destino 'admin.exe'

# 3. Parar a API que está rodando daqui ---------------------------------------------------------
$estavaRodando = $false
foreach ($processo in Get-Process -Name api, admin -ErrorAction SilentlyContinue) {
    $caminho = try { $processo.Path } catch { $null }
    if ($caminho -and ($caminho -ieq $destApi -or $caminho -ieq $destAdmin)) {
        Aviso "Parando $($processo.Name) (PID $($processo.Id)), que roda de $Destino"
        if ($processo.Name -eq 'api') { $estavaRodando = $true }
        Stop-Process -Id $processo.Id -Force
        $processo.WaitForExit(5000) | Out-Null
    }
}

# 4. Backup do banco, com o admin que já está lá ------------------------------------------------
$banco = Join-Path $Destino 'ashtar.db'
if ((Test-Path $banco) -and (Test-Path $destAdmin)) {
    Titulo 'Backup do banco antes de trocar os arquivos'
    $backups = Join-Path $Destino 'backups'
    Push-Location $Destino
    try {
        & $destAdmin backup $backups
        if ($LASTEXITCODE -eq 0) { Ok "cópia em $backups" }
        else { Aviso "o backup falhou (código $LASTEXITCODE); copiando o arquivo do banco à mão" ; Copy-Item $banco (Join-Path $Destino ("ashtar-antes-{0:yyyyMMdd-HHmmss}.db" -f (Get-Date))) }
    }
    finally { Pop-Location }
}
elseif (Test-Path $banco) {
    Copy-Item $banco (Join-Path $Destino ("ashtar-antes-{0:yyyyMMdd-HHmmss}.db" -f (Get-Date)))
    Ok 'cópia simples do banco (ainda não havia admin.exe lá)'
}

# 5. Copiar -------------------------------------------------------------------------------------
Titulo 'Copiando os arquivos'
Copy-Item (Join-Path $release 'api.exe') $destApi -Force
Copy-Item (Join-Path $release 'admin.exe') $destAdmin -Force
Ok 'api.exe e admin.exe'
foreach ($script in 'iniciar.ps1', 'api-logs.ps1', 'admin-shell.ps1') {
    Copy-Item (Join-Path $PSScriptRoot $script) (Join-Path $Destino $script) -Force
}
Ok 'iniciar.ps1, api-logs.ps1 e admin-shell.ps1'

# 6. .env ---------------------------------------------------------------------------------------
Titulo '.env'
$envDestino = Join-Path $Destino '.env'
if (-not (Test-Path $envDestino)) {
    Copy-Item (Join-Path $repo '.env.example') $envDestino
    Aviso "Criei $envDestino a partir do .env.example. Edite os valores de produção antes de iniciar."
}
else {
    Ok 'já existe; não foi mexido'
}
# Só os nomes das variáveis são conferidos; os valores nunca são lidos nem mostrados.
$definidas = Get-Content $envDestino |
    Where-Object { $_ -match '^\s*[A-Z_][A-Z0-9_]*\s*=' } |
    ForEach-Object { ($_ -split '=', 2)[0].Trim() }
foreach ($variavel in 'DATABASE_URL', 'PUBLIC_URL', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET') {
    if ($definidas -notcontains $variavel) {
        $dica = if ($variavel -eq 'PUBLIC_URL') { ' (monta o link dos convites; a API não sobe sem ela. Ex.: https://<máquina>.<rede>.ts.net)' } else { '' }
        Aviso "falta $variavel no .env$dica"
    }
}

# 7. Conferir se o banco abre com o admin novo --------------------------------------------------
if (Test-Path $banco) {
    Titulo 'Conferindo o banco com o admin novo'
    Push-Location $Destino
    try {
        # No PowerShell 5.1, o stderr de um programa nativo redirecionado vira erro terminante com
        # 'Stop'; aqui só o código de saída importa.
        $ErrorActionPreference = 'Continue'
        $saida = & $destAdmin membros 2>&1
        $codigo = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        if ($codigo -eq 0) { Ok 'o banco abriu normalmente' }
        else {
            Aviso 'o admin novo NÃO conseguiu abrir o banco:'
            $saida | ForEach-Object { Write-Host "        $_" -ForegroundColor Yellow }
            Aviso 'Se a mensagem fala em migração modificada, o banco foi criado com uma versão antiga das migrações.'
            Aviso 'O backup foi feito antes (pasta backups\, ou ashtar-antes-*.db na raiz). Decida entre recriar o banco ou migrá-lo antes de iniciar a API.'
        }
    }
    finally { Pop-Location }
}

# 8. Atalho na área de trabalho -----------------------------------------------------------------
if (-not $SemAtalho) {
    Titulo 'Atalho na área de trabalho'
    $atalho = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Ashtar API.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($atalho)
    $link.TargetPath = (Get-Command powershell.exe).Source
    $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Destino 'iniciar.ps1')`""
    $link.WorkingDirectory = $Destino
    $link.IconLocation = "$destApi,0"
    $link.WindowStyle = 7   # minimizada: a janelinha do launcher não pisca
    $link.Description = 'Abre a API do Ashtar (com os logs) e o terminal do admin'
    $link.Save()
    Ok $atalho
}

Titulo 'Pronto'
if ($estavaRodando) { Aviso 'A API estava rodando e foi parada. Abra de novo pelo atalho.' }
Write-Host "   Para iniciar: atalho 'Ashtar API' na área de trabalho, ou  $Destino\iniciar.ps1`n"
