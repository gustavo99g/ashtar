# Discord-like

Aplicação privada de comunicação para uma única comunidade, inspirada no Discord.

> O nome do projeto é provisório.
> Status atual: **v0.1 — Teste com o grupo** (em andamento)

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
discord-like/
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

### 2. LiveKit

Baixe o `livekit-server` na [página de releases](https://github.com/livekit/livekit/releases) e rode
em modo de desenvolvimento:

```bash
livekit-server --dev
```

### 3. API

```bash
cd api
cargo run
```

### 4. Desktop

```bash
cd desktop
pnpm install
pnpm tauri dev
```

Para ver as métricas de desempenho da captura no terminal, rode com `RUST_LOG=info,perf=debug`.
Números de desempenho só valem em build de release.

## Arquitetura

O app se divide em duas partes que conversam pelo IPC do Tauri:

* **React (webview):** interface, conexão com a sala do LiveKit, microfone, reprodução das vozes e
  exibição das transmissões dos outros participantes.
* **Rust:** captura de janelas, telas e do áudio de aplicativos, e tudo que depende do sistema
  operacional.

```text
Desktop
   ├── React ── HTTP ──────────→ API
   │     │                        └── token LiveKit
   │     └── LiveKit SDK ──────→ LiveKit Server
   │           ↑
   └── Rust (captura de tela e áudio) ── IPC ──┘
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
        (Cloudflare Tunnel + LiveKit Cloud)

v0.2  → Comunidade
        Entregue em partes: auto-update → servidor na VPS → convites sem senha
        → supressão de ruído → UI nova → chat real → publicador nativo

v0.3  → Conversas privadas
        Mensagens e ligações privadas + não lidas + bandeja

v0.4  → Transmissões múltiplas
        Várias transmissões simultâneas + experiência de quem assiste

v0.5  → Canais e presença
        Múltiplos canais e salas + status + menções + sons da voz

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
  • API pelo Cloudflare Tunnel
  • mídia pelo LiveKit Cloud (plano gratuito)
        ↓
VPS com LiveKit, API e banco (v0.2)
```

**API pelo Cloudflare Tunnel.** O túnel nomeado é gratuito e exige uma conta na Cloudflare e um domínio
com o DNS gerenciado por ela. Ele só transporta HTTP e WebSocket, por isso serve para a API, mas não
para a mídia, que trafega por UDP.

**Mídia pelo LiveKit Cloud.** O plano gratuito (Build) inclui, por mês, 5.000 minutos de participante,
50 GB de dados transferidos e até 100 participantes simultâneos. Os limites são um teto rígido: se
forem atingidos, novas conexões falham até o início do mês seguinte. Acompanhe o consumo no painel do
LiveKit Cloud.

Estimativa para um grupo de 5 pessoas, com o bitrate máximo de cada preset do app (`maxBitrate` em
`desktop/src/features/screen-share/presets.ts`; ainda não medido em uso real, e o consumo fica abaixo do
teto quando a imagem muda pouco):

| Preset | Bitrate máximo | Tráfego com 4 pessoas assistindo | Horas no plano gratuito |
|---|---|---|---|
| 720p60 | 3,5 Mbps | ~6,3 GB/h | ~8 h |
| 900p60 | 8 Mbps | ~14,4 GB/h | ~3,5 h |
| 1080p30 | 8 Mbps | ~14,4 GB/h | ~3,5 h |

Os minutos duram mais que o tráfego: 5 pessoas por 3 horas gastam 900 minutos, cerca de 5 noites por mês,
mas o tráfego dos presets de 8 Mbps acaba em cerca de 3,5 horas. Com o publicador nativo (v0.2.6), quem
transmite abre uma segunda conexão e conta como dois participantes. Ou seja, o plano gratuito comporta uma
ou duas noites nos presets pesados e algumas no 720p60, não um mês de uso.

O plano pago seguinte inclui 150.000 minutos e 250 GB, com excedente de US$ 0,12/GB. Com uso intenso
(4 noites por semana, 3 horas, um preset de 8 Mbps no teto, 4 pessoas assistindo), seriam uns 750 GB por
mês, cerca de US$ 60 de excedente além da mensalidade. O limite que aperta é sempre o tráfego, nunca os
minutos.

Durante o teste da v0.1, o preset mais leve (720p60) estica a cota, e o consumo de uma noite real (GB e
minutos) deve ser anotado: é o número que confirma o dimensionamento da VPS.

**Conexão de quem transmite.** Os presets Equilibrado e Nitidez usam até 8 Mbps de vídeo; com o áudio e a
sobrecarga, conte ~9 Mbps de upload para quem transmite fora da rede local, e um download parecido para
cada pessoa que assiste. O Movimento usa até 3,5 Mbps.

**VPS.** Na v0.2.1, o servidor do LiveKit (que é gratuito e de código aberto), a API e o banco passam a
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

O backup semanal da Hostinger não substitui o backup fora da VPS previsto na v0.2.1: se a conta ou a
máquina tiver problema, os dois se perdem juntos.

## Status

Em desenvolvimento, na **v0.1**. O foco atual é a reorganização do compartilhamento de tela em uma
estrutura definitiva, detalhada em [`ARCHITECTURE.md`](ARCHITECTURE.md), seguida da liberação do app
para o grupo como teste.

## Licença

Ainda não definida.
