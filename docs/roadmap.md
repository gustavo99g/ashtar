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
        + publicador nativo + servidor na VPS
        ↓
v0.3  → Conversas privadas
        Lista de canais nova + mensagens privadas + não lidas, menções e notificações
        + status + ligações privadas
        ↓
v0.4  → Transmissões múltiplas e câmera
        Várias transmissões simultâneas + experiência de quem assiste + câmera
        ↓
v0.5  → Salas e presença
        Várias salas de voz + ausente automático + digitando + sons da voz
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
0.2.40           entrega v0.2.4 (publicador nativo)
0.2.41…          correções da v0.2.4
0.2.50           entrega v0.2.5 (servidor)
0.3.0            entrega v0.3.0 (base visual)
0.3.10           entrega v0.3.1 (todo o chat)
0.3.20           entrega v0.3.2 (ligações privadas)
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
v0.2.3  Chat real + áudio     canais de texto com histórico + supressão de ruído + Painel da v0.2.2
v0.2.4  Publicador nativo     captura pelo WGC + H.264 de hardware + segunda conexão no LiveKit + seletor novo
v0.2.5  Servidor              VPS (LiveKit, API e banco) + domínio + backup + alerta
```

A ordem segue quatro regras: a base de entrega vem primeiro, porque faz todo o resto chegar sozinho; a
identidade vem antes da UI nova, e a UI nova antes de qualquer tela nova (convite, nick e chat), para que
nada seja construído duas vezes (a v0.2.1 e a v0.2.2 são uma entrega conjunta: a primeira não muda nada do
que o grupo vê, e a segunda mostra tudo); o chat e a supressão de ruído saem juntos, numa versão só (a
supressão é pequena e não depende do chat); e o publicador nativo vem antes do servidor próprio. O servidor
era a v0.2.4 e o publicador a v0.2.5, para que o publicador fosse medido sem a cota do Cloud; a medição da
Etapa 0 do publicador (`desktop/experiments/encoder-probe`) mostrou o contrário: o caminho novo é bom o
bastante para não esperar a VPS, e a segunda conexão de quem transmite cabe na cota do LiveKit Cloud enquanto
o grupo for pequeno. Até o servidor, o LiveKit Cloud e o computador de casa (com o Tailscale Funnel) bastam,
ao custo de uma migração do banco na v0.2.5.

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
junto da API no computador que a hospeda (o servidor próprio só vem na v0.2.5):

* banco escolhido antes da implementação (ADR), com migrações;
* backup automático, copiado para fora do computador (ex.: Cloudflare R2): a partir daqui há dados reais
  do grupo;
* a escolha considera a migração para a VPS na v0.2.5: com SQLite, a migração é copiar um arquivo; com
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

> Publicada como `0.2.20` e `0.2.21` (31/10), **menos o Painel de controle**, que sai junto com o chat,
> na v0.2.3 (`0.2.30`). O plano e o andamento estão no `PLAN.md`.

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
* **escolha do microfone e da saída** nas configurações, com o padrão do Windows quando o escolhido está
  desconectado (pedido de 29/10, adiantado da v0.6).

### v0.2.3 — Chat real e supressão de ruído

Sai numa versão só, a `0.2.30`, junto com o Painel de controle da v0.2.2 (Convites, Membros e o aviso de
quem entrou), que não é publicado antes. O plano e o andamento estão no `PLAN.md`; as decisões, nas ADRs
0015 e 0016.

**Chat real**

* enviar, receber e persistir mensagens de texto, com o estado de envio e o "Tentar de novo";
* histórico ordenado e carregamento incremental;
* vários canais de texto, em categorias que também guardam as salas de voz, arrumados arrastando, com a
  permissão "Gerenciar canais" dada por pessoa (adiantado da v0.5, pedido de 31/10);
* WebSocket próprio para eventos do aplicativo (`message.created`, `presence.changed`, a sala de voz pelo
  webhook do LiveKit, quem entrou no grupo e as mudanças de canais); a mídia continua no LiveKit;
* reconexão do canal de eventos;
* presença online e offline na coluna de membros;
* miniatura da transmissão para quem sai da sala assistindo alguém.

Até a v0.2.5, o histórico fica no banco do computador que hospeda a API: com ele desligado, não há chat
nem histórico.

```text
enviar mensagem → o outro receber → fechar e reabrir → ver o histórico
```

**Supressão de ruído**

* RNNoise como processador da trilha do microfone, ligado por padrão, com um interruptor "Supressão de
  ruído" em Configurações › Voz e vídeo que volta à supressão do navegador, na hora, também no meio da
  chamada (as outras opções da aba ficam para a v0.6); com o RNNoise ligado, o filtro de ruído do WebView
  fica desligado (os dois juntos abafam a voz), e o cancelamento de eco e o ganho automático dele continuam;
* o filtro do WebView sozinho não bastou na conversa (teclado e voz de fundo passavam), e o Krisp depende
  do LiveKit Cloud, que sai na v0.2.5.

```text
microfone sem ruído de teclado durante uma conversa
```

### v0.2.4 — Publicador nativo

A transmissão de tela sai do WebView. Medido antes de começar (`desktop/experiments/encoder-probe`): 1080p60 de
uma tela 4K com ~0,7% de CPU, da captura ao H.264 de hardware em 5,8 ms na mediana. Vem antes do servidor
próprio: a segunda conexão de quem transmite cabe na cota do LiveKit Cloud enquanto o grupo for pequeno.

* publicação do vídeo e do áudio direto do Rust (conexão `{user_id}:screen`), sem passar pelo WebView;
* captura própria pelo WGC, redução e conversão para NV12 na GPU e encoder H.264 de hardware do Media
  Foundation, com o codificador de software como plano B;
* seletor de fontes com todas as janelas (inclusive minimizadas), foco na janela escolhida e miniaturas ao vivo
  a 5–10 fps; o preview de quem transmite reaproveita a miniatura;
* presets Movimento (1080p60) e Nitidez (1080p30), e os ajustes no meio da transmissão (preset, fonte, áudio,
  cursor, pausa), com os números e quem está assistindo;
* a saída do encoder com mais de um destino (publicador hoje; buffer de clipes e replay na v1.1);
* medição lado a lado com o caminho IPC (`0.2.30`).

```text
transmitir 1080p60 de um monitor 4K com a CPU abaixo de ~2% e o fps cravado
 +
