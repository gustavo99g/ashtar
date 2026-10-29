<#
.SYNOPSIS
    Abre o Ashtar no computador de casa: uma aba com a API (e os logs) e outra com o admin pronto.

.DESCRIPTION
    Fica na pasta de produção (a mesma do api.exe e do .env) e é o que o atalho "Ashtar API" da
    área de trabalho executa. Usa o Windows Terminal (wt.exe), com duas abas:
      - API:   roda o api.exe e mostra os logs (api-logs.ps1);
      - Admin: um terminal na pasta, com o comando `admin` pronto (admin-shell.ps1).

    Se a API já está rodando (a porta 3000 está em uso), não abre outra: só a aba do admin.
    Sem o Windows Terminal, abre duas janelas do PowerShell.
#>
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot

$apiRodando = $false
try {
    $apiRodando = [bool](Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop)
}
catch { }

$comandoApi = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `".\api-logs.ps1`""
$comandoAdmin = "-NoExit -NoProfile -ExecutionPolicy Bypass -Command `". '.\admin-shell.ps1'`""

$wt = Get-Command wt.exe -ErrorAction SilentlyContinue
if ($wt) {
    $abas = @()
    if (-not $apiRodando) {
        $abas += "new-tab --title `"API`" --suppressApplicationTitle -d `"$dir`" powershell.exe $comandoApi"
    }
    $abas += "new-tab --title `"Admin`" --suppressApplicationTitle -d `"$dir`" powershell.exe $comandoAdmin"
    # O ';' separa as abas para o wt; um ';' do PowerShell estaria entre aspas.
    Start-Process -FilePath $wt.Source -ArgumentList ($abas -join ' ; ')
}
else {
    if (-not $apiRodando) {
        Start-Process -FilePath powershell.exe -WorkingDirectory $dir -ArgumentList $comandoApi
    }
    Start-Process -FilePath powershell.exe -WorkingDirectory $dir -ArgumentList $comandoAdmin
}
