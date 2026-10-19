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
        Auto-update + convites + UI nova + chat real e supressão de ruído
        + servidor na VPS + publicador nativo
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

### Correções fora de ordem

Correções de bug e de segurança não esperam a vez na ordem das entregas: saem assim que ficam prontas,
pelo auto-update, passando pelo canal beta. A ordem das entregas vale para funcionalidades.

### Numeração das versões

O último número da versão do app junta a entrega e a correção: **entrega × 10 + correção**. A entrega
v0.2.N sai como versão `0.2.N0`, e cada correção dela soma 1 no último dígito.

```text
0.2.0            entrega v0.2.0 (base de entrega)
0.2.1, 0.2.2…    correções da v0.2.0
0.2.10           entrega v0.2.1 (identidade)
0.2.11…          correções da v0.2.1
0.2.40           entrega v0.2.4 (servidor)
0.3.0            próxima versão do roadmap
```

O formato segue o semver, que o Tauri e o updater exigem (sem zero à esquerda: `0.2.01` não é válido). O
limite é de 9 correções por entrega. Os nomes do roadmap (v0.2.1, v0.2.2…) continuam sendo os das
entregas; o `CHANGELOG.md` diz o que entrou em cada versão.

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

* reorganização do compartilhamento de tela (Etapas 3 a 6 do [`plans/v0.1-reorganizacao.md`](plans/v0.1-reorganizacao.md));
* iniciar, parar e receber transmissão;
* exibir participante que está compartilhando;
* áudio da fonte escolhida, quando disponível;
* limite de uma transmissão simultânea.

## Liberação para teste

O mínimo para o aplicativo funcionar fora da rede local sem quebrar:

* build do Windows (instalador sem assinatura de código; o SmartScreen vai pedir confirmação);
* URL da API configurável por ambiente;
* identidade provisória: cada entrada gera um id aleatório novo (`idiot-<uuid>`), o que evita colisão no
  LiveKit; o nome escolhido e o id por instalação ficam para a v0.2.1;
* ~~código de acesso compartilhado, conferido pela API antes de emitir o token do LiveKit~~:
  **adiado para a v0.2.0**, que já tem auto-update e não exige redistribuir o executável; a identidade da
  v0.2.1 o substitui. Até lá, quem descobrir a URL da API consegue tokens e consome a cota;
* ~~logs em arquivo~~: **adiado para a v0.2.0**, junto com a base de entrega.

O grupo já recebeu o executável desta versão (2026-10-06); os dois itens adiados foram decididos
depois disso, para não exigir uma nova distribuição manual antes do auto-update.

## API

* `/health`;
* geração de token do LiveKit (sem proteção até a v0.2.0);
* chaves do LiveKit somente no backend;
* exposta pelo Tailscale Funnel, com URL fixa (`*.ts.net`); o túnel rápido da Cloudflare foi usado
  enquanto o Funnel não publicava o nome.

## Infraestrutura

API pelo **Tailscale Funnel** e mídia pelo **LiveKit Cloud** (plano gratuito). Ver
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
Etapa 6 de docs/plans/v0.1-reorganizacao.md
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

Transformar o teste em um aplicativo de uso contínuo: atualizações automáticas, a interface definitiva,
identidade, publicador nativo, chat real e servidor próprio.

## Entregas