janela minimizada no seletor, escolhida e trazida para a frente
 +
publicador nativo igual ou melhor que o caminho IPC na medição
```

### v0.2.5 — Servidor

Todo o servidor passa para uma VPS própria. A mídia sai do LiveKit Cloud, pré-requisito das transmissões
múltiplas da v0.4, e a API e o banco saem do seu computador, para que o aplicativo não caia quando ele
desligar ou reiniciar. Vem depois do publicador nativo: até aqui, o LiveKit Cloud e o computador de casa
bastam para o grupo. Pode ser antecipado se a cota do LiveKit Cloud apertar.

**Gatilho para antecipar:** se o consumo de minutos de participante de um mês passar de ~60% dos 5.000 do
plano gratuito, esta entrega passa à frente (ou o plano pago seguinte cobre o mês). O teste de 2026-10-06
mostrou que o limite que aperta primeiro são os minutos, não o tráfego (~2 GB numa tarde com até 4
pessoas). Com o publicador nativo, a conexão `:screen` de quem transmite conta como mais um participante:
acompanhar a cota no painel do Cloud.

**Começa pelo LiveKit.** O que apertou foi o tráfego, não os minutos: uns 30 minutos de teste em 2026-11-09
gastaram ~3 GB dos 50 GB do mês. O LiveKit foi para a VPS primeiro (2026-11-16, Hostinger KVM 2), com a API e o
banco ainda em casa; a troca foi só no `.env` da API. Depois vem a API, em duas fases: o domínio
`api.ashtar.app.br` primeiro repassa para a API de casa enquanto sai a versão do app com a URL nova, e só então o
banco vai para a VPS. A imagem da API sai do GitHub Actions (botão manual) e a VPS só baixa. Configuração e passo
a passo em [`deploy/server/`](../deploy/server/README.md).

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

---

# v0.3 — Conversas privadas

## Objetivo

Mensagens e ligações privadas entre duas pessoas, com as não lidas, as notificações, as menções e o status
que elas pedem. Antes, uma entrega só de interface refaz a lista de canais e o cartão do usuário, que as
outras duas usam. O desenho é o do canvas "Clone do Discord — telas" (fechado em 08/11), e o escopo foi
combinado em 10/11: as menções, o silenciar, o "começou a transmitir", o "não perturbe" e o volume por pessoa,
que estavam na v0.5, vêm para cá, porque usam a mesma base.

## Entregas

As três entregas da v0.3 saem juntas, na versão `0.3.20`: a `0.3.0` e a `0.3.10` não chegaram a ser publicadas.

```text
v0.3.0  Base visual
        lista de canais nova + modo Organizar + cartão do usuário + volume individual
        ↓
