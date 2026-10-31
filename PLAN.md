# Plano — v0.2.2: UI nova

Segunda metade da entrega conjunta v0.2.1 + v0.2.2 (`docs/roadmap.md`). A v0.2.1 pôs a identidade na API
sem mudar nada do que o grupo vê; aqui o app passa a usá-la, com a casca inteira refeita a partir do
protótipo (o canvas "Clone do Discord — telas"). O plano da fase anterior está arquivado em
[`docs/plans/v0.2.1-identidade-na-api.md`](docs/plans/v0.2.1-identidade-na-api.md).

**Objetivo desta fase:** o grupo inteiro entra no Ashtar por convite, com o nick escolhido, no visual novo,
e o dono administra tudo pelo Painel de controle do app. No fim, o código de acesso provisório e a rota
`/api/voice/join` saem, e a versão mínima sobe.

**Fora do escopo:** o chat real (v0.2.3; o quadro "Canal de texto" fica de referência), o resto da aba Voz e
vídeo, que na v0.2.2 só tem os dispositivos (supressão de ruído na v0.2.3, volumes, teste de microfone e
pressionar para falar na v0.6), Reconectando e Conexão perdida
(v0.6), o aviso de conteúdo protegido (v0.8), janelas minimizadas no seletor (`BACKLOG.md`), os webhooks do
LiveKit e qualquer tempo real por conexão longa (v0.2.3), câmera, um segundo tema e a correção do eco (sai
fora de ordem, pelo `BACKLOG.md`).

