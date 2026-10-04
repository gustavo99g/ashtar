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
        Auto-update + servidor na VPS + convites + supressão de ruído
        + UI nova + chat real + publicador nativo
        ↓
v0.3  → Conversas privadas
        Mensagens e ligações privadas + não lidas + bandeja
        ↓
v0.4  → Transmissões múltiplas
        Várias transmissões simultâneas + experiência de quem assiste
        ↓
v0.5  → Canais e presença
        Múltiplos canais e salas + status + menções + sons da voz
        ↓
v0.6  → Confiabilidade e configurações
        Reconexão + estados + tela de configurações + atalhos globais
        ↓
v0.7  → Perfil e chat avançado
        Nick e foto + anexos + editar, responder, reagir + busca
        ↓
v0.8  → Atividade, moderação e refinamentos
        "Jogando X" + administração + refinos do screen share
        ↓
v0.9  → Release Candidate
        ↓
v1.0  → Primeira versão estável
```

Depois da v0.2, cada versão tem um tema só. A ordem da v0.3 em diante pode ser trocada se o uso real
mostrar que a falta de algum item incomoda mais que a de outro.

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

### Entregas em partes

A partir da v0.2.0, com o auto-update pronto, toda versão é entregue em partes (`v0.X.Y`): cada parte
chega ao grupo assim que fica pronta, passando antes pelo canal beta. Ninguém espera uma versão inteira
para receber uma melhoria.

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

Transformar o teste em um aplicativo de uso contínuo: atualizações automáticas, servidor próprio,
identidade, chat real e a interface definitiva.

## Entregas

A v0.2 é entregue em partes. Depois da v0.2.0, cada parte chega ao grupo pelo auto-update assim que fica
pronta, passando antes pelo canal beta.

```text
v0.2.0  Base de entrega       auto-update + pipeline + canal beta + versão mínima
v0.2.1  Servidor              VPS (LiveKit, API e banco) + backup + alerta
v0.2.2  Identidade            convites + identidade do dispositivo + permissões
v0.2.3  Áudio                 supressão de ruído e cancelamento de eco
v0.2.4  UI nova
v0.2.5  Chat real
v0.2.6  Publicador nativo
```

As três primeiras têm prioridade alta e seguem esta ordem: a base de entrega faz todo o resto chegar
sozinho; o servidor faz o banco nascer no lugar definitivo, sem migrar dados depois; e a identidade
fecha o acesso, que até ali depende do código compartilhado da v0.1.

---

### v0.2.0 — Base de entrega

A instalação da v0.2.0 é a última reinstalação manual.

* updater do Tauri;
* **pipeline de release no GitHub Actions**: roda os testes, o lint e o typecheck (`cargo test`,
  `cargo clippy`, checagens do desktop), bloqueia o release se algo falhar, e então compila, assina e
  publica a versão (ex.: GitHub Releases), sem passos manuais;
* assinatura dos pacotes de atualização;
* **canal beta**: uma versão nova vai primeiro para você (e quem mais quiser testar) e só depois para
  todos, para que um bug não chegue ao grupo inteiro de uma vez;
* **versão mínima suportada**: a API recusa clientes antigos com uma mensagem pedindo a atualização,
  para que uma mudança de protocolo nunca deixe alguém com o aplicativo quebrado sem explicação;
* **"O que há de novo"**: uma janela curta com as mudanças, mostrada na primeira abertura depois de
  cada atualização.

```text
uma versão nova passa pelo canal beta e depois chega sozinha a todos
 +
um teste falhando bloqueia o release
 +
cliente antigo recusado com pedido de atualização
```

### v0.2.1 — Servidor

Todo o servidor passa para uma VPS própria. A mídia sai do LiveKit Cloud, pré-requisito das transmissões
múltiplas da v0.4, e a API e o banco saem do seu computador, para que o aplicativo não caia quando ele
desligar ou reiniciar.

O desktop só conhece a URL da API. A URL, a chave e o segredo do LiveKit ficam no servidor, e a URL do
LiveKit chega ao desktop pela própria API. Com um domínio fixo para a API, a mudança de servidor não
exige nenhuma atualização do aplicativo.

* LiveKit, API e banco na mesma VPS (ex.: Docker Compose);
* o Cloudflare Tunnel pode continuar na frente da API, rodando na VPS;
* VPS escolhida pelo **tráfego de saída incluso**, não só pela CPU: uma noite de screen share assistido
  por várias pessoas pode gerar dezenas de GB;
* TURN configurado, para quem estiver atrás de redes restritivas;
* segredos de produção configurados uma única vez no servidor, fora do repositório;
* banco escolhido antes da implementação (ADR), com migrações;
* backup automático, copiado para fora da VPS (ex.: Cloudflare R2), para que não se perca junto com ela;
* **alerta de servidor fora do ar**: um monitor externo gratuito chama o `/health` e avisa no celular.

```text
voz e screen share funcionando pela VPS, com o seu computador desligado
 +
