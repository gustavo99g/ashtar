# Roadmap

Roadmap funcional do projeto até a primeira versão estável.

O uso principal do aplicativo é o **compartilhamento de tela** entre um grupo de aproximadamente 5–10
pessoas. O foco é colocar o aplicativo nas mãos desse grupo o mais cedo possível e deixar o uso real
decidir as prioridades, sem tentar reproduzir todos os recursos do Discord.

---

# Visão geral

```text
v0.1  → Teste com o grupo
        Voz + Screen Share reorganizado, liberado como teste
        ↓
v0.2  → Comunidade
        Auto-update + UI nova + convites + chat real + publicador nativo
        ↓
v0.3  → Uso diário
        Canais + presença + confiabilidade
        ↓
v0.4  → Refinamentos guiados pelo uso
        Administração + chat e voz avançados
        ↓
v0.5  → Release Candidate
        ↓
v1.0  → Primeira versão estável
```

## Princípios do roadmap

### Uso real cedo

O grupo passa a usar o aplicativo ao fim da v0.1, ainda como teste. O que acontecer no uso real
(qualidade da transmissão, quedas de rede, consumo do LiveKit, problemas de instalação) decide a
ordem do que vem depois.

### Prioridade por risco

A mídia é a parte tecnicamente mais incerta e o motivo do aplicativo existir, por isso vem primeiro.

```text
Voz + Screen Share
 ↓
Comunidade (identidade + chat)
 ↓
Recursos secundários
```

### Cada item em uma versão só

As versões são organizadas por entrega, não por tema. Um item aparece em uma única versão; quando ele
precisa de refinamento depois, o refinamento é um item novo e com nome próprio.

### Evitar complexidade prematura

Não implementar uma funcionalidade apenas porque aplicações semelhantes possuem.

Cada etapa deve aproximar o projeto de uma aplicação realmente utilizável pelo grupo.

### Um produto, dois projetos

O monorepo possui dois projetos:

```text
desktop/
api/
```

O `desktop` é a aplicação Tauri.

O `api` é o backend Rust/Axum.

---

# v0.1 — Teste com o grupo

## Objetivo

Terminar a reorganização do compartilhamento de tela e liberar o aplicativo para o grupo como teste,
para ver o comportamento real o mais rápido possível.

Esta versão é descartável do ponto de vista do usuário: não há contas nem histórico a preservar, e a
atualização para a v0.2 será uma reinstalação manual.

## Desktop

### Base

* Tauri + React + TypeScript + Vite;
* App Shell e navegação visual;
* chat mockado do protótipo, sem trabalho novo.

### Voz

* integração com LiveKit;
* entrada em uma sala fixa;
* exibição de participantes;
* microfone, mute e deafen;
* saída da sala;
* reconexão básica.

### Screen Share

* reorganização do compartilhamento de tela (Etapas 3 a 6 do [`PLAN.md`](../PLAN.md));
* iniciar, parar e receber transmissão;
* exibir participante que está compartilhando;
* áudio da fonte escolhida, quando disponível;
* limite de uma transmissão simultânea.

## Liberação para teste

O mínimo para o aplicativo funcionar fora da rede local sem quebrar:

* build do Windows (instalador sem assinatura de código; o SmartScreen vai pedir confirmação);
* URL da API configurável por ambiente;
* nome escolhido na primeira abertura e id único gerado por instalação, para que duas pessoas nunca
  usem a mesma identidade no LiveKit;
* código de acesso compartilhado, conferido pela API antes de emitir o token do LiveKit, para que
  quem descobrir a URL do túnel não consuma a cota;
* logs em arquivo, para investigar problemas na máquina de cada um.

## API

* `/health`;
* geração de token do LiveKit, protegida pelo código de acesso;
* chaves do LiveKit somente no backend;
* exposta pelo Cloudflare Tunnel.

## Infraestrutura

API pelo **Cloudflare Tunnel** e mídia pelo **LiveKit Cloud** (plano gratuito). Ver
[README.md](../README.md).

O consumo do LiveKit Cloud é acompanhado desde o primeiro dia: o uso principal (screen share
assistido por várias pessoas) é justamente o que mais consome a cota.

## Fora do escopo

* auto-update;
* contas, convites e sessão;
* banco de dados;
* chat real;
* publicador nativo;
* câmera;
* múltiplas salas.

## Critérios de conclusão

```text
Etapa 6 do PLAN.md
 +
M01 — Dois participantes
M02 — Microfone
M03 — Screen Share
M04 — Screen Share + áudio
M05 — Terceiro participante
M06 — Reentrada
M07 — Reconexão
 +
uma noite de uso real com o grupo, pela internet
```

## O que observar durante o teste

* qualidade percebida da transmissão (fps, picotes, atraso);
* falhas de conexão e reconexão;
* consumo da cota do LiveKit Cloud;
* problemas de instalação.

Essas observações decidem a prioridade do publicador nativo na v0.2 e o momento da migração do LiveKit
para uma VPS.