v0.3.1  Todo o chat
        conversas privadas + não lidas + menções + silenciar + notificações + status
        ↓
v0.3.2  Ligações privadas
        tocar, atender, recusar, perdida + tela compartilhada + registro (depois da v0.2.5)
```

### v0.3.0 — Base visual

Só o app. Decisões na ADR 0020.

* lista de canais sem ferramentas fixas: o + da categoria e a engrenagem do canal só no hover;
* o nome do servidor vira o menu de quem gerencia: Convidar, Criar canal, Criar categoria, Organizar canais e
  Canais arquivados;
* menu do canal (engrenagem ou botão direito) com Editar, Mover para e Arquivar;
* **modo Organizar:** arrastar só nele, com Concluir (grava tudo de uma vez) e Desfazer;
* um cartão só para o usuário, na lista de membros e na lista da sala;
* **volume individual**, de 0 a 200%, só para quem ajusta, no cartão e no clique do bloco da grade, com a
  marca no bloco (adiantado da v0.5);
* tempo limite no pedido do token de voz e `MIN_CLIENT_VERSION` em `0.2.20` (do `BACKLOG.md`).

```text
quem gerencia arruma os canais pelo modo Organizar, com um pedido só
 +
quem não gerencia vê a lista sem nenhuma ferramenta
 +
cada um ajusta o volume de cada pessoa da sala
```

### v0.3.1 — Todo o chat

API, banco e app. Decisões nas ADRs 0021 e 0022.

**Mensagens privadas**

* conversa entre duas pessoas, tratada como um canal de tipo `dm`, reaproveitando o chat da v0.2;
* primeira permissão por canal do projeto: a API garante que só os dois leiam o histórico, e o WebSocket só
  envia os eventos para eles, com testes de integração no pipeline;
* a lateral direita ganha as abas Membros e Conversas e o botão de minimizar; a conversa abre numa janela
  embaixo, com até três abertas em abas;
* as mensagens ficam em texto puro no banco, legíveis por quem administra o servidor. Isso é comunicado ao
  grupo e escrito no começo de cada conversa; criptografia ponta a ponta fica fora do escopo.

**Não lidas**

* até onde cada pessoa leu cada canal e cada conversa, guardado no servidor;
* número de não lidas nas conversas, marca nos canais e a linha "novas mensagens" no histórico;
* "Marcar como lido" e "Marcar tudo como lido";
* ninguém começa com o histórico inteiro como não lido.

**Menções e silenciar** (adiantados da v0.5)

* menções (`@nick`), com sugestão ao digitar, destaque e contador próprio;
* silenciar canal e silenciar conversa; a menção notifica mesmo assim.

**Notificações**

* aviso para mensagem privada e menção numa janela própria do Ashtar, no canto da tela, com até três cartões
  (o experimento da Etapa 6 escolheu ela no lugar da notificação do Windows, ADR 0022); a tela cheia segura o
  aviso;
* ponto de não lido no ícone da bandeja e na barra de tarefas;
* sons de mensagem privada e de menção;
* notificação "fulano começou a transmitir", para quem não está na sala (adiantada da v0.5);
* aba Notificações nas configurações, com uma chave por tipo;
* mensagem comum de canal não notifica: só conta como não lida.

**Status**

* Disponível, Ocupado e Invisível, no menu do seu painel;
* **Ocupado** é o "não perturbe" (adiantado da v0.5): sem avisos, sons, notificações nem toque de ligação;
* **Invisível:** os outros veem a pessoa offline.

**Aplicativo em segundo plano**

* a bandeja existe desde a v0.2.4: fechar a janela não sai da sala e continua recebendo mensagens;
* iniciar com o Windows (opcional), direto na bandeja.

```text
mensagem privada → só os dois leem, com teste automático provando
 +
janela fechada → notificação e ponto na bandeja
 +
menção num canal silenciado → notifica
 +
