# Plano — v0.3: conversas privadas

A v0.3 traz as conversas privadas entre duas pessoas, com tudo o que elas pedem em volta: não lidas,
notificações, menções, status e, por último, as ligações. Antes disso, uma parte só de interface refaz a lista
de canais e o menu do usuário, que as outras duas partes vão usar. O visual segue o canvas
"Clone do Discord — telas". O plano da fase anterior está arquivado em
[`docs/plans/v0.2.4-publicador-nativo.md`](docs/plans/v0.2.4-publicador-nativo.md).

Sai em três entregas, cada uma pelo beta antes do estável:

| Entrega | Versão | O que é | Mexe em |
|---|---|---|---|
| v0.3.0 | `0.3.0` | Base visual: lista de canais nova e menu do usuário com volume individual | Só o app |
| v0.3.1 | `0.3.10` | Todo o chat: conversas privadas, não lidas, notificações, menções, silenciar e status | API, banco e app |
| v0.3.2 | `0.3.20` | Ligações privadas, com tela compartilhada e registro no histórico | API, banco e app |

**Objetivo da fase:** duas pessoas do grupo conversam e se ligam em particular sem sair do Ashtar; ninguém
perde uma mensagem privada ou uma menção por estar em outro canal, num jogo ou com a janela fechada; e quem
não quer ser interrompido tem como dizer isso.

**Fora do escopo:** ausente automático por inatividade e "digitando…" (v0.5); criar sala de voz, sons de
entrada e saída e mover alguém de sala (v0.5); duas transmissões ao mesmo tempo (v0.4); editar, excluir,
responder, reações, anexos e busca (v0.7); a seção Moderação do cartão do usuário (v0.8); câmera e overlay no
jogo (sem versão); grupos privados com mais de duas pessoas e criptografia ponta a ponta (depois da v1.0).

Base: a `dev` no `aee73ee` (`0.2.40`). Em cada etapa, `cargo fmt --check`, `cargo clippy --all-targets -- -D
warnings` e `cargo test` (em `api/` e em `desktop/src-tauri/`) e `pnpm lint`, `pnpm build` e `pnpm test` (em
`desktop/`) devem passar.

## Progresso

| Etapa | Entrega | Descrição | Status |
|---|---|---|---|
| 0 | todas | Decisões: ADRs 0020 a 0023, roadmap, BACKLOG | Concluída |
| 1 | v0.3.0 | App: a lista de canais do canvas, o menu do servidor e o menu do canal | Concluída |
| 2 | v0.3.0 | App: o modo Organizar canais | Concluída |
| 3 | v0.3.0 | App: o cartão novo do usuário, nas duas listas | Concluída |
| 4 | v0.3.0 | App: volume individual, o volume pelo bloco e a marca | Pendente |
| 5 | v0.3.0 | Carona do BACKLOG e lançamento da `0.3.0` | Pendente |
| 6 | v0.3.1 | Experimento: notificação do Windows, bandeja, barra de tarefas e iniciar com o Windows | Pendente |
| 7 | v0.3.1 | API: conversas privadas e a permissão por canal | Pendente |
| 8 | v0.3.1 | API: tempo real com destinatário | Pendente |
| 9 | v0.3.1 | API: lidas, menções e silenciar | Pendente |
| 10 | v0.3.1 | API: status | Pendente |
| 11 | v0.3.1 | App: a lateral direita com abas | Pendente |
| 12 | v0.3.1 | App: as conversas (lista, janela embaixo, abas) | Pendente |
| 13 | v0.3.1 | App: não lidas e a linha "novas mensagens" | Pendente |
| 14 | v0.3.1 | App: menções e silenciar | Pendente |
| 15 | v0.3.1 | App: notificações, sons e a aba Notificações | Pendente |
| 16 | v0.3.1 | App: status e iniciar com o Windows | Pendente |
| 17 | v0.3.1 | Lançamento da `0.3.10` | Pendente |
| 18 | v0.3.2 | Experimento: a janela de ligação recebida com o app fechado | Pendente |
| 19 | v0.3.2 | API: ligações (sinalização, token, webhook, registro) | Pendente |
| 20 | v0.3.2 | App: ligar e receber | Pendente |
| 21 | v0.3.2 | App: a tela da ligação e a tela compartilhada | Pendente |
| 22 | v0.3.2 | App: o fim da ligação, a chamada perdida e o Ocupado | Pendente |
| 23 | v0.3.2 | Lançamento da `0.3.20`, depois da v0.2.5 | Pendente |

