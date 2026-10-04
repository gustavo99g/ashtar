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
        Auto-update + UI nova + convites + chat real + LiveKit na VPS + publicador nativo
        ↓
v0.3  → Transmissões múltiplas
        Várias transmissões simultâneas + experiência de quem assiste
        ↓
v0.4  → Uso diário
        Canais + presença + notificações + confiabilidade + bandeja + atalhos
        ↓
v0.5  → Social e refinamentos
        Perfil + mensagens e ligações privadas + chat avançado + moderação
        ↓
v0.6  → Release Candidate
        ↓
v1.0  → Primeira versão estável
```

As versões alternam entre mídia (v0.1, v0.3) e produto (v0.2, v0.4, v0.5). Se o uso real mostrar que a
falta de algum item da v0.4 incomoda mais que a falta de várias transmissões, a v0.3 e a v0.4 trocam de
lugar.

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
* LiveKit em VPS;
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
* tráfego gerado por uma noite de uso, para dimensionar a VPS da v0.2;
* problemas de instalação.

Essas observações decidem a prioridade do publicador nativo dentro da v0.2 e se a migração para a VPS
precisa ser antecipada.

---

# v0.2 — Comunidade

## Objetivo

Transformar o teste em um aplicativo de uso contínuo: atualizações automáticas, identidade, chat real,
a interface definitiva e a mídia em infraestrutura própria.

## Ordem de implementação

### 1. Auto-update e versão mínima

Primeiro item da versão, para que todo o resto chegue sozinho ao grupo. A instalação da v0.2 é a última
reinstalação manual.

* updater do Tauri;
* publicação das versões (ex.: GitHub Releases);
* assinatura dos pacotes de atualização;
* **versão mínima suportada**: a API recusa clientes antigos com uma mensagem pedindo a atualização,
  para que uma mudança de protocolo nunca deixe alguém com o aplicativo quebrado sem explicação.

### 2. UI nova

Refazer a interface a partir do novo protótipo, antes do chat, para que o chat seja construído uma
única vez em cima da interface definitiva.

### 3. Banco de dados

Escolhido antes da implementação (ADR). Inclui:

* migrações;
* backup.

### 4. Identidade, convites e permissões mínimas

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

* o usuário tem um id interno estável; o nick é escolhido ao entrar e é só o nome de exibição (a troca
  de nick entra na v0.5, junto com a foto);
* convite de uso único, com expiração e revogação;
* **convite de recuperação**: para troca de placa-mãe, troca de computador ou perda do token aleatório,
  o administrador gera um convite vinculado ao usuário existente. Ao usar o convite, o dispositivo novo
  é vinculado ao mesmo usuário, com o mesmo histórico, e o vínculo antigo é removido;
* o primeiro administrador é criado por configuração ou comando da API;
* substitui o código de acesso da v0.1: token do LiveKit só para usuários autenticados.

**Permissões mínimas**

Dois papéis: `membro` e `administrador`.

| Ação | Membro | Administrador |
|---|---|---|
| Convidar gente nova | sim | sim |
| Gerar convite de recuperação | não | sim |
| Desvincular dispositivo | não | sim |

As ações de administrador ficam disponíveis por comando da API ou por uma tela simples; a tela de
administração completa entra na v0.5.

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

### 6. LiveKit na VPS

A mídia sai do LiveKit Cloud e passa para um servidor LiveKit próprio, pré-requisito das transmissões
múltiplas da v0.3. Pode ser antecipado se a cota do plano gratuito apertar durante o teste da v0.1.

* VPS escolhida pelo **tráfego de saída incluso**, não só pela CPU: uma noite de screen share assistido
  por várias pessoas pode gerar dezenas de GB;
* TURN configurado, para quem estiver atrás de redes restritivas;
* para o código, a troca é só de configuração (URL, chave e segredo do LiveKit no `.env`).

### 7. Publicador nativo

* publicação do vídeo direto do Rust (conexão `{user_id}:screen`), sem passar pelo WebView;
* medição lado a lado com o caminho IPC, usando como linha de base a Etapa 6 do `PLAN.md` e o teste da
  v0.1.

Se o teste da v0.1 mostrar que a qualidade da transmissão é o principal problema, este item passa à
frente do chat.

## Segurança mínima

A API já está exposta na internet desde a v0.1, então entram nesta versão:

* **token do LiveKit montado pelo backend**: identidade e nick vêm do banco, nunca do cliente, e o
  token não permite ao participante trocar o próprio nome ou metadados dentro da sala;
* rate limiting no uso de convites;
* validação de entrada;
* segredos somente no backend.

## Critérios de conclusão

```text
uma versão nova publicada chega sozinha a todos
 +
