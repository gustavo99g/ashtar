<#
.SYNOPSIS
    Prepara o terminal do admin: define o comando `admin` e mostra o que dá para fazer.

.DESCRIPTION
    É o que a aba "Admin" do iniciar.ps1 executa, com o ponto na frente (`. .\admin-shell.ps1`),
    para a função `admin` continuar valendo depois que o script termina. O admin usa o mesmo
    .env e o mesmo banco da API, e pode rodar com a API no ar.
#>
Set-Location $PSScriptRoot
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = 'Ashtar Admin'

# `admin membros` chama o admin.exe desta pasta, de qualquer diretório em que o terminal esteja.
# O admin lê o .env do diretório atual, então a função entra na pasta da API durante o comando e
# volta depois (por isso `admin backup .\backups` fala da pasta da API, não de onde você está).
# Os caminhos ficam em variáveis: `$PSScriptRoot` não vale mais depois que o script termina.
$AdminDir = $PSScriptRoot
$AdminExe = Join-Path $AdminDir 'admin.exe'
function admin {
    Push-Location $AdminDir
    try { & $AdminExe @args }
    finally { Pop-Location }
}

Write-Host 'Administração do Ashtar. Use:  admin <comando>' -ForegroundColor Cyan
Write-Host @'

  admin membros                       lista os membros
  admin convite                       convite novo (7 dias, 1 uso)
  admin convite --validade 5m --usos 8   convite para mandar no grupo
  admin convites                      histórico de convites
  admin recuperacao <nick>            troca o computador de um membro
  admin revogar <id>                  revoga um convite que ainda não foi usado
  admin remover <nick>                remove um membro
  admin desvincular <nick>            solta o computador de um membro
  admin beta <nick> ligar|desligar    liga ou desliga o beta de um membro
  admin permissoes <nick>             mostra as permissões de um membro
  admin dono <nick>                   cria o dono (uma vez só)
  admin backup .\backups              copia o banco para a pasta
  admin --help                        a lista completa

'@