Dependências: a 2 usa a lista da 1, e a 4 usa o cartão da 3. A 6 é um experimento e anda desde o começo, em
paralelo com a v0.3.0. Na v0.3.1, a 8 usa a 7, a 9 usa a 8, e o app (11 a 16) pode começar pela 11 enquanto a
API anda. A v0.3.2 inteira depende da v0.3.1; a 23 depende também da v0.2.5 (decisão 20).

Branches: uma por entrega (`feature/0.3.0`, `feature/0.3.1`, `feature/0.3.2`), um pull request por etapa
para dentro dela. As etapas de API que só acrescentam rotas e eventos (7 a 10 e 19) também vão para a `dev`
logo que ficam prontas: o app instalado ignora eventos que não conhece (`RealtimeBridge.tsx`). O app só é
publicado nas etapas de lançamento, que levam a branch para a `dev` (beta) e depois para a `main`.

## Decisões

As decisões de arquitetura estão nas ADRs, que são a fonte:

- [`0020-lista-de-canais-e-menu-do-usuario.md`](docs/adr/0020-lista-de-canais-e-menu-do-usuario.md): o modo Organizar, os menus e o volume individual (atualiza o
  "No app" da ADR 0016).
- [`0021-conversas-privadas-e-permissao-por-canal.md`](docs/adr/0021-conversas-privadas-e-permissao-por-canal.md): o canal `dm`, os membros do canal, a regra de leitura e
  o tempo real com destinatário (a revisão que a ADR 0015 já previa).
- [`0022-lidas-mencoes-e-notificacoes.md`](docs/adr/0022-lidas-mencoes-e-notificacoes.md): o que é lido, a menção, o silenciar, o status e quem decide se uma
  notificação aparece.
- [`0023-ligacoes-privadas.md`](docs/adr/0023-ligacoes-privadas.md): a sala, a sinalização, o toque e o registro.

### Combinado (08/11 e 10/11)

O desenho das conversas e da ligação foi fechado em 08/11, no canvas (linhas "Conversas na lateral direita" e
"Ligação privada"). Ficaram descartados: a coluna de ícones à esquerda, as abas na barra de título, o verde
para a ligação e a seção "Em ligação" na lateral esquerda.

- **A v0.3 são as conversas privadas**, e as notificações e menções da v0.5 vêm junto, porque usam a mesma
  base (até onde cada um leu e o caminho da notificação).
- **As conversas ficam na lateral direita:** abas Membros e Conversas, e a conversa aberta numa janela
  embaixo, encostada na lateral.
- **A lista de canais sai igual à do canvas** ("Canais — categorias e ordem"). A API e o modelo de hoje ficam.
- **O menu do usuário entra**, com o volume individual. A seção Moderação e "Mover para outra sala" não.
- **Um "não perturbe" mínimo:** o status Ocupado, que cala avisos, sons e o toque de ligação.
- **Não lidas visíveis com a janela fechada** (bandeja e barra de tarefas), **sons e a aba Notificações**, e
  **a linha "novas mensagens"** no histórico.
- **A VPS (v0.2.5) vem antes de publicar as ligações.**
- **Testar a notificação do Windows no começo da v0.3.1**, antes de desenhar o resto em cima dela.
- **Carona do BACKLOG na v0.3.0:** o tempo limite do pedido de token e a versão mínima do app.