cliente antigo recusado com pedido de atualização
 +
convite → nick → entrar → enviar mensagem → o outro receber → reabrir → ver o histórico
 +
convite de recuperação → mesmo usuário, mesmo histórico
 +
formatar o Windows → entra direto, sem convite novo
 +
voz e screen share funcionando pela VPS
 +
publicador nativo igual ou melhor que o caminho IPC na medição
(ou decisão documentada de manter o IPC)
```

---

# v0.3 — Transmissões múltiplas

## Objetivo

Permitir que mais de uma pessoa compartilhe a tela ao mesmo tempo, com uma boa experiência para quem
assiste. Depende do publicador nativo e do LiveKit na VPS, ambos da v0.2.

## Transmissões

* várias transmissões simultâneas na mesma sala, com limite configurável;
* **assinatura seletiva**: quem assiste só recebe a transmissão que abriu, nunca todas
  automaticamente. Sem isso, o tráfego da VPS cresce com cada transmissão de cada participante;
* indicador "ao vivo" ao lado de quem está transmitindo, na lista da sala.

## Experiência de quem assiste

* escolher qual transmissão assistir e trocar entre elas;
* tela cheia;
* janela destacada (pop-out);
* volume do áudio da transmissão separado do volume da voz da pessoa;
* indicador de quem está assistindo cada transmissão.

## Critérios de conclusão

```text
duas transmissões simultâneas
 +
quatro pessoas assistindo, trocando entre elas
 +
uma noite inteira sem picotes
 +
tráfego e CPU da VPS medidos e dentro do plano contratado
```

---

# v0.4 — Uso diário

## Objetivo

Deixar o aplicativo confiável e confortável para uso todos os dias.

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
* notificação de mensagem nova;
* notificação "fulano começou a transmitir", para quem não está na sala.

## Aplicativo de fundo

* ícone na bandeja: fechar a janela não sai da sala de voz;
* iniciar com o Windows (opcional);
* atalhos globais de mute e push-to-talk, que funcionam com um jogo em foco.

## Confiabilidade

* tratamento consistente de erros e timeouts na API;
* API indisponível: tentativa de reconexão e feedback visual;
* reconexão e recuperação do LiveKit (voz e screen share);
* sessão inválida: volta para a tela de convite;
* dispositivos: microfone desconectado, saída indisponível, troca de dispositivo;
* botão "enviar logs", que manda os logs recentes para a API, sem precisar procurar a pasta.

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
abrir o aplicativo e entrar automaticamente
 ↓
trocar de canal de texto
 ↓
entrar em voz e continuar navegando pelo chat
 ↓
fechar a janela e continuar na voz pela bandeja
 ↓
usar o push-to-talk com um jogo em foco
 ↓
queda de rede curta → recuperação sem estado inconsistente
 ↓
sair da voz
```

---

# v0.5 — Social e refinamentos

## Objetivo

Completar a experiência social e adicionar o que o grupo sentir falta. Perfil e mensagens privadas são
compromissos desta versão; o restante é um ponto de partida reordenado pelo feedback, e entra só o que
mantiver a base simples.

## Perfil e armazenamento de arquivos

* troca de nick e foto de perfil, na mesma tela;
* a troca chega a todos em tempo real (evento `user.updated`) e aparece também na sala de voz;
* armazenamento de arquivos (disco da API ou um storage como o Cloudflare R2), montado uma vez para a
  foto e para os anexos do chat;
* redimensionamento das imagens;
* arquivos incluídos no backup.

## Mensagens privadas

* conversa entre duas pessoas, tratada como um canal com dois membros, reaproveitando o chat;
* primeira permissão por canal do projeto: a API garante que só os dois leiam o histórico, e o
  WebSocket só envia os eventos para eles;
* não lidas e notificações iguais às dos canais;
* as mensagens ficam em texto puro no banco, legíveis por quem administra o servidor. Isso é comunicado
  ao grupo; criptografia ponta a ponta fica fora do escopo.

## Ligações privadas

Item de menor prioridade da versão: um canal de voz vazio já cobre boa parte do uso.

* uma sala do LiveKit por conversa privada, com token só para os dois;
* screen share na ligação, igual ao dos canais;
* tocar, aceitar, recusar, tempo limite e chamada perdida;
* comportamento quando a pessoa já está em um canal de voz (decidir em ADR: sair do canal ou recusar
  como ocupado);
