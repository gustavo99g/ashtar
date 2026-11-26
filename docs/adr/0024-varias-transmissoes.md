# 0024 — Várias transmissões na mesma sala

- **Status:** proposta (passa a aceita com o experimento da camada leve e a medição da VPS, Etapas 1 e 13 da v0.4)
- **Data:** 2026-11

## Contexto

Até a v0.3, uma sala tinha uma transmissão por vez: o `shareWinner` escolhia quem ficava no ar quando duas
pessoas começavam juntas, e o `ShareRaceGuard` derrubava a outra. Quem assistia via uma transmissão só, no Foco ou
na miniatura. A v0.4 abre a sala para várias ao mesmo tempo, com o desenho do canvas "Várias telas" (lado a lado,
2×2, uma em foco com a fileira de baixo, a miniatura com setas).

A tela sai do publicador nativo, numa conexão `{id}:screen` (ADR 0017): uma camada só de H.264, sem simulcast. O
LiveKit, a API e o banco estão na VPS (Borkcloud), com franquia de dados ilimitada por enquanto. Cada transmissão
assistida é um vídeo a mais que a VPS manda para cada pessoa que assiste.

## Decisão

**A regra de uma por vez sai.** O `shareWinner` vira `compareShares` (ordena da mais antiga para a mais nova, pelo
horário no nome da trilha) e o `ShareRaceGuard` deixa de existir. O nome da trilha (`screen-share:{...}`) continua,
com a qualidade e o título da fonte.

**O limite é da API, por sala.** O `POST /api/voice/screen-token` conta as conexões `:screen` da sala, sem contar a
de quem pede, e responde 409 `share_limit` quando chegou ao limite (`MAX_SHARES_PER_ROOM`, padrão 6). Duas pessoas
pedindo o último lugar juntas podem passar as duas: aceito, porque passa por uma, e não por dezenas. No app, a
recusa vira o aviso "A sala está cheia de transmissões" (o botão não fica apagado: o app não sabe o limite).

**O que assistir é uma lista.** O `roomViewStore` guarda `watching` (as abertas, na ordem em que a pessoa abriu),
`focused` (a posta em foco, ou nenhuma), `miniPick` (a que a miniatura mostra) e `shown` (as desenhadas agora, com o
tamanho de cada uma). Só as de `shown` são assinadas (`subscriptions.ts`). Ninguém assiste sem clicar.

**O palco segue o canvas** (`stageLayout.ts`): uma ocupa tudo, duas lado a lado, três e quatro em 2×2; com cinco ou
mais, ou com uma em foco, ela fica grande e as outras vão para a fileira de baixo, com a borda dourada.

**A pequena pede a camada leve** (`setVideoQuality`: LOW pequena, HIGH grande). Enquanto o publicador mandar uma
camada só, o pedido não muda nada; o experimento da Etapa 1 decide como a camada leve sai (segunda camada no
publicador, segunda trilha ou só pausar o vídeo fora da tela).

**Quem assiste escolhe a qualidade** de cada transmissão, Automática ou Leve, guardada por pessoa que transmite,
junto do volume (`shareVolumeStore`, versão 2: o volume único da 0.3 vira o padrão de quem ainda não tem ajuste).
Leve conta como pequena para a assinatura.

**Todas tocam som**, cada uma com o volume próprio de 0 a 200%.

**A miniatura mostra uma de cada vez**, com setas (1/2) quando há mais de uma aberta.

**Quem assiste, para todos.** Cada app manda no tópico `screen-viewers` a lista das transmissões que tem à vista
(`{"watching": ["id-1", "id-2"]}`), para a sala inteira, a cada mudança e de novo para quem entra. Cada app junta
os avisos numa tabela (`viewers.ts`), e cada transmissão mostra até três avatares e o "+N". O formato da 0.3
(`{"watching": "id"}` ou `null`) continua sendo lido; a 0.3 não lê o novo.

**O aviso de transmissão nova também dentro da sala**, com Assistir, sem som; não avisa as que já estavam no ar ao
entrar, quem parou e voltou em até 15 s, nem em Ocupado.

**As ferramentas de quem assiste só existem na transmissão em foco** (a focada ou a única aberta, também em tela
cheia): ampliar com a roda do mouse até 4× (`zoom.ts`), ver como está chegando num popover que só lê as
estatísticas aberto (`inboundHealth.ts`), e copiar um quadro na resolução que chega (`frame.ts`). Lado a lado, no
2×2, na fileira e na miniatura, só Volume, Qualidade, Focar e Parar de assistir.

## Alternativas consideradas

- **O limite no app** (o botão apagado com N no ar): cada app teria que confiar nos outros; a API já confere quem
  está na sala ao dar o token, e é ela que protege a VPS.
- **Abrir todas as transmissões sozinhas**: o tráfego cresceria com cada transmissão de cada pessoa; abrir é
  sempre um clique.
- **As ferramentas em todas as transmissões**: com três lado a lado não dá para saber de qual a pessoa quer os
  números; focar antes é um clique.
- **Avisar quem assiste só para quem transmite** (como na 0.3): os avatares em cada transmissão precisam que todos
  saibam.

## Consequências

- A VPS manda um vídeo por transmissão aberta por pessoa; a medição da Etapa 13 diz se o limite de 6 cabe.
- Sem a camada leve, a pequena chega cheia; o "Leve" e a fileira só economizam depois da Etapa 1.
- Atualiza a ADR 0017 (o publicador continua sem simulcast até a Etapa 1) e o trecho da ADR 0023 sobre a trava de
  uma transmissão por vez, que deixa de existir também na ligação.
- Sinal para rever: a medição da VPS passar do plano, ou o grupo pedir mais de 6.

## Adendo (v0.9): a miniatura nas configurações

Até a v0.8, abrir as configurações escondia a miniatura e parava de baixar a transmissão até a pessoa sair delas. No
uso, isso incomodou o Kid (24/11). A partir da v0.9, a miniatura aparece por cima das configurações, no canto de baixo
à direita, com os mesmos controles, e a transmissão continua sendo baixada. As conversas privadas continuam escondidas
nas configurações.