---

# v0.2 — Comunidade

## Objetivo

Transformar o teste em um aplicativo de uso contínuo: atualizações automáticas, identidade, chat real
e a interface definitiva.

## Ordem de implementação

### 1. Auto-update

Primeiro item da versão, para que todo o resto chegue sozinho ao grupo. A instalação da v0.2 é a última
reinstalação manual.

* updater do Tauri;
* publicação das versões (ex.: GitHub Releases);
* assinatura dos pacotes de atualização.

### 2. UI nova

Refazer a interface a partir do novo protótipo, antes do chat, para que o chat seja construído uma
única vez em cima da interface definitiva.

### 3. Banco de dados

Escolhido antes da implementação (ADR). Inclui:

* migrações;
* backup.

### 4. Identidade e convites

Sem senha. O convite é a única forma de entrar, e a identidade vem do próprio computador, para que
formatar o Windows não exija nada.

```text
convite
 ↓
escolha do nick
 ↓
desktop calcula a identidade do dispositivo
 ↓
API cria o usuário e vincula o dispositivo a ele
 ↓
aberturas seguintes entram direto, inclusive depois de formatar
```

**Identidade do dispositivo**

* calculada a partir do hardware: hash do UUID da BIOS e do serial da placa-mãe, junto com uma
  constante do aplicativo. O serial real nunca sai do computador;
* sobrevive a reinstalações do Windows; muda só com a troca da placa-mãe;
* no banco fica só o hash do valor recebido;
* **valores inválidos são rejeitados**: placas baratas e máquinas virtuais costumam ter UUID ou serial
  genérico (`FFFFFFFF-FFFF-...`, `00000000-...`, "To be filled by O.E.M."), o que faria duas pessoas
  terem a mesma identidade. Nesses casos o desktop usa um token aleatório gerado pela API e guardado no
  cofre de credenciais do Windows, que se perde ao formatar.

A identidade do dispositivo é um identificador fixo, não um segredo que possa ser trocado. Para um grupo
pequeno, com a URL da API privada, o risco é aceito; se ela vazar, o administrador desvincula o
dispositivo e envia um convite de recuperação.

**Usuários e convites**

* o usuário tem um id interno estável; o nick é só o nome de exibição e pode mudar;
* convite de uso único, com expiração e revogação;
* **convite de recuperação**: para troca de placa-mãe, troca de computador ou perda do token aleatório,
  o administrador gera um convite vinculado ao usuário existente. Ao usar o convite, o dispositivo novo
  é vinculado ao mesmo usuário, com o mesmo histórico, e o vínculo antigo é removido;
* o administrador pode desvincular um dispositivo;
* o primeiro administrador é criado por configuração ou comando da API;
* substitui o código de acesso da v0.1: token do LiveKit só para usuários autenticados.

Decisões a registrar em ADR antes de implementar: o cálculo exato da identidade do dispositivo e a lista
de valores inválidos, se um usuário pode ter mais de um dispositivo ao mesmo tempo, e a validade dos
convites.

### 5. Chat real

* enviar, receber e persistir mensagens;
* histórico ordenado e carregamento incremental;
* estado de envio e tratamento de erro;
* WebSocket próprio para eventos do aplicativo (`message.created`, `message.updated`,
  `message.deleted`, `presence.changed`); a mídia continua no LiveKit;
* reconexão do canal de eventos.

### 6. Publicador nativo

* publicação do vídeo direto do Rust (conexão `{user_id}:screen`), sem passar pelo WebView;
* medição lado a lado com o caminho IPC, usando como linha de base a Etapa 6 do `PLAN.md` e o teste da
  v0.1.

Se o teste da v0.1 mostrar que a qualidade da transmissão é o principal problema, este item passa à
frente do chat.

## Segurança mínima

A API já está exposta na internet desde a v0.1, então entram nesta versão:

* rate limiting no uso de convites;
* validação de entrada;
* segredos somente no backend.

## Critérios de conclusão

```text
uma versão nova publicada chega sozinha a todos
 +
convite → nick → entrar → enviar mensagem → o outro receber → reabrir → ver o histórico
 +
convite de recuperação → mesmo usuário, mesmo histórico
 +
formatar o Windows → entra direto, sem convite novo
 +
publicador nativo igual ou melhor que o caminho IPC na medição
(ou decisão documentada de manter o IPC)
```

---

# v0.3 — Uso diário

## Objetivo

Deixar o aplicativo confiável para uso todos os dias.

## Canais

* múltiplos canais de texto, com histórico por canal;
* múltiplas salas de voz;
* conexão de voz independente do canal de texto selecionado.

```text
Canal de texto:          # development
Canal de voz conectado:  🔊 General
```

## Presença e notificações

* online e offline;
* quem está em cada sala de voz;
* indicador de mensagens não lidas;
* notificação de mensagem nova.

## Confiabilidade