* toca com a janela fechada, pelo aplicativo na bandeja da v0.4.

## Chat

* editar, excluir e copiar mensagem;
* responder;
* reações;
* links e anexos básicos.

## Voz

* seleção de microfone e saída;
* teste de microfone;
* volume por usuário;
* speaking indicator.

## Screen Share

* miniaturas e preview no seletor de fontes;
* aviso de conteúdo protegido (frames pretos por vários segundos);
* presets de qualidade expostos na interface.

## Moderação

* tela de administração no aplicativo;
* listar e revogar convites;
* expulsar usuário e desvincular seus dispositivos;
* na voz: mutar alguém, tirar da sala e encerrar uma transmissão (operações da API de servidor do
  LiveKit).

## Critérios de conclusão

```text
trocar nick e foto → todos veem na hora, no chat e na voz
 +
mensagem privada → só os dois leem
 +
ligação privada → tocar, aceitar, recusar e chamada perdida
 +
o grupo usa o aplicativo no lugar de outras ferramentas sem pedir nada essencial que falte
```

---

# v0.6 — Release Candidate

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
M08 — Duas transmissões simultâneas
M09 — Ligação privada
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
A12 — Cliente abaixo da versão mínima
A13 — Mensagem privada
A14 — Troca de nick e foto
```

## Infraestrutura

* configuração de produção revisada;
* restauração do backup testada (banco e arquivos);
* tráfego e custo da VPS revisados com o uso real.

---

# v1.0 — Primeira versão estável

## Objetivo

O grupo usa o aplicativo como ferramenta principal por algumas semanas seguidas sem precisar voltar a
outra.

## Identidade

```text
✓ entrada por convite, sem senha
✓ convite de recuperação
✓ perfil com nick e foto
```

## Chat

```text
✓ canais de texto
✓ histórico
✓ tempo real
✓ não lidas
✓ edição e exclusão
✓ mensagens privadas
```

## Voz

```text
✓ salas de voz
✓ mute e deafen
✓ atalhos globais e push-to-talk
✓ participantes
✓ ligações privadas
✓ reconexão
```

## Screen Share

```text
✓ compartilhar e receber tela
✓ áudio quando disponível
✓ várias transmissões simultâneas
✓ publicador nativo (ou IPC, se a medição decidir)
```

## Comunidade

```text
✓ uma comunidade
✓ acesso privado
✓ presença
✓ membro e administrador
✓ moderação
```

## Cliente

```text
✓ aplicação desktop Tauri
✓ auto-update e versão mínima
✓ bandeja
✓ estados de erro e carregamento
✓ reconexão
```

## Infraestrutura

```text
✓ API pelo Cloudflare Tunnel
✓ LiveKit em VPS própria
✓ HTTPS/WSS
✓ configuração de produção
✓ backup com restauração testada
```

---

# Infraestrutura ao longo das versões

```text
v0.1  API pelo Cloudflare Tunnel
      mídia pelo LiveKit Cloud (plano gratuito), consumo acompanhado
        ↓
v0.2  LiveKit em VPS própria
      (antecipado se a cota apertar durante o teste)
        ↓
v0.3  VPS dimensionada para várias transmissões
```

---

# Depois da v1.0

Funcionalidades que podem ser avaliadas posteriormente:

```text
- cliente web;
- suporte a Linux;
- câmera;
- aplicativo mobile;
- múltiplas comunidades;
- grupos privados (mensagens privadas com mais de duas pessoas);
- criptografia ponta a ponta das mensagens privadas;
- bots;
- threads;
- emojis personalizados;
- busca avançada;
- sistema elaborado de cargos e permissões por canal;
- assinatura de código do instalador (elimina o aviso do SmartScreen);
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
08. Auto-update + versão mínima
09. UI nova
10. Banco
11. Convites + identidade do dispositivo + permissões mínimas
12. Convite de recuperação
13. Chat real + WebSocket
14. LiveKit na VPS
15. Publicador nativo + medição

v0.3
16. Transmissões múltiplas + assinatura seletiva
17. Experiência de quem assiste

v0.4
18. Canais + presença + não lidas + notificações
19. Bandeja + atalhos globais
20. Confiabilidade + enviar logs

v0.5
21. Perfil + armazenamento de arquivos
22. Mensagens privadas
23. Chat, voz e screen share avançados + moderação
24. Ligações privadas

v0.6
25. Release Candidate

v1.0
```

A regra principal do desenvolvimento é:

> **O uso real decide a próxima prioridade.**
