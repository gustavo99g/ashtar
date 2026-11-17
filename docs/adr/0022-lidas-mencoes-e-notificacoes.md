# 0022 — Lidas, menções, silenciar, status e notificações

- **Status:** proposta (o experimento de notificações, Etapa 6 da v0.3, já decidiu o caminho; vira aceita no
  lançamento da `0.3.10`)
- **Data:** 2026-11

## Contexto

Com as conversas privadas (ADR 0021), uma mensagem pode chegar sem a pessoa estar olhando: em outro canal, num
jogo ou com a janela fechada na bandeja. Hoje o app não sabe o que cada um já leu, não avisa de nada e não tem
como alguém dizer "não me interrompa". O roadmap punha na v0.3 só o mínimo (não lidas e notificação de
mensagem nova) e deixava menções, silenciar canal, "começou a transmitir" e o "não perturbe" para a v0.5. Como
tudo isso depende da mesma base, foi combinado trazer junto (10/11).

A conta é ligada a um computador (ADR 0011 e 0013), mas pode ser recuperada em outro. O app já fica na bandeja
com a janela fechada desde a v0.2.4.

## Decisão

**"Lido" é um ponteiro por pessoa e por canal, no servidor.** A tabela `channel_state` guarda a última
mensagem lida e se o canal está silenciado. As não lidas são as mensagens dos outros depois do ponteiro; a
contagem para em 100. O ponteiro só anda para a frente. Vale para os canais de texto e para as conversas.

**Ninguém começa com tudo não lido.** A migração cria o ponteiro de cada membro na última mensagem de cada
canal, e quem entra no grupo depois ganha os ponteiros do mesmo jeito: vê o histórico, sem números.

**O app marca como lido** quando o canal (ou a janela da conversa) está aberto, a janela do app em foco e o
fim do histórico à vista, ou quando a pessoa pede ("Marcar como lido", "Marcar tudo como lido"). Com o app na
bandeja ou sem foco, não marca.

**A menção é `@nick`, resolvida pela API no envio.** O nick é único e não muda; o app mostra o nome visível.
Vale no começo do texto ou depois de espaço ou pontuação, nunca dentro de palavra, de e-mail ou de link; só
entre membros ativos que leem aquele canal; no máximo 10 por mensagem. A mensagem leva a lista de ids
mencionados, e a tabela `mentions` serve para contar as menções não lidas de cada um. Sem `@todos`.

**Silenciar** cala o aviso, o som e o número do canal ou da conversa. A menção passa.

**Três status, no servidor:** Disponível, Ocupado e Invisível. Ocupado aparece para os outros e, no app de
quem escolheu, cala avisos, sons, notificações e o toque de ligação; as não lidas continuam contando.
Invisível é resolvido na API: os outros recebem a pessoa como offline, em toda rota e em todo evento. Na sala
de voz ela aparece, se entrar.

**O app decide se notifica, num lugar só** (`features/notifications/model/decide.ts`), a partir do evento, do
status, do silenciar, das chaves da aba Notificações, do foco da janela e do que está aberto:

- mensagem de canal sem menção nunca notifica, só conta;
- canal ou conversa aberto e em foco: nada;
- Ocupado: nada;
- silenciado: só a menção;
- o resto vira um cartão na janela dos avisos, com a janela principal à vista ou na bandeja.

**"Fulano começou a transmitir"** sai do `voice.participants` que o app já recebe, sem rota nova.

**Com a janela fechada, o ícone da bandeja e o da barra de tarefas ganham um ponto** enquanto houver mensagem
privada ou menção não lida.

**As chaves de notificação e os sons ficam no computador;** o lido, o silenciar e o status, no servidor.

**O aviso é uma janela própria do Ashtar, e não a notificação do Windows** (resultado do experimento da Etapa
6, `desktop/experiments/notify-probe`). As duas funcionaram: a do Windows (pelo plugin ou direto pela API
WinRT, com o clique chegando ao app e dizendo a conversa) e a janela própria, pequena, sem borda, sempre no
topo, no canto de baixo à direita, que não rouba o foco. A escolha foi pela própria, porque ela tem a cara do
app e empilha do jeito que o grupo quer:

- no máximo três cartões; um cartão de outra conversa, com a pilha cheia, tira o mais antigo;
- mensagens da mesma conversa atualizam o cartão dela (com "N novas"), em vez de empilhar;
- cada cartão some em 6 segundos, e o mouse em cima da pilha pausa;
- o som toca na própria janela dos avisos (que está à vista nessa hora), no máximo um a cada 3 segundos.

O preço: o Windows não sabe que ela é uma notificação. Ela não fica na central de notificações (as não lidas
cobrem isso dentro do app) e não respeita sozinha o "Não incomodar" (o experimento confirmou). Antes de
mostrar, o app pergunta ao Windows (`SHQueryUserNotificationState`) e segura o aviso com jogo ou app em tela
cheia, apresentação ou tela bloqueada. O "Não incomodar" do Windows não tem consulta pública; quem quer
silêncio no Ashtar usa o Ocupado.

## Alternativas consideradas

- **O ponteiro no computador:** mais simples, mas a contagem com o app fechado teria de ser refeita a cada
  abertura, as menções não teriam onde ser contadas, e a recuperação da conta perderia tudo.
- **Uma linha por mensagem lida:** responde "quem leu o quê", que ninguém pediu, e cresce com o histórico.
- **A menção resolvida no app:** o app não sabe ao certo quem lê o canal, e cada app poderia interpretar o
  texto de um jeito. Pela API, o que virou menção é o que conta e o que notifica.
- **Mencionar pelo nome visível:** nomes repetem e mudam; o nick, não.
- **`@todos`:** num grupo de dez, vira o jeito padrão de falar, e a menção perde o sentido. Fica para depois
  de uma semana de uso.
- **A API decidir e mandar a notificação pronta:** ela não sabe se a janela está em foco nem qual canal está
  aberto.
- **Notificar toda mensagem de canal:** o `#geral` viraria barulho no primeiro dia.
- **Invisível resolvido no app** (a API manda o status e o app esconde): o status estaria no socket de todo
  mundo.
- **Só Disponível e Ocupado:** o Invisível está no desenho, e resolvido na API custa pouco.

## Consequências

- O `ready` passa a trazer, para cada canal e conversa, o ponteiro, as não lidas, as menções e o silenciar.
- Toda mensagem enviada passa a procurar menções: uma busca nos membros ativos, barata para dez pessoas.
- O Invisível pede cuidado em toda rota e evento que diz quem está online, com teste.
- As não lidas e o aviso não dependem das configurações de notificação do Windows. O "Não incomodar" do
  Windows não cala o Ashtar; a tela cheia, sim.
- A ligação privada (ADR 0023) usa o mesmo `decide.ts` e o mesmo status.
- Rever a regra das mensagens de canal se o grupo pedir notificação por canal, e o `@todos` depois do uso.
