# Discord-like

Aplicação privada de comunicação para uma única comunidade, inspirada no Discord.

> O nome do projeto é provisório.
> Status atual: **v0.1 — Vertical Slice** (em andamento)

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

A prioridade é chegar ao funcionamento básico o mais rápido possível:

```text
Chat
  ↓
Voz
  ↓
Screen Share
```

A primeira versão deve ser simples e voltada para aproximadamente 5–10 usuários.

## Roadmap

```text
v0.1  → Vertical slice
        Tauri + React + Axum + LiveKit
        Chat mockado + voz + screen share

v0.2  → Identidade
        Login + sessão + convites

v0.3  → Chat real
        Persistência + mensagens + tempo real

v0.4  → Produto integrado
        Canais + chat + voz + screen share

v0.5  → Confiabilidade
        Reconexão + estados de erro + dispositivos

v0.6  → Segurança
        Permissões + administração básica

v0.7  → Chat avançado
        Editar + excluir + responder + reações + anexos

v0.8  → Voz avançada
        Múltiplas salas + refinamentos

v0.9  → Release Candidate
        Testes + estabilidade + preparação para uso real

v1.0  → Primeira versão estável
        Uso privado com 5–10 usuários
```

O detalhamento do roadmap fica em [`docs/roadmap.md`](docs/roadmap.md).

## Infraestrutura

O desenvolvimento é local. Para os testes com usuários reais, a infraestrutura será montada em
etapas, sem custo fixo até que o uso justifique:

```text
Desenvolvimento local
        ↓
Testes com usuários reais
  • API pelo Cloudflare Tunnel
  • mídia pelo LiveKit Cloud (plano gratuito)
        ↓
Avaliação
        ↓
VPS com LiveKit próprio, quando o uso ficar regular
```

**API pelo Cloudflare Tunnel.** O túnel nomeado é gratuito e exige uma conta na Cloudflare e um domínio
com o DNS gerenciado por ela. Ele só transporta HTTP e WebSocket, por isso serve para a API, mas não
para a mídia, que trafega por UDP.

**Mídia pelo LiveKit Cloud.** O plano gratuito (Build) inclui, por mês, 5.000 minutos de participante,
50 GB de dados transferidos e até 100 participantes simultâneos. Os limites são um teto rígido: se
forem atingidos, novas conexões falham até o início do mês seguinte. Como estimativa, isso comporta
algumas noites de chamada por mês com o grupo inteiro, e perto de 10 horas de compartilhamento de tela
assistido por quatro pessoas. Acompanhe o consumo no painel do LiveKit Cloud.

**VPS.** Quando os limites do plano gratuito começarem a apertar, o servidor do LiveKit (que é
gratuito e de código aberto) passa a rodar numa VPS. Para o código, a troca é só de configuração: a
URL, a chave e o segredo do LiveKit no `.env`.

## Status

Em desenvolvimento, na **v0.1**. O foco atual é a reorganização do compartilhamento de tela em uma
estrutura definitiva, detalhada em [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Licença

Ainda não definida.
