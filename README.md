# Discord-like

Aplicação privada de comunicação para uma única comunidade, inspirada no Discord.


* chat de texto;
* voz;
* compartilhamento de tela;
* áudio do sistema quando disponível.

> O nome do projeto é provisório.

## Arquitetura

Monorepo com dois projetos:

```text
discord-like/
├── desktop/   # Tauri + React + TypeScript
├── api/       # Rust + Axum
├── docs/
│   └── roadmap.md
├── .env.example
├── .gitignore
├── rust-toolchain.toml
└── README.md
```

### Desktop

O `desktop` é o aplicativo principal.

Responsável por:

* interface;
* navegação;
* chat;
* conexão com a API;
* integração com LiveKit;
* voz;
* screen share;
* integração com recursos locais via Tauri.

### API

O `api` é o backend da aplicação.

Responsável por:

* usuários;
* autenticação;
* sessões;
* convites;
* canais;
* mensagens;
* permissões;
* geração de tokens do LiveKit.

### Mídia

O LiveKit será responsável pela camada de mídia:

```text
Desktop
   ├── HTTP ──────→ API
   │                 └── token LiveKit
   │
   └── LiveKit SDK ─→ LiveKit Server
```

Não será implementado um servidor WebRTC/SFU próprio.

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

O desenvolvimento será inicialmente local.

Antes de contratar uma VPS, a ideia é testar o projeto utilizando **Cloudflare Tunnel** para expor os serviços necessários e avaliar:

* estabilidade;
* latência;
* conectividade;
* praticidade;
* experiência com usuários reais.

A VPS será considerada somente se os testes mostrarem que o túnel não atende às necessidades do projeto.

```text
Desenvolvimento local
        ↓
Cloudflare Tunnel
        ↓
Testes com usuários reais
        ↓
Avaliação
        ↓
VPS, se necessário
```

## Desenvolvimento

### Desktop

```bash
cd desktop
pnpm install
pnpm tauri dev
```

### API

```bash
cd api
cargo run
```

## Status

Em desenvolvimento.

A implementação atual está começando pela base do `desktop` com Tauri/React e da `api` com Rust/Axum.

## Licença

Ainda não definida.