* tratamento consistente de erros e timeouts na API;
* API indisponível: tentativa de reconexão e feedback visual;
* reconexão e recuperação do LiveKit (voz e screen share);
* sessão inválida: volta para a tela de convite;
* dispositivos: microfone desconectado, saída indisponível, troca de dispositivo.

Estados de interface:

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

```text
login automático
 ↓
abrir chat e trocar de canal
 ↓
entrar em voz e continuar navegando pelo chat
 ↓
compartilhar tela
 ↓
queda de rede curta → recuperação sem estado inconsistente
 ↓
sair da voz
```

---

# v0.4 — Refinamentos guiados pelo uso

## Objetivo

Adicionar o que o grupo sentir falta. A lista abaixo é um ponto de partida e é reordenada pelo
feedback; entra só o que mantiver a base simples.

## Administração

* papéis `usuário` e `administrador`;
* expulsar usuário e desvincular seus dispositivos;
* listar e revogar convites.

## Chat

* editar, excluir e copiar mensagem;
* responder;
* reações;
* links e anexos básicos.

## Voz

* seleção de microfone e saída;
* teste de microfone;
* push-to-talk;
* volume por usuário;
* speaking indicator.

## Screen Share

* miniaturas e preview no seletor de fontes;
* aviso de conteúdo protegido (frames pretos por vários segundos);
* presets de qualidade expostos na interface.

## Critério

O grupo usa o aplicativo no lugar de outras ferramentas sem pedir nada essencial que falte.

---

# v0.5 — Release Candidate

## Objetivo

Parar de adicionar funcionalidades e estabilizar.

## Estabilidade

* corrigir bugs;
* eliminar estados inconsistentes;
* revisar mensagens de erro, carregamentos e reconexão.

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
A01 — Convite válido
A02 — Convite inválido
A03 — Convite expirado
A04 — Convite de recuperação
A05 — Dispositivo desvinculado
A06 — Reinstalação do Windows
A07 — Hardware com UUID inválido
A08 — API indisponível
A09 — LiveKit indisponível
A10 — Navegação texto + voz
A11 — Atualização automática
```

## Infraestrutura

* configuração de produção revisada;
* restauração do backup testada;
* decisão final sobre LiveKit Cloud ou VPS.

---

# v1.0 — Primeira versão estável

## Objetivo

O grupo usa o aplicativo como ferramenta principal por algumas semanas seguidas sem precisar voltar a
outra.

## Identidade

```text
✓ entrada por convite, sem senha
✓ convite de recuperação
✓ perfil básico (nick)
```

## Chat

```text
✓ canais de texto
✓ histórico
✓ tempo real
✓ não lidas
✓ edição e exclusão
```

## Voz

```text
✓ salas de voz
✓ mute e deafen
✓ participantes
✓ reconexão
```

## Screen Share

```text
✓ compartilhar e receber tela
✓ áudio quando disponível
✓ publicador nativo (ou IPC, se a medição decidir)
✓ limite de transmissão
```

## Comunidade

```text
✓ uma comunidade
✓ acesso privado
✓ presença
✓ administrador
```

## Cliente

```text
✓ aplicação desktop Tauri
✓ auto-update
✓ estados de erro e carregamento
✓ reconexão
```

## Infraestrutura

```text
✓ acesso remoto validado
✓ HTTPS/WSS
✓ configuração de produção
✓ backup com restauração testada
```

---

# Infraestrutura ao longo das versões

```text
v0.1+  API pelo Cloudflare Tunnel
       mídia pelo LiveKit Cloud (plano gratuito)
         ↓
       consumo acompanhado desde o primeiro uso
         ↓
       LiveKit em VPS própria quando a cota apertar
```

A migração para a VPS não pertence a uma versão: acontece quando o consumo justificar. Para o código, a
troca é só de configuração (URL, chave e segredo do LiveKit no `.env`).

---

# Depois da v1.0

Funcionalidades que podem ser avaliadas posteriormente:

```text
- cliente web;
- suporte a Linux;
- câmera;
- aplicativo mobile;
- múltiplas comunidades;
- bots;
- threads;
- emojis personalizados;
- busca avançada;
- sistema elaborado de cargos;
- múltiplas transmissões simultâneas;
```

Nenhuma delas é necessária para o uso principal do grupo.

---

# Ordem prática de implementação

```text
v0.1
01. Etapas 4 a 6 do PLAN.md
02. Build do Windows + URL configurável
03. Nome + id por instalação
04. Código de acesso na API
05. Logs em arquivo
06. Cloudflare Tunnel + LiveKit Cloud
07. Noite de teste com o grupo

v0.2
08. Auto-update
09. UI nova
10. Banco
11. Convites + identidade do dispositivo
12. Convite de recuperação
13. Chat real + WebSocket
14. Publicador nativo + medição

v0.3
15. Canais + presença + não lidas
16. Confiabilidade

v0.4
17. Refinamentos priorizados pelo grupo

v0.5
18. Release Candidate

v1.0
```

A regra principal do desenvolvimento é:

> **O uso real decide a próxima prioridade.**
