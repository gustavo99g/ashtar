# Ashtar

Ashtar é uma aplicação privada de comunicação para uma única comunidade, inspirada no Discord.

> Status atual: **v0.3.1 — Todo o chat** (conversas privadas, não lidas, menções, silenciar, notificações e status, na `0.3.10`; a v0.3.2 traz as ligações privadas)

## Funcionalidades

* ✓ chat de texto (mockado)
* ✓ voz via LiveKit
* ✓ compartilhamento de tela (janela ou tela inteira)
* ⚙️ áudio do compartilhamento: só do aplicativo escolhido ou de todo o sistema, quando o Windows suportar

## Plataformas

| Plataforma | Situação |
|---|---|
| **Windows 10 e 11** | Suportado. É a única plataforma do app hoje. |
| **Linux (x86_64)** | A avaliar depois. A estrutura do código já prevê uma segunda plataforma, mas há riscos a verificar antes: o suporte a WebRTC no webview do Linux e a captura de tela pelo portal do sistema. |
| **macOS** | Fora do escopo. |

A captura de áudio de um aplicativo específico usa um recurso recente do Windows. Em versões mais
antigas, o compartilhamento de tela funciona, mas sem essa opção de áudio.

## Requisitos para desenvolver

* **Windows 10 ou 11**
* **Rust**, na versão fixada em `rust-toolchain.toml` (o `rustup` instala automaticamente)
* **Visual Studio Build Tools** com o workload de C++ e o **WebView2** (já vem no Windows 11); veja os
  [pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/)