restauração do backup testada uma vez
 +
servidor desligado → alerta no celular
```

### v0.2.2 — Identidade, convites e permissões

As telas de convite e de escolha do nick já seguem o estilo do protótipo novo, para não serem refeitas
na v0.2.4.

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
  de nick entra na v0.7, junto com a foto);
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
administração completa entra na v0.8.

Decisões a registrar em ADR antes de implementar: o cálculo exato da identidade do dispositivo e a lista
de valores inválidos, se um usuário pode ter mais de um dispositivo ao mesmo tempo, e a validade dos
convites.

**Segurança mínima**

* **token do LiveKit montado pelo backend**: identidade e nick vêm do banco, nunca do cliente, e o
  token não permite ao participante trocar o próprio nome ou metadados dentro da sala;
* rate limiting no uso de convites;
* validação de entrada;
* testes de integração da API para convites, identidade do dispositivo e permissões, rodando no
  pipeline.

```text
convite → nick → entrar na sala de voz
 +
convite de recuperação → mesmo usuário
 +
formatar o Windows → entra direto, sem convite novo
 +
sem identidade válida → nenhum token do LiveKit
```

### v0.2.3 — Supressão de ruído e cancelamento de eco

Entrega pequena e independente; pode sair em qualquer ponto da v0.2, inclusive junto de outra.

* supressão de ruído, cancelamento de eco e controle automático de ganho do microfone, pelos filtros
  do próprio WebView (opções de captura do `livekit-client`);
* ligados por padrão, com opção de desligar;
* se o filtro do WebView não bastar, avaliar um filtro mais forte (ex.: RNNoise num worklet de áudio).

```text
microfone sem ruído de teclado nem eco de quem usa caixa de som
```

### v0.2.4 — UI nova

Refazer a interface a partir do novo protótipo, antes do chat, para que o chat seja construído uma
única vez em cima da interface definitiva.

### v0.2.5 — Chat real

* enviar, receber e persistir mensagens;
* histórico ordenado e carregamento incremental;
* estado de envio e tratamento de erro;
* WebSocket próprio para eventos do aplicativo (`message.created`, `message.updated`,
  `message.deleted`, `presence.changed`); a mídia continua no LiveKit;
* reconexão do canal de eventos.

```text
enviar mensagem → o outro receber → fechar e reabrir → ver o histórico
```

### v0.2.6 — Publicador nativo

* publicação do vídeo direto do Rust (conexão `{user_id}:screen`), sem passar pelo WebView;
* medição lado a lado com o caminho IPC, usando como linha de base a Etapa 6 do `PLAN.md` e o teste da
  v0.1.

Se o teste da v0.1 mostrar que a qualidade da transmissão é o principal problema, esta entrega passa à
frente da UI nova e do chat.

```text
publicador nativo igual ou melhor que o caminho IPC na medição
(ou decisão documentada de manter o IPC)
```

---

# v0.3 — Conversas privadas

## Objetivo

Mensagens e ligações privadas entre duas pessoas, com o mínimo de notificações e de aplicativo em
segundo plano que elas exigem.

## Mensagens privadas

* conversa entre duas pessoas, tratada como um canal com dois membros, reaproveitando o chat da v0.2;
* primeira permissão por canal do projeto: a API garante que só os dois leiam o histórico, e o
  WebSocket só envia os eventos para eles, com testes de integração no pipeline;
* as mensagens ficam em texto puro no banco, legíveis por quem administra o servidor. Isso é comunicado
  ao grupo; criptografia ponta a ponta fica fora do escopo.

## Não lidas e notificações

O mínimo para uma mensagem privada não passar despercebida, valendo também para o canal da v0.2:

* indicador de mensagens não lidas;
* notificação de mensagem nova.

## Aplicativo em segundo plano

* ícone na bandeja: fechar a janela não sai da sala de voz e continua recebendo mensagens e ligações;
* iniciar com o Windows (opcional).

## Ligações privadas

* uma sala do LiveKit por conversa privada, com token só para os dois;
* screen share na ligação, igual ao da sala de voz;
* tocar, aceitar, recusar, tempo limite e chamada perdida;
* toca com a janela fechada, pelo aplicativo na bandeja; a notificação tem os botões Aceitar e
  Recusar (verificar se o plugin de notificação do Tauri dá suporte a botões no Windows; se não der,
  uma janela própria pequena e sempre no topo);
* quem liga nunca vê "ocupado": a ligação toca normalmente, mesmo que a outra pessoa esteja numa sala;
* **histórico de chamadas na conversa**: "ligação de 42 min", "chamada perdida", com um botão para ligar
  de volta.

**Ligação recebida estando numa sala**, como no Discord:

```text
toque + notificação com nome e foto de quem liga, com Aceitar e Recusar
 ↓