### Decidido neste plano

**Lista de canais e menu do usuário (v0.3.0)**

1. **Arrastar só no modo Organizar.** Fora dele, a lista não tem alça nem "…": passando o mouse, a categoria
   mostra o + e o canal a engrenagem, por cima da linha. No modo, o app arruma uma cópia da árvore e manda um
   `PUT /api/channels/layout` só, no Concluir. Desfazer joga a cópia fora. Um 409 (alguém mexeu no meio)
   recarrega a árvore e mantém o modo aberto, com um aviso.
2. **"Mover para" no lugar de "Mover para cima/baixo".** O menu do canal (engrenagem ou botão direito) tem
   Editar, Mover para (as categorias e "Sem categoria", a atual marcada) e Arquivar. O Silenciar canal do
   quadro entra na v0.3.1, na mesma posição.
3. **O nome do servidor vira o menu de quem gerencia:** Convidar pessoas, Criar canal, Criar categoria,
   Organizar canais e Canais arquivados. Cada um vê só o que pode: o Convidar continua só do dono, e quem
   não é dono nem gerencia canais não tem menu.
4. **O `ChannelNav.tsx` (784 linhas) é dividido** dentro de `features/server/components/`, onde a ADR 0014 pôs
   a coluna: a lista, a linha de canal, a linha de categoria, quem está na sala, os menus e o menu do
   servidor.
5. **Um cartão só para o usuário**, na lista de membros e na lista da sala (`PersonCard`), que cresce para
   baixo. Na v0.3.0 ele mostra o nome, o nick, onde a pessoa está e o volume; os botões Mensagem e Ligar
   entram na v0.3.1 e na v0.3.2.
6. **Volume individual de 0 a 200%, só para quem ajusta**, guardado no computador por pessoa. Aparece no
   cartão de quem está na mesma sala e clicando no bloco da pessoa na grade. Clicar no alto-falante silencia
   só para você e, de novo, volta ao valor anterior. Acima de 100% usa o mesmo caminho com ganho do som da
   transmissão (`useShareAudio.ts`), que passa a servir às duas coisas.
7. **A marca no bloco:** a porcentagem, ou o alto-falante vermelho, quando o volume não está em 100%.

**Conversas privadas (v0.3.1)**

8. **A conversa privada é um canal de tipo `dm`**, com as mesmas mensagens, o mesmo envio e o mesmo
   histórico dos canais de texto. Ela não tem nome, categoria nem posição, e nunca aparece no
   `GET /api/channels` nem no layout. A migração `0004` refaz a tabela `channels` para aceitar o tipo novo (o
   SQLite não altera um `CHECK`) e cria `channel_members`. Um par de pessoas tem uma conversa só, garantida
   por uma chave única com os dois ids em ordem.
9. **Uma regra de leitura só.** Toda rota de mensagens passa por uma função que recebe quem pede: canal de
   texto, qualquer membro ativo; `dm`, só os dois. Para quem não é da conversa a resposta é 404, igual a um
   id que não existe.
10. **Rotas novas:** `POST /api/dms` (abre a conversa com alguém, ou devolve a que já existe) e
    `GET /api/dms` (as suas conversas, com a outra pessoa, a última mensagem e as não lidas). Enviar e ler
    continuam em `/api/channels/{id}/messages`.
11. **O tempo real ganha destinatário.** Cada evento do `Hub` sai para todos ou para uma lista de pessoas, e
    cada conexão descarta o que não é dela. Os eventos de uma conversa privada só saem para os dois. O
    `ready` de cada conexão só traz os canais que a pessoa lê. Testes de integração abrem três conexões e
    conferem que a terceira não recebe nada, nem pelo socket nem pelo REST.