A v0.2 é entregue em partes. Depois da v0.2.0, cada parte chega ao grupo pelo auto-update assim que fica
pronta, passando antes pelo canal beta. Cada entrega sai como versão `0.2.N0` (ver "Numeração das
versões"), e cada uma ganha um plano detalhado próprio antes de começar.

```text
v0.2.0  Base de entrega       auto-update + pipeline + canal beta + versão mínima + logs
v0.2.1  Identidade            convites + identidade do dispositivo + permissões + banco (sem mudança visível)
v0.2.2  UI nova               passa a usar as rotas da identidade
v0.2.3  Chat real + áudio     chat com histórico + supressão de ruído e cancelamento de eco
v0.2.4  Servidor              VPS (LiveKit, API e banco) + domínio + backup + alerta
v0.2.5  Publicador nativo
```

A ordem segue quatro regras: a base de entrega vem primeiro, porque faz todo o resto chegar sozinho; a
identidade vem antes da UI nova, e a UI nova antes de qualquer tela nova (convite, nick e chat), para que
nada seja construído duas vezes (a v0.2.1 e a v0.2.2 são uma entrega conjunta: a primeira não muda nada do
que o grupo vê, e a segunda mostra tudo); o chat e a supressão de ruído saem juntos, numa versão só (a
supressão é pequena e não depende do chat); e o servidor próprio vem antes do publicador nativo, que é
desenvolvido e medido já sobre o LiveKit da VPS, sem a cota de minutos do Cloud. Até o servidor, o LiveKit
Cloud e o computador de casa (com o Tailscale Funnel) bastam, ao custo de uma migração do banco na v0.2.4.

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
  cada atualização;
* **logs em arquivo** (adiado da v0.1): o `tracing` grava também num arquivo na pasta de dados do app,
  com rotação, para investigar problemas na máquina de cada um;
* **código de acesso provisório** (adiado da v0.1): o app manda um código fixo, embutido no build, e a API
  só emite o token do LiveKit com ele. Não protege contra quem tem o executável, só contra quem descobre a
  URL; fica até a identidade da v0.2.1. Com o auto-update, deixou de exigir redistribuição manual.

```text
uma versão nova passa pelo canal beta e depois chega sozinha a todos
 +
um teste falhando bloqueia o release
 +
cliente antigo recusado com pedido de atualização
```

### v0.2.1 — Identidade, convites e permissões

A v0.2.1 e a v0.2.2 formam uma entrega conjunta. Esta parte entrega o banco, as rotas da API e o comando de
administração, sem mudar nada do que o grupo vê: o app continua entrando pela rota antiga, com o código de
acesso provisório. As telas de convite e de escolha do nick nascem na UI nova da v0.2.2, que passa a usar as
rotas novas e então desliga o código de acesso.

**Banco de dados.** A identidade é o primeiro dado que precisa durar, então o banco entra aqui, rodando
junto da API no computador que a hospeda (o servidor próprio só vem na v0.2.4):

* banco escolhido antes da implementação (ADR), com migrações;
* backup automático, copiado para fora do computador (ex.: Cloudflare R2): a partir daqui há dados reais
  do grupo;
* a escolha considera a migração para a VPS na v0.2.4: com SQLite, a migração é copiar um arquivo; com
  PostgreSQL, um dump e um restore.

A v0.1 entra com uma identidade aleatória nova a cada entrada (`idiot-<uuid>`, nome `Idiota-<uuid>`); a
identidade do dispositivo, com o nome escolhido pela pessoa, a substitui, junto com a UI nova da v0.2.2.

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

A identidade do dispositivo é um identificador fixo, não um segredo que possa ser trocado. A URL da API
é pública desde a v0.1 (Tailscale Funnel), então a proteção não vem dela: para se passar por alguém, seria
preciso conhecer o hash do hardware daquela pessoa, que nunca sai do computador dela. Para um grupo
pequeno, o risco é aceito; se o valor vazar, o administrador desvincula o dispositivo e envia um convite
de recuperação.

**Usuários e convites**

* o usuário tem um id interno estável; o nick é escolhido ao entrar e é só o nome de exibição (a troca
  de nick entra na v0.7, junto com a foto);
* convite de uso único, com expiração e revogação;
* **convite de recuperação**: para troca de placa-mãe, troca de computador ou perda do token aleatório,
  o administrador gera um convite vinculado ao usuário existente. Ao usar o convite, o dispositivo novo
  é vinculado ao mesmo usuário, com o mesmo histórico, e o vínculo antigo é removido;
* o primeiro administrador é criado por configuração ou comando da API;
* fecha o acesso à API: substitui o código de acesso provisório da v0.2.0, quando a UI nova da v0.2.2 passa
  a usar as rotas; token do LiveKit só para usuários autenticados;
* o nick é escolhido na tela de convite da UI nova (v0.2.2); até lá, o convite e a recuperação saem pelo
  comando de administração.

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

### v0.2.2 — UI nova

Refazer a interface a partir do novo protótipo, depois da identidade (v0.2.1) e antes do chat, para que as
telas de convite, de nick e de conversa sejam construídas uma única vez em cima da interface definitiva. É
aqui que o grupo passa a ver a identidade: a UI nova usa as rotas de convite e de sessão da v0.2.1 e desliga
o código de acesso provisório.

Precisa de um plano próprio antes de começar, feito a partir do protótipo: telas, componentes,
navegação e o que muda na UI de voz e de compartilhamento (que hoje é provisória). Os itens de UI que a
v0.1 deixou (seletor de fontes, trava de uma transmissão por vez, textos dos presets) estão no
`BACKLOG.md`.

* **telas de convite e de escolha do nick**, sobre as rotas da v0.2.1: o nome que aparece na sala vem da
  identidade, no lugar do `Idiota-<uuid>`.

### v0.2.3 — Chat real e supressão de ruído

Duas partes, entregues juntas. A segunda é pequena e não depende da primeira.

**Chat real**

* enviar, receber e persistir mensagens;
* histórico ordenado e carregamento incremental;
* estado de envio e tratamento de erro;
* WebSocket próprio para eventos do aplicativo (`message.created`, `message.updated`,
  `message.deleted`, `presence.changed`); a mídia continua no LiveKit;
* reconexão do canal de eventos.

Até a v0.2.4, o histórico fica no banco do computador que hospeda a API: com ele desligado, não há chat
nem histórico.

```text
enviar mensagem → o outro receber → fechar e reabrir → ver o histórico
```

**Supressão de ruído e cancelamento de eco**

* supressão de ruído, cancelamento de eco e controle automático de ganho do microfone, pelos filtros
  do próprio WebView (opções de captura do `livekit-client`);
* ligados por padrão, com opção de desligar (o `livekit-client` 2.22 já pede os filtros por padrão, então
  falta a opção e conferir no WebView2, com `getSettings()`, se foram aplicados);
* o eco de quem assiste a uma tela inteira compartilhada **não espera esta entrega**: é um bug que o grupo
  já sentiu e sai como correção, fora de ordem (ver "Correções fora de ordem"). O modo "Todo o sistema"
  exclui o PID do app, o que não cobre o WebView2 quando há duas instâncias abertas; a correção é excluir o
  processo-navegador real do WebView2 (`BrowserProcessId`). Evidências e hipóteses no `BACKLOG.md`;
* se o filtro do WebView não bastar, avaliar um filtro mais forte (ex.: RNNoise num worklet de áudio).

```text
microfone sem ruído de teclado nem eco de quem usa caixa de som
```

### v0.2.4 — Servidor

Todo o servidor passa para uma VPS própria. A mídia sai do LiveKit Cloud, pré-requisito das transmissões
múltiplas da v0.4, e a API e o banco saem do seu computador, para que o aplicativo não caia quando ele
desligar ou reiniciar. Vem depois do chat e antes do publicador nativo: até aqui, o LiveKit Cloud e o computador de casa bastam
para o grupo. Pode ser antecipado se a cota do LiveKit Cloud apertar.

**Gatilho para antecipar:** se o consumo de minutos de participante de um mês passar de ~60% dos 5.000 do
plano gratuito, esta entrega passa à frente (ou o plano pago seguinte cobre o mês). O teste de 2026-10-06
mostrou que o limite que aperta primeiro são os minutos, não o tráfego (~2 GB numa tarde com até 4
pessoas). O publicador nativo (v0.2.5) vem depois, já sobre o servidor próprio: a segunda conexão de quem transmite
não consome essa cota.

O desktop só conhece a URL da API. A URL, a chave e o segredo do LiveKit ficam no servidor, e a URL do
LiveKit chega ao desktop pela própria API.

**Domínio e troca de URL.** O LiveKit próprio precisa de um domínio com certificado HTTPS (para o `wss://`
e o TURN), então o domínio é comprado aqui. A URL da API muda do Tailscale Funnel para o domínio, e o app
instalado tem a URL antiga gravada no build. A ordem é: publicar uma versão com a URL nova, manter as duas
respondendo até todos atualizarem e só então desligar a antiga.

* LiveKit, API e banco na mesma VPS (ex.: Docker Compose);
* a API exposta direto na VPS, com HTTPS no domínio próprio (sem túnel);
* VPS escolhida pelo **tráfego de saída incluso**, não só pela CPU: uma noite de screen share assistido
  por várias pessoas pode gerar dezenas de GB;
* TURN configurado, para quem estiver atrás de redes restritivas;
* segredos de produção configurados uma única vez no servidor, fora do repositório;
* banco migrado do computador de casa para a VPS (escolhido na v0.2.1);
* backup automático continua fora da VPS (ex.: Cloudflare R2), para que não se perca junto com ela;
* **alerta de servidor fora do ar**: um monitor externo gratuito chama o `/health` e avisa no celular.

```text
voz, screen share e chat funcionando pela VPS, com o seu computador desligado
 +
histórico do chat e usuários migrados, sem perda
 +
restauração do backup testada uma vez
 +
servidor desligado → alerta no celular
```

### v0.2.5 — Publicador nativo

* publicação do vídeo direto do Rust (conexão `{user_id}:screen`), sem passar pelo WebView;
* medição lado a lado com o caminho IPC, usando como linha de base a Etapa 6 de `docs/plans/v0.1-reorganizacao.md` e o teste da
  v0.1.

Vem depois do servidor próprio: é desenvolvido e medido já sobre o LiveKit da VPS (v0.2.4), sem a cota de
minutos do Cloud, onde a segunda conexão de quem transmite contaria como mais um participante. É a parte de
maior risco técnico que sobrou da mídia, e o motivo do aplicativo existir.

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
v0.1    API pelo Tailscale Funnel
        mídia pelo LiveKit Cloud (plano gratuito), consumo acompanhado
        ↓
v0.2.1  banco junto da API, no computador de casa
        backup fora do computador (ex.: Cloudflare R2)
        ↓
v0.2.4  LiveKit, API e banco em VPS própria, com domínio
        alerta de servidor fora do ar
        (antecipado se a cota do LiveKit Cloud apertar)
        ↓
v0.4    VPS dimensionada para várias transmissões
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
01. Etapas 4 a 6 de docs/plans/v0.1-reorganizacao.md
02. Build do Windows + URL configurável
03. Código de acesso na API (adiado para a v0.2.0)
04. Logs em arquivo (adiado para a v0.2.0)
05. Tailscale Funnel + LiveKit Cloud
06. Noite de teste com o grupo

v0.2
07. v0.2.0 Auto-update + pipeline com testes + canal beta + versão mínima + "O que há de novo"
    + logs em arquivo + código de acesso provisório
08. v0.2.1 Convites + identidade do dispositivo + permissões + segurança mínima + banco
09. v0.2.2 UI nova
10. v0.2.3 Chat real + WebSocket + supressão de ruído e cancelamento de eco
11. v0.2.4 VPS (LiveKit, API e banco) + domínio + migração + alerta
12. v0.2.5 Publicador nativo + medição

v0.3
13. Mensagens privadas
14. Não lidas + notificações + bandeja
15. Ligações privadas + histórico de chamadas

v0.4
16. Transmissões múltiplas + assinatura seletiva
17. Experiência de quem assiste

v0.5
18. Canais e salas
19. Status + digitando + menções + silenciar canal
20. Sons, speaking indicator e volume por usuário

v0.6
21. Tela de configurações + atalhos globais
22. Confiabilidade + qualidade da conexão + enviar logs

v0.7
23. Perfil + armazenamento de arquivos
24. Chat avançado + busca

v0.8
25. "Jogando X"
26. Refinos do screen share
27. Moderação

v0.9
28. Release Candidate

v1.0
```

A regra principal do desenvolvimento é:

> **O uso real decide a próxima prioridade.**