a conversa privada aparece no topo da lista, já aberta no canto
 ↓
Aceitar      → sai da sala → entra na ligação
Recusar      → continua na sala; quem ligou vê "recusada"
sem resposta → chamada perdida registrada na conversa
```

* a pessoa fica conectada a uma única sala de voz por vez, nunca à sala e à ligação ao mesmo tempo;
* se ela estiver transmitindo a tela na sala, o botão Aceitar avisa que a transmissão será encerrada;
* o toque é mais baixo enquanto a pessoa está numa sala, para não atrapalhar a conversa;
* ao desligar, a pessoa não volta sozinha para a sala: a tela da ligação encerrada oferece um botão
  "voltar para a sala";
* a partir da v0.5, com o status "não perturbe", a ligação mostra só a notificação visual, sem som.

## Critérios de conclusão

```text
mensagem privada → só os dois leem
 +
janela fechada → notificação de mensagem nova pela bandeja
 +
ligação privada com a janela fechada → tocar, aceitar, recusar e chamada perdida
 +
screen share dentro da ligação privada
 +
ligação recebida estando numa sala → aceitar → sair da sala e entrar na ligação
```

---

# v0.4 — Transmissões múltiplas

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

# v0.5 — Canais e presença

## Objetivo

Sair da sala e do canal únicos e mostrar quem está fazendo o quê.

## Canais

* múltiplos canais de texto, com histórico por canal;
* múltiplas salas de voz;
* conexão de voz independente do canal de texto selecionado.

```text
Canal de texto:          # development
Canal de voz conectado:  🔊 General
```

## Presença

* status online, ausente, não perturbe e invisível, com ausente automático por inatividade;
* "não perturbe" silencia as notificações; ligações privadas aparecem só como notificação visual, sem
  som;
* quem está em cada sala de voz;
* indicador "digitando...";
* menções (`@nick`), que notificam mesmo em canal silenciado;
* silenciar canal;
* notificação "fulano começou a transmitir", para quem não está na sala.

## Voz

* sons de entrada e saída de pessoas na sala;
* speaking indicator;
* volume por usuário.

## Critérios de conclusão

```text
trocar de canal de texto
 ↓
entrar em voz e continuar navegando pelo chat
 ↓
trocar de sala de voz
 ↓
ser mencionado num canal silenciado → receber a notificação
 ↓
ficar inativo → status muda para ausente
```

---

# v0.6 — Confiabilidade e configurações

## Objetivo

Deixar o aplicativo confiável e ajustável para uso todos os dias.

## Configurações

* tela de configurações única: dispositivos, atalhos, notificações e áudio (supressão de ruído da
  v0.2), para que as opções novas das próximas versões tenham um lugar fixo;
* seleção de microfone e saída;
* teste de microfone.

## Atalhos globais

* mute e push-to-talk, funcionando com um jogo em foco;
* configuráveis na tela de configurações.

## Confiabilidade

* tratamento consistente de erros e timeouts na API;
* API indisponível: tentativa de reconexão e feedback visual;
* reconexão e recuperação do LiveKit (voz e screen share);
* sessão inválida: volta para a tela de convite;
* dispositivos: microfone desconectado, saída indisponível, troca de dispositivo;
* **indicador de qualidade da conexão** por participante (ping e perda de pacotes), para saber se um
  picote vem da rede de quem transmite ou de quem assiste;
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
usar o push-to-talk com um jogo em foco
 +
trocar o microfone pela tela de configurações, sem sair da voz
 +
desconectar o microfone → aviso e recuperação ao reconectar
 +
queda de rede curta → recuperação sem estado inconsistente
```

---

# v0.7 — Perfil e chat avançado

## Objetivo

Perfil personalizável e um chat completo para o dia a dia.

## Perfil e armazenamento de arquivos