12. **Texto puro, e avisado.** As mensagens privadas ficam no banco como as outras. O começo de toda conversa
    mostra uma linha fixa dizendo isso.
13. **Quem saiu do grupo:** a conversa continua na lista de quem ficou, só para leitura, com "(saiu do
    grupo)".

**Lidas, menções, silenciar e status (v0.3.1)**

14. **"Lido" é um ponteiro por pessoa e por canal**, no servidor (`channel_state`: a última mensagem lida e
    se está silenciado). O app marca como lido quando o canal está aberto, a janela em foco e o fim do
    histórico à vista, ou quando a pessoa pede ("Marcar como lido" e "Marcar tudo como lido"). As não lidas são as mensagens dos outros depois do ponteiro. O `ready` traz, para cada
    canal e conversa, o ponteiro, as não lidas e as menções.
15. **A menção é `@nick`, resolvida pela API no envio.** O nick é único e não muda; o app mostra o nome
    visível. A mensagem leva a lista de quem foi mencionado, e a API guarda as menções para contar as não
    lidas de cada um. Sem `@todos` nesta fase.
16. **Silenciar** cala o aviso, o som e o número do canal ou da conversa, mas a menção passa. Fica no
    servidor, junto do ponteiro.
17. **Três status:** Disponível, Ocupado e Invisível, guardados no servidor. Ocupado aparece para os outros
    (bolinha vermelha) e, no app de quem escolheu, cala avisos, sons e notificações do Windows; as não lidas
    continuam contando. Invisível é resolvido na API: os outros recebem a pessoa como offline.
18. **O app decide se notifica, num lugar só** (`features/notifications`): olha o status, o silenciar, as
    chaves da aba Notificações, se a janela está em foco e qual canal está aberto. Com a janela à vista, o
    aviso é o do canto do app; minimizada ou na bandeja, é a notificação do Windows. "Começou a transmitir"
    sai do `voice.participants` que o app já recebe, sem rota nova.
19. **A lateral sai do chat e vai para a casca do app**, com 300 de largura: hoje a `PeopleColumn` só existe
    dentro do `ChatView`, e o canvas a mostra também na sala de voz, minimizada.

**Ligações privadas (v0.3.2)**

20. **Só é publicada com o LiveKit na VPS** (v0.2.5). No LiveKit Cloud, cada ligação com tela compartilhada
    são até quatro conexões contando minutos.
21. **A sala da ligação é a própria conversa.** O token da voz e o da `:screen` passam a aceitar uma conversa
    `dm` de que a pessoa faz parte, além das salas de voz. O webhook do LiveKit de uma sala privada só avisa
    os dois.
22. **A sinalização é da API:** chamar, atender, recusar, cancelar e desligar são rotas, e os eventos
    (`call.ringing`, `call.accepted`, `call.ended`) saem só para os dois. Sem resposta em 30 s vira chamada
    perdida. Se os dois ligarem um para o outro ao mesmo tempo, a segunda chamada atende a primeira.
23. **O registro é uma mensagem de sistema na conversa** (tipo `call`), com o resultado e a duração. Ela
    conta como não lida quando a chamada foi perdida.
24. **Uma conexão de voz por vez.** Atender ou ligar estando numa sala sai da sala; estando transmitindo,
    o aviso é obrigatório e diz quantos estão assistindo. O aviso comum tem "Não perguntar de novo".
25. **Quem liga nunca vê "ocupado"**, e os outros membros não veem que os dois estão em ligação: eles só
    saem da lista da sala.
26. **A tela da ligação é a `VoiceRoom`**, com outro cabeçalho e sem Convidar. A tela compartilhada usa o
    publicador nativo como está, com a trava de uma transmissão por vez valendo por sala.

---

**Critério de pronto da fase:** o "pronto quando" das três etapas de lançamento (5, 17 e 23), os testes de
vazamento passando no pipeline, e todos os itens do `NOTES.md` resolvidos ou conscientemente adiados.