Ocupado → nada toca, e as não lidas continuam contando
 +
reabrir o app → não lidas certas, com a linha "novas mensagens" no lugar
```

### v0.3.2 — Ligações privadas

API, banco e app. Decisões na ADR 0023. **Só é publicada com o LiveKit na VPS (v0.2.5).**

* a sala da ligação é a própria conversa, com token só para os dois;
* screen share na ligação, igual ao da sala de voz;
* tocar, atender, recusar, tempo limite de 30 s e chamada perdida;
* toca com a janela fechada, pelo aplicativo na bandeja, num cartão com Recusar, Atender e Responder com
  mensagem na janela dos avisos (o experimento da Etapa 18 escolheu ela no lugar da notificação do Windows,
  que some com o "Não incomodar", ADR 0023);
* quem liga nunca vê "ocupado": a ligação toca normalmente, mesmo que a outra pessoa esteja numa sala;
* para quem está offline (ou Invisível), o botão Ligar fica apagado;
* os outros membros não ficam sabendo da ligação: os dois só saem da lista da sala;
* **registro de chamadas na conversa**: "ligação de 42 min", "chamada perdida", com um botão para ligar de
  volta.

**Ligação recebida estando numa sala**, como no Discord:

```text
toque + cartão com nome e avatar de quem liga, com Recusar e Sair e atender
 ↓
o avatar de quem liga aparece no topo da lateral, com o anel dourado
 ↓
Sair e atender → sai da sala → entra na ligação
Recusar        → continua na sala; quem ligou vê "recusada"
sem resposta   → chamada perdida registrada na conversa
```

* a pessoa fica conectada a uma única sala de voz por vez, nunca à sala e à ligação ao mesmo tempo;
* quem liga só sai da sala em que está quando a outra pessoa atende;
* se ela estiver transmitindo a tela na sala, o botão avisa que a transmissão será encerrada;
* o toque é mais baixo enquanto a pessoa está numa sala, para não atrapalhar a conversa;
* ao desligar, a pessoa não volta sozinha para a sala: a conversa oferece "voltar para a sala";
* em Ocupado, a ligação não toca: aparece só o avatar na lateral, com Recusar e Atender na conversa.

```text
ligação privada com a janela fechada → tocar, atender, recusar e chamada perdida
 +
screen share dentro da ligação privada
 +
ligação recebida estando numa sala → sair e atender → voltar para a sala com um clique
 +
ninguém fora da conversa fica sabendo da ligação
```

## Critérios de conclusão

```text
v0.3.0 → canais organizados pelo modo Organizar + volume individual
 +
v0.3.1 → mensagem privada que só os dois leem + não lidas + notificação com a janela fechada
 +
v0.3.2 → ligação privada com a janela fechada + screen share dentro dela
```

---

# v0.4 — Transmissões múltiplas e câmera

## Objetivo

Permitir que mais de uma pessoa compartilhe a tela ao mesmo tempo, com uma boa experiência para quem
assiste, e ligar a câmera na sala e na ligação. Sai numa versão só, a `0.4.0`. Depende do publicador nativo
e da VPS, que já tem o LiveKit, a API e o banco (Borkcloud). Decisões nas ADRs 0024 (transmissões) e 0025
(câmera).

## Transmissões

* várias transmissões simultâneas na mesma sala, com limite da API por sala (`MAX_SHARES_PER_ROOM`, padrão 6);
* o palco do canvas "Várias telas": uma, lado a lado, 2×2, ou uma em foco com as outras na fileira de baixo;
* a pequena pede a camada leve (o publicador ganha a camada leve depois do experimento da Etapa 1);
* aviso de transmissão nova também dentro da sala, com Assistir.

A assinatura seletiva (só a transmissão aberta é baixada) já existe desde a v0.2.3.

## Experiência de quem assiste

* escolher quais assistir, focar uma e trocar entre elas; a miniatura com setas;
* tela cheia;
* volume e qualidade (Automática ou Leve) de cada transmissão, guardados por quem transmite;
* quem está assistindo cada transmissão, para todos;
* na transmissão em foco: ampliar com a roda do mouse, ver como está chegando e copiar um quadro.

A janela destacada (pop-out) saiu: a miniatura cobre o uso de assistir fora da sala.

## Câmera

* o botão Câmera, com a prévia (dispositivo, 480p/720p/1080p a 30 fps, Espelhar) e a seção em Voz e vídeo;
* sempre começa desligada;
* a câmera no bloco da pessoa, na Grade, na fileira do palco e na ligação; quem transmite aparece com ela no
  canto da própria transmissão;
* assinada só com os blocos à vista.

## Ordem prática

API (limite) → várias transmissões no app → qualidade e aviso → ferramentas da transmissão em foco → câmera →
"O que há de novo" das versões puladas → testes no Windows e medição da VPS → `0.4.0`.

## Critérios de conclusão

```text
duas transmissões simultâneas
 +
