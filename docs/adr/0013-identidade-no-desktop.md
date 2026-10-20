# 0013 — Identidade no desktop

- **Status:** aceita
- **Data:** 2026-10

## Contexto

A ADR 0011 deixou para o desktop o cálculo da chave do dispositivo e a regra de quando usar a chave
aleatória. O app precisa entrar sozinho a cada abertura, sem senha; separar quem nunca entrou de quem saiu
do grupo; receber o convite que a pessoa abre no navegador; e saber o canal de atualização mesmo com a API
fora do ar. A chave é a credencial de verdade: quem a tem entra como aquele membro. O frontend roda num
WebView, com bibliotecas de terceiros.

## Decisão

**A chave do computador** é calculada só no Rust:

1. Lê o UUID do sistema e o serial da placa-mãe na tabela SMBIOS do firmware (`GetSystemFirmwareTable` com
   a assinatura `RSMB`, do `windows-sys`). É uma chamada só, sem WMI nem COM.
2. Compara os dois com uma lista de valores genéricos: UUID todo zero ou todo F,
   `03000200-0400-0500-0006-000700080009`, serial vazio, "To be filled by O.E.M.", "Default string",
   "Not Specified", "System Serial Number", "None" e "0".
3. Os dois bons: a chave é o SHA-256 de uma constante do app, do UUID e do serial, em hexadecimal
   (64 caracteres).
4. Algum genérico: 32 bytes aleatórios, gerados uma vez e guardados como credencial genérica no
   Gerenciador de Credenciais do Windows (`CredWriteW` e `CredReadW`, do `windows-sys`).
5. O log diz qual caminho foi usado ("hardware" ou "aleatória"), nunca os valores.

**A chave não chega ao JavaScript.** Os comandos `login` e `redeem` do Rust calculam a chave, chamam a API
com o `reqwest`, mandam os mesmos cabeçalhos do `apiFetch` e devolvem só o token de sessão e o usuário. A
URL da API também é fixada no Rust, no build, a partir da mesma variável do frontend (`VITE_API_URL`, que
no desenvolvimento vale a do ambiente de desenvolvimento): se ela viesse do JavaScript, um script injetado
no WebView poderia mandar a chave para outro endereço.

**A sessão.** O token fica só na memória, dentro do `lib/api`, e vai em `Authorization: Bearer` em toda
chamada. O app faz o login a cada abertura. Um 401 (`unauthenticated`) no meio do uso leva a um login e
à repetição da chamada, uma vez. Se o login responder `unknown_device`, o computador saiu do grupo: a
chamada de voz cai, o cache é limpo e o app volta para a entrada. O app tenta o login uma vez por abertura,
nunca em laço.

**O marcador.** Depois do primeiro login que dá certo, o app grava na sua pasta de dados um arquivo com o
nick e a cor da conta. Não é segredo e não autentica nada: só escolhe entre as telas "Este computador saiu
do grupo" (existe o marcador) e "Você precisa de um convite" (não existe), e mostra de quem era a conta.

**O canal de atualização.** Depois do `/api/me`, o app chama `set_update_channel`. O Rust grava o canal
num arquivo na pasta de dados e usa o último valor gravado em toda verificação, inclusive antes do login e
com a API fora do ar. Sem nada gravado, é o estável. A variável `ASHTAR_UPDATE_CHANNEL` fica só para o
desenvolvimento e, quando existe, vence o arquivo.

**A entrada pelo link.** O esquema `ashtar` (`ashtar://convite/CÓDIGO`, `ashtar://recuperar/CÓDIGO`) pelo
`tauri-plugin-deep-link`, registrado pelo instalador e de novo a cada abertura. O
`tauri-plugin-single-instance`, com o deep link ligado, entrega o link à janela que já está aberta. O app de
desenvolvimento usa o esquema `ashtar-dev`.

## Alternativas consideradas

- **WMI** para ler o hardware: mais lento e exige COM; a tabela SMBIOS tem os mesmos dois valores.
- **O crate `keyring`** para o Gerenciador de Credenciais: menos código, uma dependência a mais para duas
  chamadas que o `windows-sys` já tem.
- **Sempre a chave aleatória:** some ao formatar o Windows, e o roadmap quer que formatar não exija nada.
- **Gravar o token** no Gerenciador de Credenciais: pouparia uma chamada por abertura, e só. A chave já é a
  credencial, e um token gravado é mais um segredo em disco.
- **Calcular a chave no Rust e entregá-la ao JavaScript** para o `apiFetch` fazer o login: mais simples,
  mas expõe a credencial a todo código que roda no WebView.
- **Reusar "Você precisa de um convite" para quem saiu do grupo:** a pessoa não entenderia por que perdeu o
  acesso nem que precisa pedir uma recuperação.
- **Um servidor local para receber o link** em vez do esquema `ashtar://`: mais código, uma porta aberta e
  um aviso do firewall.

## Consequências

- Formatar o Windows não exige nada, a não ser em computador com hardware genérico, que perde a conta ao
  formatar e precisa de uma recuperação. Trocar a placa-mãe sempre exige uma recuperação.
- O log mostra, no beta, quantos computadores do grupo caem na chave aleatória.
- Apagar o marcador só troca a tela de quem saiu do grupo pela de quem precisa de convite.
- Com uma instância só, some uma das causas possíveis do eco no compartilhamento (duas instâncias dividindo
  um único WebView2, ver o `BACKLOG.md`). A causa do eco não foi confirmada, então isso não o dá por
  resolvido.
- O app de desenvolvimento e o instalado não roubam os links um do outro.
- Quem sai do beta fica na versão que já tem até o estável passar dela: o updater não volta versão.
- Rever quando houver mais de um dispositivo por membro, se muita gente cair na chave aleatória, ou quando
  o app sair do Windows.
