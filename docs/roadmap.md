# Roadmap

Roadmap funcional do projeto até a primeira versão estável.

O foco é chegar o mais rápido possível a uma aplicação utilizável por uma única comunidade de aproximadamente 5–10 pessoas, sem tentar reproduzir todos os recursos do Discord.

---

# Visão geral

```text
v0.1  → Vertical Slice
        Chat mockado + Voz + Screen Share
        ↓
v0.2  → Identidade e acesso
        Login + Sessão + Convites
        ↓
v0.3  → Chat real
        Persistência + Mensagens + Tempo real
        ↓
v0.4  → Produto integrado
        Canais + Chat + Voz + Screen Share
        ↓
v0.5  → Confiabilidade
        Reconexão + Estados + Dispositivos
        ↓
v0.6  → Segurança e administração básica
        ↓
v0.7  → Experiência de chat
        ↓
v0.8  → Experiência de voz
        ↓
v0.9  → Release Candidate
        ↓
v1.0  → Primeira versão estável
```

## Princípios do roadmap

### Prioridade por risco

As partes tecnicamente mais incertas devem ser validadas primeiro.

```text
Voz
 ↓
Screen Share
 ↓
Chat real
 ↓
Recursos secundários
```

### Vertical slice antes de infraestrutura completa

A primeira versão deve provar que o fluxo principal funciona antes de investir em autenticação, banco, administração ou recursos avançados.

### Evitar complexidade prematura

Não implementar uma funcionalidade apenas porque aplicações semelhantes possuem.

Cada etapa deve aproximar o projeto de uma aplicação realmente utilizável.

### Um produto, dois projetos

O monorepo possui dois projetos:

```text
desktop/
api/
```

O `desktop` é a aplicação Tauri.

O `api` é o backend Rust/Axum.

---

# v0.1 — Vertical Slice

## Objetivo

Validar rapidamente a tecnologia principal e o fluxo de mídia entre usuários.

O resultado desejado é conseguir abrir o aplicativo em duas ou mais máquinas e conversar por voz e compartilhar tela.

O chat ainda pode ser completamente mockado.

## Desktop

### Base

* Tauri funcionando;
* React + TypeScript;
* Vite;
* estrutura inicial de componentes;
* App Shell;
* navegação visual.

### Chat

* canal de texto `general`;
* mensagens mockadas;
* Message;
* Message Actions;
* Message More Menu;
* Message Composer;
* estado visual de hover;
* scroll de mensagens.

Não haverá persistência.

### Voz

* integração com LiveKit;
* entrada em uma sala fixa;
* exibição de participantes;
* microfone;
* mute;
* deafen;
* saída da sala;
* reconexão básica.

### Screen Share

* iniciar compartilhamento;
* parar compartilhamento;
* receber transmissão;
* exibir participante que está compartilhando;
* limite inicial de uma transmissão simultânea.

### Áudio

* receber áudio dos participantes;
* mute;
* suporte ao áudio associado ao screen share quando disponibilizado pela fonte escolhida.

## API

### Base

* Rust;
* Tokio;
* Axum;
* configuração por ambiente;
* `/health`.

### LiveKit

* geração temporária de token;
* URL do LiveKit configurável;
* API key e secret somente no backend.

O endpoint será restrito ao modo de desenvolvimento.

## Fora do escopo

* login real;
* cadastro real;
* convites reais;
* SQLite;
* PostgreSQL;
* histórico de mensagens;
* WebSocket próprio;
* múltiplas comunidades;
* câmera;
* permissões completas;
* administração;
* deploy definitivo.

## Critérios de conclusão

A etapa estará concluída quando:

```text
M01 — Dois participantes
M02 — Microfone
M03 — Screen Share
M04 — Screen Share + áudio
M05 — Terceiro participante
M06 — Reentrada
M07 — Reconexão
```

forem validados com sucesso.

---

# v0.2 — Identidade e acesso

## Objetivo

Substituir o ambiente de desenvolvimento anônimo por identidade real.

## API

### Usuários

* modelo de usuário;
* criação de usuário;
* consulta de usuário;
* atualização de perfil básico.

### Autenticação

* cadastro;
* login;
* logout;
* senha;
* sessão;
* expiração de sessão;
* renovação de sessão, se necessária.

### Convites

* criar convite;
* gerar código;
* validar convite;
* registrar uso;
* impedir reutilização;
* expiração;
* revogação.

### Autorização

* somente usuários autorizados acessam a comunidade;
* somente usuários autorizados recebem token LiveKit.

## Desktop

* tela de login;
* tela de cadastro;
* fluxo de convite;
* persistência da sessão;
* logout;
* carregamento do usuário atual;
* estados de erro;
* estados de carregamento.

## Critérios de conclusão

```text
Convite
 ↓
Cadastro
 ↓
Login
 ↓
Sessão
 ↓
Acesso à comunidade
 ↓
Token LiveKit autorizado
```