quatro pessoas assistindo, trocando entre elas
 +
quatro câmeras e duas transmissões numa noite sem picotes
 +
CPU, memória e banda da VPS medidas e dentro do plano contratado
```

---

# v0.5 — Salas e presença

Sai numa versão só, a `0.5.0`. O plano está em [`docs/plans/v0.5-salas-e-presenca.md`](plans/v0.5-salas-e-presenca.md); as
decisões, nas ADRs 0026, 0027 e 0028.

## Objetivo

Sair da sala única e mostrar quem está fazendo o quê. Os canais de texto, as menções, o silenciar, o "não
perturbe", o volume por pessoa e o indicador de quem fala já saíram antes (v0.2.3, v0.3 e v0.4).

## Canais

* múltiplas salas de voz, criadas como os canais de texto da v0.2.3, nas mesmas categorias;
* trocar de sala com um clique, sem sair e entrar de novo;
* conexão de voz independente do canal de texto selecionado (já vale desde a v0.2.3);
* mover alguém para outra sala, pelo cartão do usuário ou arrastando na lista de canais, e desconectar alguém da
  voz, com a permissão "Mover membros";
* canais de texto e salas de voz restritos a uma lista de pessoas, que somem para quem está fora.

```text
Canal de texto:          # development
Canal de voz conectado:  🔊 General
```

## Presença

* status ausente, manual e automático por inatividade (Disponível, Ocupado e Invisível são da v0.3);
* quem está em cada sala de voz;
* indicador "digitando...".

## Voz

* sons de entrada e saída de pessoas na sala, de mutar e ensurdecer, e de começar e parar de transmitir.

## Fora do escopo

* status com texto livre;
* chat de texto dentro da sala de voz;
* limite de pessoas por sala.

## Critérios de conclusão

```text
criar uma segunda sala de voz
 ↓
entrar em voz e continuar navegando pelo chat
 ↓
trocar de sala de voz, e mover alguém para a outra
 ↓
um canal restrito some para quem está fora
 ↓
ficar inativo → status muda para ausente
```

---

# v0.6 — Confiabilidade e configurações

Sai numa versão só, a `0.6.0`. O plano está no `PLAN.md` da raiz enquanto a fase anda; as decisões, nas ADRs 0029 e
0030.

## Objetivo

Deixar o aplicativo confiável e ajustável para uso todos os dias. A tela de configurações (Perfil, Voz e vídeo,
Notificações e Aplicativo), o tempo limite do lado do app, a reconexão do WebSocket, a troca de dispositivo, o ping
da chamada e a tela "Este computador saiu do grupo" já saíram antes (v0.2.2 a v0.5).

## Configurações

* o resto da aba Voz e vídeo: volume de entrada e de saída, teste de microfone, modo de entrada (detecção de voz
  com a sensibilidade automática ou manual, ou pressionar para falar), cancelamento de eco, controle automático de
  ganho e os padrões da transmissão (qualidade e áudio);
* uma aba Atalhos.

## Atalhos globais

* mutar, ensurdecer, pressionar para falar, atender e recusar ou desligar a ligação, funcionando com um jogo em
  foco, pelo teclado e pelos botões do mouse;
* configuráveis na aba Atalhos (o do overlay fica de fora, com o overlay).

## Confiabilidade

* tempo limite por pedido na API;
* API indisponível: a faixa "Sem conexão com o servidor", com nova tentativa, e os dados recarregados ao voltar;
* reconexão da voz com token novo depois que o LiveKit desiste, e ao voltar da suspensão do Windows;
* reconexão da transmissão nativa sem parar a captura;
* dispositivos: microfone e saída desconectados, com aviso e volta ao escolhido;
* **indicador de qualidade da conexão** por participante (ping e perda de pacotes), para saber se um
  picote vem da rede de quem transmite ou de quem assiste;
* botão "Enviar logs", que manda os logs recentes para a API, e a tela Logs no Painel de controle do dono;
* aviso de "você está mutado" ao falar mutado, e o som opcional do pressionar para falar;
* Testar conexão (ping e caminho da voz, UDP ou TCP) em Voz e vídeo;
* o estado do servidor (API, LiveKit, disco e último backup) no Painel do dono.

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
 +
mandar os logs pelo app → o dono baixa pelo Painel
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

* ~~miniaturas e preview no seletor de fontes~~ (adiantado para a v0.2.4, com o publicador nativo);
* aviso de conteúdo protegido (frames pretos por vários segundos);
* ~~presets de qualidade expostos na interface~~ (v0.2.4: Movimento e Nitidez, no seletor e no painel).

## Moderação

* tela de administração no aplicativo;
* listar e revogar convites;
* expulsar usuário e desvincular seus dispositivos;
* na voz: mutar alguém e encerrar uma transmissão (operações da API de servidor do LiveKit). Tirar da sala
  saiu na v0.5, como "Desconectar da voz".

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
v0.2.4  segunda conexão de quem transmite (publicador nativo) no LiveKit Cloud
        ↓
v0.2.5  LiveKit, API e banco em VPS própria, com domínio
        alerta de servidor fora do ar
        (antecipado se a cota do LiveKit Cloud apertar)
        ↓
v0.4    VPS dimensionada para várias transmissões
```