* troca de nick e foto de perfil, na mesma tela (dentro da tela de configurações da v0.6);
* a troca chega a todos em tempo real (evento `user.updated`) e aparece também na sala de voz;
* armazenamento de arquivos (disco da API ou um storage como o Cloudflare R2), montado uma vez para a
  foto e para os anexos do chat;
* redimensionamento das imagens;
* arquivos incluídos no backup.

## Chat

* editar, excluir e copiar mensagem;
* responder;
* reações;
* anexos básicos, incluindo colar imagem com Ctrl+V;
* preview de links;
* markdown básico: negrito, itálico, código e spoiler;
* mensagens fixadas;
* busca simples de mensagens (busca de texto do próprio banco).

## Critérios de conclusão

```text
trocar nick e foto → todos veem na hora, no chat e na voz
 +
colar um print com Ctrl+V → o outro vê a imagem
 +
editar, responder e reagir a mensagens
 +
encontrar uma mensagem antiga pela busca
```

---

# v0.8 — Atividade, moderação e refinamentos

## Objetivo

Fechar os recursos antes do Release Candidate. A lista é um ponto de partida reordenado pelo feedback
do grupo, e entra só o que mantiver a base simples.

## Atividade

* **"Jogando X"**: o aplicativo detecta o jogo aberto e mostra ao lado do nick, reaproveitando a
  listagem de processos e janelas do screen share;
* lista de jogos reconhecidos mantida pelo próprio projeto, com opção de esconder a atividade.

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

## Critério

O grupo usa o aplicativo no lugar de outras ferramentas sem pedir nada essencial que falte.

---

# v0.9 — Release Candidate

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
M10 — Supressão de ruído e cancelamento de eco
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
A15 — Menção em canal silenciado
A16 — Ligação recebida estando numa sala
A17 — Versão no canal beta antes de todos
```

## Infraestrutura

* configuração de produção revisada;
* restauração do backup testada (banco e arquivos), a partir da cópia fora da VPS;
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
✓ status e "Jogando X"
```

## Chat

```text
✓ canais de texto
✓ histórico
✓ tempo real
✓ não lidas
✓ edição e exclusão
✓ menções
✓ anexos e colar imagem
✓ mensagens privadas
```

## Voz

```text
✓ salas de voz
✓ mute e deafen
✓ supressão de ruído e cancelamento de eco
✓ atalhos globais e push-to-talk
✓ participantes
✓ ligações privadas, com histórico de chamadas
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
✓ "O que há de novo"
✓ bandeja
✓ tela de configurações
✓ estados de erro e carregamento
✓ reconexão
```

## Infraestrutura

```text
✓ LiveKit, API e banco em VPS própria
✓ HTTPS/WSS
✓ configuração de produção
✓ backup fora da VPS, com restauração testada
✓ alerta de servidor fora do ar
✓ pipeline de release com canal beta
```

---

# Infraestrutura ao longo das versões

```text
v0.1  API pelo Cloudflare Tunnel
      mídia pelo LiveKit Cloud (plano gratuito), consumo acompanhado
        ↓
v0.2  LiveKit, API e banco em VPS própria
      backup fora da VPS + alerta de servidor fora do ar
      (antecipado se a cota apertar durante o teste)
        ↓
v0.4  VPS dimensionada para várias transmissões
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
- soundboard;
- clipes (salvar os últimos segundos de uma transmissão);
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
08. v0.2.0 Auto-update + pipeline com testes + canal beta + versão mínima + "O que há de novo"
09. v0.2.1 VPS (LiveKit, API e banco) + backup externo + alerta
10. v0.2.2 Convites + identidade do dispositivo + permissões + segurança mínima
11. v0.2.3 Supressão de ruído e cancelamento de eco
12. v0.2.4 UI nova
13. v0.2.5 Chat real + WebSocket
14. v0.2.6 Publicador nativo + medição

v0.3
15. Mensagens privadas
16. Não lidas + notificações + bandeja
17. Ligações privadas + histórico de chamadas

v0.4
18. Transmissões múltiplas + assinatura seletiva
19. Experiência de quem assiste

v0.5
20. Canais e salas
21. Status + digitando + menções + silenciar canal
22. Sons, speaking indicator e volume por usuário

v0.6
23. Tela de configurações + atalhos globais
24. Confiabilidade + qualidade da conexão + enviar logs

v0.7
25. Perfil + armazenamento de arquivos
26. Chat avançado + busca

v0.8
27. "Jogando X"
28. Refinos do screen share
29. Moderação

v0.9
30. Release Candidate

v1.0
```

A regra principal do desenvolvimento é:

> **O uso real decide a próxima prioridade.**