Tudo deve funcionar sem depender de usuários mockados.

---

# v0.3 — Chat real

## Objetivo

Transformar o chat mockado em comunicação persistente.

## Persistência

Implementar o armazenamento necessário para:

* usuários;
* sessões;
* convites;
* canais;
* mensagens.

O banco escolhido para esta fase deverá ser definido antes da implementação da persistência.

## Mensagens

* enviar;
* receber;
* persistir;
* carregar histórico;
* ordenar por data;
* paginação ou carregamento incremental;
* estado de envio;
* tratamento de erro.

## Tempo real

Adicionar comunicação em tempo real para eventos da aplicação.

Eventos iniciais:

```text
message.created
message.updated
message.deleted
presence.changed
```

O WebSocket próprio será usado para eventos do aplicativo.

A mídia continuará utilizando LiveKit.

## Desktop

* substituir mensagens mockadas;
* conectar Message Composer à API;
* atualização automática do histórico;
* tratamento de mensagens em envio;
* tratamento de falhas;
* reconexão do canal de eventos.

## Critérios de conclusão

Dois usuários devem conseguir:

```text
abrir o canal
↓
enviar mensagem
↓
o outro receber
↓
fechar e reabrir
↓
ver o histórico
```

---

# v0.4 — Produto integrado

## Objetivo

Unir identidade, chat e mídia em uma aplicação coerente.

## Canais

### Texto

* múltiplos canais;
* seleção;
* estado ativo;
* histórico por canal.

### Voz

* múltiplas salas;
* seleção;
* entrada;
* saída;
* indicação de conexão.

## Estado independente de texto e voz

A conexão de voz não depende do canal de texto selecionado.

Exemplo:

```text
Canal de texto:
# general

Canal de voz conectado:
🔊 General
```

Ao trocar para:

```text
# development
```

o usuário continua conectado à sala:

```text
🔊 General
```

## Presença

* online;
* offline;
* conectado à voz;
* participantes da sala.

## Integração

O aplicativo deve permitir:

```text
Chat
 +
Voice
 +
Screen Share
 +
Identity
```

sem fluxos quebrados.

## Critérios de conclusão

Um usuário deve conseguir:

```text
login
 ↓
abrir chat
 ↓
enviar mensagem
 ↓
entrar em voz
 ↓
continuar navegando pelo chat
 ↓
compartilhar tela
 ↓
sair da voz
```

---

# v0.5 — Confiabilidade

## Objetivo

Resolver falhas comuns antes de aumentar o escopo funcional.

## API

* tratamento consistente de erros;
* timeouts;
* logs;
* validação de entrada;
* respostas previsíveis;
* tratamento de indisponibilidade.

## Desktop

### Sessão

* recuperação de sessão;
* sessão expirada;
* retorno ao login quando necessário.

### API

* API indisponível;
* tentativa de reconexão;
* feedback visual.

### LiveKit

* reconexão;
* saída involuntária;
* recuperação;
* atualização do estado da conexão.

### Dispositivos

* microfone desconectado;
* dispositivo de saída indisponível;
* troca de dispositivo;
* recuperação após reconexão.

## Estados de interface

Implementar claramente:

```text
default
loading
empty
error
offline
connecting
connected
reconnecting
```

## Critérios de conclusão

Uma falha curta de API ou rede não deve deixar o cliente preso em um estado inconsistente.

---

# v0.6 — Segurança e administração básica

## Objetivo

Tornar a comunidade privada adequada para uso real.

## Convites

* revogar;
* expirar;
* impedir uso múltiplo;
* impedir criação abusiva.

## Usuários

* expulsar;
* bloquear acesso;
* invalidar sessões.

## Permissões

Implementar somente o necessário para uma comunidade pequena.

Exemplos:

```text
usuário comum
administrador
```

Não criar um sistema complexo de cargos nesta etapa.

## Segurança

* proteção dos endpoints;
* autorização;
* validação;
* rate limiting;
* armazenamento seguro de segredos;
* logs relevantes;
* nunca expor segredo do LiveKit ao desktop.

## Critérios de conclusão

Um usuário sem autorização não consegue:

```text
acessar dados protegidos
emitir token LiveKit
entrar na comunidade
```

---

# v0.7 — Experiência de chat

## Objetivo

Melhorar o chat depois que a infraestrutura estiver estável.

## Mensagens

Adicionar gradualmente:

* editar mensagem;
* excluir mensagem;
* copiar mensagem;
* responder;
* reações;
* links;
* anexos básicos.

## Interface

* melhorias de agrupamento;
* estados de mensagens;
* feedback de envio;
* melhorias de scroll;
* estados vazios;
* mensagens de erro.

## Critério

Esses recursos devem entrar somente se a base do chat continuar simples e consistente.

Não adicionar funcionalidades que dificultem a manutenção sem benefício claro para o grupo inicial.

---

# v0.8 — Experiência de voz

## Objetivo