---

# v1.1 — Clipes e replay (planejada)

## Objetivo

Guardar os melhores momentos do grupo: clipes das transmissões, vistos por todos num canal próprio, e replay
em segundo plano dos jogos jogados juntos. Nada disso entra antes da v1.0, mas a base é preparada antes (ver
"Depende de").

## Clipes das transmissões

* qualquer um que esteja assistindo uma transmissão do grupo pode clipar;
* o clipe é gravado **no PC de quem assiste**: o servidor repassa o H.264 original sem recodificar, então quem
  assiste tem os mesmos bytes que quem transmite. Quem transmite não gasta upload nem disco;
* buffer em disco, em pedaços (ex.: os últimos 5 min), para clipes de mais de 1 min; o corte fino fica no canal
  de clipes;
* o clipe vai para um **canal de clipes** no chat, com player e miniatura, visível para todos;
* a decidir: limite de duração ou tamanho por clipe (5 min a 8 Mbps são ~300 MB) e se quem transmite vê quem
  clipou.

## Replay dos jogos

* com duas ou mais pessoas na sala, o app de cada um reconhece um jogo aberto e grava em segundo plano os
  últimos minutos, pelo mesmo caminho do publicador nativo (WGC → GPU → encoder de hardware), sem transmitir;
* cada um salva **o próprio** replay, com uma tecla de atalho, e decide se envia;
* o envio vai para um armazenamento grande, possivelmente um homelab próprio, por uma API compatível com S3.

## Depende de

* v0.2.4: saída do encoder com mais de um destino (o `Fanout`);
* v0.7: armazenamento de arquivos e anexos de vídeo no chat;
* v0.8: reconhecimento de jogos ("Jogando X"), reaproveitado para ligar o replay.

## Critérios de conclusão

```text
assistir uma transmissão → clipar os últimos 2 min → o clipe aparece no canal de clipes para todos
 +
jogar com o grupo → salvar o replay com o atalho → o arquivo fica no PC, pronto para enviar
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
10. v0.2.3 Chat real + canais de texto + WebSocket + supressão de ruído + Painel
11. v0.2.4 Publicador nativo (WGC + H.264 de hardware) + seletor de fontes + medição
12. v0.2.5 VPS (LiveKit, API e banco) + domínio + migração + alerta

v0.3
13. v0.3.0 Lista de canais + modo Organizar + cartão do usuário + volume individual
14. v0.3.1 Mensagens privadas + não lidas + menções + silenciar + notificações + status
15. v0.3.2 Ligações privadas + registro de chamadas (depois da v0.2.5)

v0.4
16. Transmissões múltiplas + assinatura seletiva
17. Experiência de quem assiste

v0.5
18. Salas de voz
19. Ausente automático + digitando
20. Sons e speaking indicator

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