* **Node.js 20** ou mais recente e **pnpm**
* **Servidor LiveKit**: local para desenvolver, ou um projeto no LiveKit Cloud (veja
  [Infraestrutura](#infraestrutura))

Não é preciso instalar o Tauri CLI globalmente: o `pnpm tauri` usa o pacote do próprio projeto.

## Estrutura do repositório

Monorepo com dois projetos:

```text
ashtar/
├── desktop/          # app: Tauri + React + TypeScript, com núcleo em Rust
├── api/              # backend: Rust + Axum
├── docs/
│   ├── adr/          # registros de decisões de arquitetura
│   └── roadmap.md
├── ARCHITECTURE.md   # mapa do código e regras entre módulos
├── .env.example
├── .gitignore
├── rust-toolchain.toml
└── README.md
```

## Rodando localmente

### 1. Configuração

Copie o `.env.example` para `.env` e preencha as variáveis do LiveKit (URL do servidor, chave e
segredo). Para o servidor local em modo de desenvolvimento, a chave é `devkey` e o segredo é `secret`.

`VITE_API_URL` é a URL da API que o app desktop chama (sem barra final). Em desenvolvimento, sem ela, o
app usa `http://127.0.0.1:3000`; num app gerado com `tauri build`, ela é obrigatória. O valor é gravado no
build: mudou, reinicie o `tauri dev` ou gere o app de novo.

`PUBLIC_URL` é o endereço público da API (sem barra final). Ela monta com ele o link dos convites
(`/invite/CÓDIGO`). Em desenvolvimento, `http://127.0.0.1:3000`; no computador de casa, a URL do Funnel.

### 2. LiveKit

Baixe o `livekit-server` na [página de releases](https://github.com/livekit/livekit/releases) e rode
em modo de desenvolvimento:

```bash
livekit-server --dev
```

### 3. API

A API guarda membros, convites e permissões num banco SQLite. Defina no `.env` o arquivo do banco (veja o
`.env.example`; o caminho é relativo à pasta `api/`) e suba o servidor:

```bash
# .env
DATABASE_URL=sqlite://ashtar.db

cd api
cargo run
```

O arquivo é criado e as migrações (`api/migrations/`) são aplicadas na primeira vez.

**Administração (`admin`).** Uma ferramenta de linha de comando, no mesmo computador e com o mesmo `.env`,
que funciona com a API ligada. É temporária: a UI da v0.2.2 passa a fazer isso. `--help` lista os comandos.

```bash
cargo run --bin admin -- dono <nick>                    # cria o dono, uma vez só
cargo run --bin admin -- convite                        # novo, 7 dias, 1 uso
cargo run --bin admin -- convite --validade 5m --usos 8 # para mandar no grupo
cargo run --bin admin -- recuperacao <nick>             # troca o computador de um membro
cargo run --bin admin -- convites                       # histórico: quem criou e quem usou
cargo run --bin admin -- revogar <id>
cargo run --bin admin -- membros
cargo run --bin admin -- remover <nick>
cargo run --bin admin -- desvincular <nick>
cargo run --bin admin -- beta <nick> ligar|desligar
cargo run --bin admin -- permissoes <nick>
cargo run --bin admin -- semear [--mensagens 1200]      # só no desenvolvimento: ana, bia, caio e o #geral cheio
```

O código de um convite aparece uma vez só, na criação: copie na hora.

**Backup.** `admin backup <pasta>` grava uma cópia consistente do banco (`VACUUM INTO`, seguro com a API no ar)
com a data no nome e apaga as mais antigas (`--manter`, 14 por padrão). Um agendamento diário do Windows
chama esse comando e envia a cópia para fora do computador (Cloudflare R2). Não copie o `.db` à mão: em modo
WAL, parte dos dados pode estar no arquivo `-wal`.

**Restaurar.** Pare a API, aponte o `DATABASE_URL` para a cópia (ou coloque a cópia no lugar do `.db`),
confira com `admin membros` e `admin convites`, e suba a API de novo.

### 4. Desktop

```bash
cd desktop
pnpm install
pnpm app:dev
```

Para ver as métricas de desempenho da captura no terminal, rode com `RUST_LOG=info,perf=debug`.
Números de desempenho só valem em build de release.

## Arquitetura

O app se divide em duas partes que conversam pelo IPC do Tauri:

* **React (webview):** interface, conexão da voz com a sala do LiveKit, microfone, reprodução das
  vozes e exibição das transmissões dos outros participantes.
* **Rust:** captura de janelas, telas e do áudio de aplicativos, o vídeo na GPU (WGC, conversão e
  encoder H.264 de hardware), a publicação da transmissão e tudo que depende do sistema operacional.

```text
Desktop
   ├── React ── HTTP ──────────→ API
   │     │                        └── tokens LiveKit (voz e :screen)
   │     └── LiveKit SDK (voz) ─→ LiveKit Server
   │                                  ↑
   └── Rust (captura, GPU, encoder) ──┘  (conexão :screen: vídeo e áudio da transmissão)
```

A API cuida de usuários, autenticação, sessões, convites, canais, mensagens, permissões e da geração
dos tokens do LiveKit. Não será implementado um servidor de mídia próprio: o LiveKit cuida dessa
camada.

Os detalhes estão em [`ARCHITECTURE.md`](ARCHITECTURE.md), e os motivos das principais decisões em
[`docs/adr/`](docs/adr/).

## Prioridade

O uso principal do aplicativo é o compartilhamento de tela, e a mídia é a parte tecnicamente mais
incerta, por isso vem primeiro:

```text
Voz + Screen Share
  ↓
Comunidade (identidade + chat)
  ↓
Recursos secundários
```

A primeira versão deve ser simples e voltada para aproximadamente 5–10 usuários.

## Roadmap

```text
v0.1  → Teste com o grupo
        Voz + screen share reorganizado, liberado como teste
        (Tailscale Funnel + LiveKit Cloud)

v0.2  → Comunidade
        Entregue em partes: auto-update → convites sem senha → UI nova → chat real e supressão
        de ruído → servidor na VPS → publicador nativo

v0.3  → Conversas privadas
        Lista de canais nova + mensagens privadas + não lidas, menções e notificações
        + status + ligações privadas

v0.4  → Transmissões múltiplas
        Várias transmissões simultâneas + experiência de quem assiste

v0.5  → Salas e presença
        Várias salas de voz + ausente automático + digitando + sons da voz

v0.6  → Confiabilidade e configurações
        Reconexão + estados + tela de configurações + atalhos globais

v0.7  → Perfil e chat avançado
        Nick e foto + anexos + editar, responder, reagir + busca

v0.8  → Atividade, moderação e refinamentos
        "Jogando X" + administração + refinos do screen share

v0.9  → Release Candidate
        Testes + estabilidade

v1.0  → Primeira versão estável
        O grupo usa o app como ferramenta principal
```

O detalhamento do roadmap fica em [`docs/roadmap.md`](docs/roadmap.md).

## Infraestrutura

O desenvolvimento é local. Para os testes com usuários reais, a infraestrutura será montada em
etapas, sem custo fixo até que o uso justifique:

```text
Desenvolvimento local
        ↓
Teste com o grupo (v0.1)
  • API pelo Tailscale Funnel
  • mídia pelo LiveKit Cloud (plano gratuito)
        ↓
VPS com LiveKit, API e banco (v0.2)
```

**API pelo Tailscale Funnel.** O Funnel é gratuito no plano pessoal e dá uma URL fixa
(`https://<máquina>.<rede>.ts.net`) sem exigir domínio próprio: só o computador que roda a API instala o
Tailscale (`tailscale funnel --bg 3000`). Na primeira vez, o nome público levou um tempo para ser publicado
no DNS; enquanto isso, o túnel rápido da Cloudflare (`cloudflared tunnel --url http://127.0.0.1:3000`)
serviu de alternativa, com a ressalva de que a URL muda a cada reinício. Os dois só transportam HTTP e
WebSocket, por isso servem para a API, mas não para a mídia, que trafega por UDP. Com um domínio próprio
(necessário de qualquer forma na v0.2.5), o túnel nomeado da Cloudflare também dá uma URL fixa.

**Mídia pelo LiveKit Cloud.** O plano gratuito (Build) inclui, por mês, 5.000 minutos de participante,
50 GB de dados transferidos e até 100 participantes simultâneos. Os limites são um teto rígido: se
forem atingidos, novas conexões falham até o início do mês seguinte. Acompanhe o consumo no painel do
LiveKit Cloud.

Estimativa para um grupo de 5 pessoas, com o bitrate máximo de cada preset do app (`bitrate_bps` em
`desktop/src-tauri/src/media/quality.rs`; os valores são o ponto de partida da v0.2.4 e ainda não foram
medidos em uso real, e o consumo fica abaixo do teto quando a imagem muda pouco):

| Preset | Bitrate máximo | Tráfego com 4 pessoas assistindo | Horas no plano gratuito |
|---|---|---|---|
| Leve (720p60) | 4 Mbps | ~7,2 GB/h | ~7 h |
| Movimento (1080p60) | 8 Mbps | ~14,4 GB/h | ~3,5 h |
| Nitidez (1080p30) | 6 Mbps | ~10,8 GB/h | ~4,6 h |

Os minutos duram mais que o tráfego: 5 pessoas por 3 horas gastam 900 minutos, cerca de 5 noites por mês,
mas o tráfego do Movimento acaba em cerca de 3,5 horas. Desde a v0.2.4, quem transmite abre uma segunda
conexão (a `:screen`) e conta como mais um participante no Cloud: a mesma noite de 5 pessoas vira 6
participantes, ~1.080 minutos, e o grupo ainda cabe nos 5.000 minutos do plano. Ou seja, o plano gratuito
comporta uma ou duas noites no Movimento e algumas no Leve, não um mês de uso.

O plano pago seguinte inclui 150.000 minutos e 250 GB, com excedente de US$ 0,12/GB. Com uso intenso
(4 noites por semana, 3 horas, um preset de 8 Mbps no teto, 4 pessoas assistindo), seriam uns 750 GB por
mês, cerca de US$ 60 de excedente além da mensalidade. O limite que aperta é sempre o tráfego, nunca os
minutos.

Durante o teste da v0.1, o preset mais leve (o Leve, 720p60) estica a cota, e o consumo de uma noite real (GB e
minutos) deve ser anotado: é o número que confirma o dimensionamento da VPS.

**Conexão de quem transmite.** O Movimento usa até 8 Mbps de vídeo; com o áudio e a sobrecarga, conte
~9 Mbps de upload para quem transmite fora da rede local, e um download parecido para cada pessoa que
assiste. A Nitidez usa até 6 Mbps e o Leve até 4. O app segue a estimativa de banda da LiveKit, abaixo do
teto do preset, e o painel avisa quando a rede está limitando.

**VPS.** Na v0.2.5, o servidor do LiveKit (que é gratuito e de código aberto), a API e o banco passam a
rodar numa VPS própria. O LiveKit próprio é pré-requisito das transmissões múltiplas da v0.4, e a API e
o banco deixam de depender de um computador pessoal ligado. Se os limites do plano gratuito apertarem
antes, a migração é antecipada. Para o código do LiveKit, a troca é só de configuração: a URL, a chave
e o segredo no `.env`.

A VPS é escolhida pelo **tráfego de saída incluso** e pela **latência** até o grupo, não só pela CPU.
O LiveKit não recodifica vídeo, só repassa os pacotes, então para 5–10 pessoas ele usa pouca CPU e o que
pesa é a rede. Um servidor nos EUA ou na Europa sai barato, mas soma de 120 a 200 ms para quem está no
Brasil.

Candidata: **Hostinger VPS no Brasil** (preços de outubro de 2026, promoção com contrato de 24 meses):

| Plano | Recursos | Tráfego | Promoção | Renovação |
|---|---|---|---|---|
| KVM 1 | 1 vCPU, 4 GB RAM, 50 GB NVMe | 4 TB | R$ 29,99/mês | R$ 59,99/mês |
| **KVM 2** | 2 vCPU, 8 GB RAM, 100 GB NVMe | 8 TB | R$ 43,99/mês | R$ 77,99/mês |

A preferida é a **KVM 2**: na mesma máquina rodam LiveKit, API, banco e TURN, e com um único núcleo um
pico de qualquer um deles afeta a voz de todos. A KVM 2 também deixa folga para as transmissões
múltiplas da v0.4. A KVM 1 é viável para começar se for possível fazer upgrade sem migrar a máquina.
Em tráfego, os dois planos sobram: o uso intenso estimado fica em 0,5–1,5 TB por mês.

A confirmar antes de assinar:

* **portas UDP liberadas**: o LiveKit precisa de uma faixa UDP (por padrão 50000–60000), de 7881/TCP e
  de 443 para o TURN. O Cloudflare Tunnel não transporta mídia, então o LiveKit fica exposto direto,
  com domínio próprio e certificado;
* o que acontece ao passar do tráfego do plano: cobrança extra, redução de velocidade ou bloqueio;
* se o tráfego do plano conta só a saída ou entrada e saída;
* upgrade de plano sem migrar a máquina;
* o consumo medido no teste da v0.1 confirma a estimativa.

O backup semanal da Hostinger não substitui o backup fora da VPS, que começa na v0.2.1 junto com o banco: se a conta ou a
máquina tiver problema, os dois se perdem juntos.

## Status

Em desenvolvimento, na **v0.3**, entregue em três partes (veja o [`docs/roadmap.md`](docs/roadmap.md)). A v0.2
está pronta, com o servidor próprio na VPS (a voz, as transmissões e a API). A v0.3.0 (a base visual: a lista
de canais sem ferramentas fixas, o modo Organizar, o cartão do usuário e o volume por pessoa) e a v0.3.1 (as
conversas privadas, as não lidas, as menções, o silenciar, as notificações e o status) saem juntas, na versão
`0.3.10`. A próxima é a v0.3.2, com as ligações privadas. O plano da fase está no [`PLAN.md`](PLAN.md), e a
estrutura do código em [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Licença

Ainda não definida.