Refinar a experiência de voz depois de a camada de mídia estar comprovadamente funcionando.

## Salas

* múltiplas salas;
* troca de sala;
* estado de conexão;
* participantes.

## Áudio

* seleção de microfone;
* seleção de saída;
* teste de microfone;
* volume;
* tratamento de dispositivo desconectado.

## Participantes

* speaking indicator;
* mute;
* deafen;
* estados de conexão.

## Screen Share

* iniciar;
* parar;
* participante que compartilha;
* tratamento de transmissão existente;
* comportamento ao entrar/sair;
* limite de transmissão configurado.

## Reconexão

Refinar a recuperação de:

```text
voz
screen share
participantes
dispositivos
```

---

# v0.9 — Release Candidate

## Objetivo

Parar de adicionar funcionalidades e preparar a primeira versão para uso real.

## Estabilidade

* corrigir bugs;
* eliminar estados inconsistentes;
* revisar fluxos principais;
* revisar mensagens de erro;
* revisar carregamentos;
* revisar reconexão.

## Testes

### Mídia

```text
M01 — Dois participantes
M02 — Microfone
M03 — Screen Share
M04 — Screen Share + áudio
M05 — Terceiro participante
M06 — Reentrada
M07 — Reconexão
```

### Aplicação

```text
A01 — Cadastro
A02 — Login
A03 — Logout
A04 — Convite válido
A05 — Convite inválido
A06 — Convite expirado
A07 — Sessão expirada
A08 — API indisponível
A09 — LiveKit indisponível
A10 — Navegação texto + voz
```

## Build

* build do Windows;
* instalação;
* atualização da versão;
* configuração de ambiente;
* configuração de produção.

## Infraestrutura

A API vai atrás do **Cloudflare Tunnel** (gratuito, só HTTP/WebSocket); a mídia usa o **LiveKit Cloud** (plano gratuito). Ver o detalhamento em [README.md](../README.md).

A avaliação deverá considerar:

* estabilidade;
* latência;
* conectividade;
* limitações;
* praticidade;
* experiência dos usuários;
* manutenção.

Quando os limites do plano gratuito do LiveKit Cloud começarem a apertar com o uso regular, o LiveKit passa a rodar numa VPS própria.

---

# v1.0 — Primeira versão estável

## Objetivo

Disponibilizar a primeira versão realmente utilizável para aproximadamente 5–10 amigos.

## Identidade

```text
✓ cadastro por convite
✓ login
✓ logout
✓ sessão
✓ perfil básico
```

## Chat

```text
✓ canais de texto
✓ histórico
✓ envio
✓ tempo real
✓ edição
✓ exclusão
✓ ações básicas
```

## Voz

```text
✓ canais de voz
✓ entrar
✓ sair
✓ mute
✓ deafen
✓ participantes
✓ reconexão
```

## Screen Share

```text
✓ compartilhar tela
✓ receber tela
✓ áudio quando disponível
✓ limite de transmissão
```

## Comunidade

```text
✓ uma comunidade
✓ convites
✓ acesso privado
✓ presença
✓ permissões básicas
```

## Cliente

```text
✓ aplicação desktop Tauri
✓ interface consistente
✓ estados de erro
✓ estados de carregamento
✓ reconexão
```

## Infraestrutura

```text
✓ acesso remoto validado
✓ HTTPS/WSS quando necessário
✓ configuração de produção
✓ backup definido
```

---

# Depois da v1.0

Funcionalidades que podem ser avaliadas posteriormente:

```text
- cliente web;
- câmera;
- aplicativo mobile;
- múltiplas comunidades;
- bots;
- threads avançadas;
- emojis personalizados;
- busca avançada;
- sistema elaborado de cargos;
- administração avançada;
- notificações desktop avançadas;
- múltiplas transmissões simultâneas;
```

Nenhuma delas é necessária para validar o produto principal.

---

# Ordem prática de implementação

Apesar do roadmap conter várias fases, a execução inicial deve ser ainda mais direta:

```text
01. Tauri + React
02. App Shell
03. Chat mockado
04. API /health
05. LiveKit
06. Token temporário
07. Voice
08. Screen Share
09. Teste entre máquinas
10. Corrigir problemas de mídia

11. Login
12. Cadastro
13. Convites
14. Sessão

15. Banco
16. Mensagens reais
17. WebSocket
18. Presença

19. Integração completa
20. Reconexão
21. Segurança
22. Refinamentos
23. Release Candidate
24. v1.0
```

A regra principal do desenvolvimento é:

> **Não avançar para infraestrutura complexa enquanto o fluxo principal ainda não estiver validado.**

O objetivo inicial é chegar rapidamente ao seguinte:

```text
Usuário A ───────┐
                 ├── comunidade
Usuário B ───────┤
                 │
Usuário C ───────┘

✓ chat
✓ voz
✓ screen share
```

Depois disso, o projeto pode crescer com segurança.
