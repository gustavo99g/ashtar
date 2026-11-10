# 0020 — A lista de canais sem ferramentas fixas e o cartão do usuário

- **Status:** aceita
- **Data:** 2026-11

## Contexto

A árvore de canais da v0.2.3 (ADR 0016) deixa tudo à vista para quem gerencia: cada linha reserva espaço para a
alça de arrastar e para o "…", o arrasto acontece direto na lista e grava a cada soltura, e o menu tem "Mover para
cima" e "Mover para baixo". Com uns dez canais a coluna fica carregada, um clique mal dado arrasta um canal sem
querer, e cada arrasto é um `PUT /api/channels/layout` (e um `channels.changed` para o grupo inteiro). "Criar
canal" e "Criar categoria" moram no fim da lista, longe do resto.

O cartão que abre ao clicar em alguém (`PersonCard`) só existe na lista da sala de voz e só mostra o nome, o
nick e onde a pessoa está. A v0.3 precisa de um lugar para "Mensagem" e "Ligar", e o grupo pede há tempo o volume
por pessoa, que o roadmap tinha na v0.5.

O desenho novo está no canvas "Clone do Discord — telas", nas linhas "Canais — categorias e ordem" e "Menu do
usuário".

## Decisão

**A lista não tem ferramentas fixas.** Nenhuma linha reserva espaço para alça ou "…". No hover e no foco pelo
teclado, a categoria mostra o + (criar canal nela) e o canal a engrenagem, por cima da linha. Quem não gerencia
canais não vê nenhum dos dois.

**O nome do servidor é o menu de quem gerencia:** Convidar pessoas (só o dono), Criar canal, Criar categoria,
Organizar canais e Canais arquivados. Cada um vê só o que pode; quem não tem nenhum item não ganha menu.

**O menu do canal** abre pela engrenagem ou pelo botão direito: Editar canal, Mover para (um submenu com "Sem
categoria" e as categorias, a atual marcada) e Arquivar canal. "Mover para" leva o canal para o fim da categoria
escolhida. "Mover para cima" e "Mover para baixo" saem: a ordem fina é do modo Organizar.

**Arrastar só no modo Organizar.** O modo entra pelo menu do servidor. Nele, toda linha mostra a alça, o app
arruma uma cópia da árvore na memória, e só o Concluir grava, com um `PUT /api/channels/layout` e a versão que
a árvore tinha ao abrir o modo. Desfazer joga a cópia fora. Um 409 recarrega a árvore, mantém o modo aberto e
avisa. No modo, clicar num canal não navega e os menus somem. O arrasto continua pelo `@dnd-kit`, com o
teclado.

**A API e o modelo da ADR 0016 não mudam:** a árvore de dois níveis, a versão, o 409, o arquivar e a
permissão `canais.gerenciar` são os mesmos. Muda só o "No app" daquela ADR.

**Um cartão só para o usuário**, na lista de membros e na lista da sala, num formato que cresce para baixo: o
cabeçalho (cor do nick, avatar, nome visível, nick e onde a pessoa está) e, embaixo, seções. Ações novas viram
linhas novas, sem mudar o resto. No próprio cartão não há ações.

**Volume individual, de 0 a 200%, só para quem ajusta.** Fica no computador de cada um, por id de pessoa, e
vale para a voz dela. Aparece no cartão de quem está na mesma sala e no clique do bloco da pessoa na grade.
O alto-falante silencia só para você e, de novo, volta ao valor anterior. Acima de 100%, o som passa pelo
mesmo `AudioContext` com ganho do volume da transmissão (v0.2.4), que passa a servir às duas coisas. O bloco de
quem não está em 100% ganha uma marca, que só você vê. O "ficar sem áudio" continua calando todas as vozes.

## Alternativas consideradas

- **Manter o arrasto direto na lista:** é um passo a menos, mas mantém a alça em toda linha, os arrastos sem
  querer e um pedido por soltura.
- **Gravar cada soltura mesmo dentro do modo:** o Desfazer teria de mandar a ordem antiga de volta, e o grupo
  veria a lista pular a cada passo.
- **Guardar o volume de cada pessoa no servidor:** seguiria a pessoa na recuperação da conta, mas é uma
  preferência de escuta deste computador e destes fones, e a API não tem por que saber quem baixou o volume de
  quem.
- **Silenciar alguém para todos** (a seção Moderação do canvas): muda o que os outros ouvem, pede permissão
  nova e um comando no servidor de voz. Fica para a moderação da v0.8.
- **Um cartão para a lista de membros e outro para a sala:** as ações (Mensagem, Ligar, volume) seriam
  escritas duas vezes.

## Consequências

- A coluna fica limpa para todos, e quem gerencia tem um lugar só para cada coisa: o menu do servidor para
  criar e organizar, o menu do canal para o que é de um canal.
- Reordenar passa a ser um pedido e um `channels.changed`, em vez de um por arrasto.
- Enquanto alguém organiza, a cópia local não acompanha o que os outros mudam; o 409 do Concluir cobre o caso.
- O `ChannelNav.tsx` é dividido dentro de `features/channels`, pelo padrão da ADR 0014.
- O cartão é a porta das conversas privadas (ADR 0021) e das ligações (ADR 0023), que só acrescentam uma
  seção.
- Rever o volume no computador se a conta deixar de ser ligada a um computador só.