**Versões.** A UI nova saiu como `0.2.20` e `0.2.21` (numeração do roadmap: entrega × 10 + correção; a
`0.2.21` já está na `main`, pelos pull requests #6 e #7, de 31/10). O **Painel de controle (Etapa 7) não
sai sozinho**: é publicado junto com o chat, como a **v0.2.3** (`0.2.30`), e as suas notas ficam na seção
`## 0.2.30` do `CHANGELOG.md`. A Etapa 8 (lançamento) fica para depois do chat: ela promove para o estável e
fecha com uma correção que tira o código de acesso do app.

Base: a branch `dev` com a v0.2.1 (código conferido a partir do commit `7daf05e` da `feature/0.2.1`). Em
cada etapa, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` e `cargo test` (em `api/` e em
`desktop/src-tauri/`) e `pnpm lint`, `pnpm build` e `pnpm test` (em `desktop/`) devem passar.

## Progresso

| Etapa | Descrição | Status |
|---|---|---|
| 0 | Decisões (ADRs 0012 e 0013, seção nova na 0011) | Concluída (`4a0d09b`) |
| 1 | API: nome visível, leitura do convite, rotas do painel, quem está na sala, página do convite | Concluída (`373b377`) |
| 2 | Base visual: pastas por domínio, ESLint, Vitest, tokens e temas, design system, janela, AppShell, router | Concluída (`520d18d`) |
| 3 | Identidade no app: tipos gerados, TanStack Query, chave do computador, login pelo Rust, sessão | Concluída (`351a1e1`) |
| 4 | Entrada: link `ashtar://`, uma instância, convite, nick, recuperação, saiu do grupo | Concluída (`9412f04`) |
| 5 | Tela do servidor e sala de voz, uma transmissão por vez, convite rápido | Concluída (`4b7bfe5`) |
| 5b | Dispositivos de voz (entrada e saída), o ensurdecer só nas vozes, o nome da sala entra na chamada | Concluída (`b514541`) |
| 6 | Configurações (Perfil, Aplicativo) e atualização com o canal por pessoa | Concluída (`b514541`) |
| 7 | Painel de controle: Convites, Membros, aviso de quem entrou | Concluída |
| 8 | Lançamento (depois do chat): beta, troca do grupo, versão mínima, fim do código de acesso | Pendente |

Branches: a Etapa 1 vai direto para a `dev` (só a API muda, nada é publicado). As Etapas 2 a 5 ficam em
`entrega/ui-nova`, a partir da `dev`, com um pull request por etapa para dentro dela e, no fim, um para a
`dev`. A 5b e a 6 saíram da `feature/0.2.2` para a `dev` (pull request #6) e da `dev` para a `main` (#7),
como `0.2.21`. A Etapa 7 fica na `feature/0.2.3`, sem pull request para a `dev`: nada é publicado até o
chat (v0.2.3) ficar pronto, e a `dev` recebe tudo junto.

---

## Decisões

As decisões de arquitetura estão nas ADRs, que são a fonte:
[`0012-arquitetura-do-frontend.md`](docs/adr/0012-arquitetura-do-frontend.md) (pastas, regras, estado,
navegação, componentes, tokens, tipos, janela, testes),
[`0013-identidade-no-desktop.md`](docs/adr/0013-identidade-no-desktop.md) (chave do computador, sessão,
marcador, canal de atualização, link) e a seção "Administração pela interface" da
[`0011`](docs/adr/0011-identidade-sessao-convites.md). Abaixo, o que foi combinado para esta fase e o que o
plano decidiu além disso.

### Combinado

- **Versão `0.2.20`**, pela numeração do roadmap, e não `0.2.2` como nos quadros. As Etapas 2 a 5 juntas na
  `dev`; a 6 e a 7 depois, cada uma com a sua versão no beta. Nada chega ao grupo antes da Etapa 8.
- **Tipos da API pelo `ts-rs`**, comandos do Tauri à mão. **Router de memória.** **Sem catálogo de
  componentes.**
- **Chave do computador pela tabela SMBIOS** (`windows-sys`); a aleatória no **Gerenciador de
  Credenciais**, direto pelo `windows-sys`. **Token só na memória**, login a cada abertura.
- **Janela de 1440 × 900** (pedido de 18/10; numa tela menor, 90% da área útil na primeira abertura),
  mínimo de 1000 × 640, barra própria. Toda tela funciona do mínimo até uma tela grande maximizada.
- **Aba Voz e vídeo só com os dispositivos** (Etapa 5b, pedido de 29/10); o resto da aba está no
  `BACKLOG.md`. **Janelas minimizadas** continuam fora do seletor, no
  `BACKLOG.md`, e o quadro perdeu o selo. **Reconectando** e **Conexão perdida** ficam para a v0.6 e o
  **conteúdo protegido** para a v0.8.
- **Tela nova "Este computador saiu do grupo"** para quem foi removido ou desvinculado, com o pedido de
  recuperação ao dono.
- **Quase ao vivo sem SSE:** quem está na sala a cada 5 s; o aviso do dono comparando a lista de membros a
  cada 30 s. O tempo real chega com o WebSocket do chat.
- **API:** as mudanças entram como Etapa 1, sem migração nova (as colunas entram na `0001`); nome visível na sala vale na próxima
  entrada; nome visível com as regras do nick, menos ser único; o link de download da página do convite lido
  do `latest.json` do estável.
- **Cor do avatar** sai do nick: FNV-1a de 32 bits sobre o nick em UTF-8 com só o ASCII em minúsculas,
  índice `hash % 8` numa paleta fixa, igual no Rust da API e no TypeScript, com os mesmos casos de teste.

### Decidido neste plano

1. **A Etapa 1 vai direto para a `dev`.** Ela só acrescenta rotas e uma migração, e a rota antiga continua
   igual: o app instalado não percebe nada e o merge não publica nada, como na v0.2.1. Assim a API do
   computador de casa já roda a Etapa 1 enquanto as telas são feitas.
2. **A URL da API do Rust é fixada no build**, a partir da mesma `VITE_API_URL` do frontend, e não recebida
   do JavaScript como o documento do app dizia: senão um script injetado no WebView poderia pedir o login
   para outro endereço e levar a chave do computador (ADR 0013).

---

## Etapa 0: decisões — concluída (`4a0d09b`)

As ADRs 0012 e 0013 e a seção "Administração pela interface" da 0011.

## Etapa 1: API — concluída (`373b377`)

- Na migração `0001`: `users.display_name` e `invites.preset`.
- `GET /api/invites/{código}` sem sessão; `PATCH /api/me`; `display_name` e `can_view_panel` no `/api/me`;
  nome visível no nome do participante e o nick nos metadados do `voice/token`.
- As nove rotas do Painel, com `Action::ViewPanel` e os modelos de convite na API.
- `GET /api/voice/participants`.
- As páginas `/invite/{código}` e `/recovery/{código}`, o ícone PNG, `PUBLIC_URL` e a cor do nick em Rust.

**Pronto quando:** cada rota nova tem teste de integração passando; a página do convite abre no navegador
com a prévia certa no chat; o app instalado continua entrando pela rota antiga.

## Etapa 2: base visual — concluída (`520d18d`)

- Pastas por domínio, sem mudar nada na tela; as regras do ESLint; Vitest e Testing Library no CI.
- Tokens e temas com as cores do canvas, JetBrains Mono, o script que confere o contrato dos temas.
- Design system no `components/ui` com os estados; as peças do domínio (avatar e cor do nick, pílula de
  status, bilhete do convite).
- Janela de 1440 × 900 (menor numa tela que não comporta) com barra própria e `tauri-plugin-window-state`.
- `AppShell` e o router de memória com todas as rotas da fase já declaradas.
- Saem `/login`, `/signup`, o chat falso, o layout antigo e o `stores/navigation.ts`.

**Pronto quando:** o app abre com a barra própria, arrasta, minimiza, maximiza, fecha e lembra o tamanho;
as rotas provisórias navegam e o ESC fecha as configurações; os casos da cor do nick passam no Vitest; o CI
recusa um import entre features que não passe pelo `index.ts`.

## Etapa 3: identidade no app — concluída (`351a1e1`)

- `ts-rs` na API gerando os tipos em `lib/api`, e o CI conferindo se estão em dia.
- TanStack Query com o `queryClient` e as camadas da ADR 0012.
- A chave do computador no Rust (SMBIOS, lista de genéricos, SHA-256, aleatória no Gerenciador de
  Credenciais) e os comandos `login` e `redeem`.
- Sessão no `lib/api`, `useMe()`, o 401 com um login e uma repetição, o marcador.

**Pronto quando:** abrir o app com a conta vinculada entra sozinho e o `useMe()` traz o usuário; o log diz
o caminho da chave sem os valores; os testes da lista de genéricos, do formato da chave e da leitura da
tabela SMBIOS passam.

## Etapa 4: entrada — concluída (`9412f04`)

- `tauri-plugin-deep-link` (`ashtar`, e `ashtar-dev` no desenvolvimento) e `tauri-plugin-single-instance`.
- As telas Entrando, Sem convite, Escolha do nick, Recuperação, Você já está no Ashtar, Saiu do grupo e os
  estados de erro, com o campo de colar.

**Pronto quando:** o link `ashtar://` abre o app fechado e chega ao app aberto sem abrir outra janela; um
convite novo vai ao nick e a recuperação vai direto à conta; cada linha da tabela de estados aparece.

## Etapa 5: servidor e sala — concluída (`4b7bfe5`)

- Tela do servidor com quem está na sala a cada 5 s; sala vazia.
- Sala pelo `voice/token`, grade e foco, barra de baixo, painel "Voz conectada".
- Uma transmissão por vez olhando as publicações; seletor de fonte com os textos medidos dos presets;
  avisos do compartilhamento em toasts.
- Convite rápido.

**Pronto quando:** duas contas entram na sala e se veem pelo nome visível, com a cor do nick; a tela do
servidor de quem ficou fora mostra as duas; só uma transmissão por vez, mesmo começando juntas.

## Etapa 5b: dispositivos de voz — concluída (`b514541`)

- Configurações › Voz e vídeo com a Entrada e a Saída: o "Padrão do Windows" e a lista do Windows,
  atualizada quando um fone liga ou desliga; a escolha guardada neste computador.
- A chamada entra com os dispositivos escolhidos e troca na hora; o escolhido desconectado dá lugar ao
  padrão do Windows até voltar.
- O ensurdecer cala só as vozes; o som da transmissão segue o volume do Foco.
- O nome da sala na coluna entra na chamada.

**Pronto quando:** trocar o microfone e a saída no meio de uma chamada vale na hora; desligar e ligar o
fone escolhido passa para o padrão do Windows e volta sem mexer em nada; a tela inteira com "Todo o
sistema" continua sem o som da chamada.

## Etapa 6: configurações e atualização — concluída (`b514541`)

- Perfil com `PATCH /api/me`; Aplicativo com versão, canal, atualização, o que há de novo e Abrir pasta de
  logs.
- `set_update_channel` e o canal guardado só na memória do Rust (ADR 0013); os avisos de atualização no
  visual novo.

**Pronto quando:** trocar o nome visível aparece na próxima entrada na sala; ligar o beta de alguém no
banco faz o app dessa pessoa verificar o beta na hora; com a API fora do ar, o app verifica o estável.

## Etapa 7: Painel de controle — concluída

- Convites: os três modelos, o bilhete, o histórico com filtros e o Revogar.
- Membros: os filtros, o beta, o menu do membro e a gaveta de permissões.
- O aviso de quem entrou, a cada 30 s no app do dono.
- Remover ou desvincular tira a pessoa da sala de voz na hora (`kick_in_background`), e o app dela confere
  a sessão.

**Pronto quando:** cada ação do Painel funciona contra a API da Etapa 1, e quem entra com um convite aparece
no aviso do dono em até 30 s.

## Etapa 8: lançamento — pendente

- Beta com o dono vinculado por uma recuperação; a troca do grupo; versão mínima, sem `/api/voice/join` e
  sem `ACCESS_CODE`, tudo junto.
- Uma correção do app sem o `X-Access-Code`; o `admin` só com `dono` e `backup`.
- O roteiro de testes manual com dois computadores; `README.md`, `ARCHITECTURE.md` e `docs/roadmap.md` em
  dia.

**Pronto quando:** todo o grupo está no estável com conta, e a API recusa a rota velha e o app velho com o
pedido de atualização.

---

**Critério de pronto da fase:** os critérios do roadmap para a v0.2.1 que dependem do app (convite → nick →
entrar na sala; recuperação → mesmo usuário; formatar o Windows → entra direto; sem identidade válida →
nenhum token do LiveKit), o roteiro manual da Etapa 8 passando, o grupo inteiro no estável com conta, e
todos os itens do `NOTES.md` resolvidos ou conscientemente adiados.
cr
