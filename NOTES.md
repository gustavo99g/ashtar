# NOTES — pendências da v0.5 (salas e presença)

Lista de verificação da fase descrita no [`PLAN.md`](PLAN.md). Cada item deve
ser resolvido ou conscientemente adiado (marcar como tal) antes de fechar a entrega em que ele está.

## Antes de começar

- [x] **A v0.4 na `dev`.** O PR #20 entrou na `dev` (`f98f84a`), e a fase começou dela. O `PLAN.md` e o `NOTES.md`
      da v0.3 e o plano da v0.4 foram para `docs/plans/`; os `[ ]` que sobraram ficam resolvidos ou adiados lá.
- [ ] **O canvas:** conferir se o quadro "Criar canal" tem a escolha Texto/Voz e se existe desenho para o Ausente,
      o "digitando…" e o arrastar entre salas. O que faltar segue o estilo dos quadros vizinhos.

## Parte 1 — salas

### API

- [ ] **Arquivar uma sala com gente dentro** tira também as conexões `:screen`, não só as de voz.
- [ ] **Mover quem está saindo da sala** no mesmo instante: o 409 de "em nenhuma sala" não pode virar erro na tela
      de quem moveu.
- [ ] **A remoção dos 10 segundos** é cancelada quando a pessoa sai da sala antiga sozinha, e não tira ela da sala
      nova se as duas tiverem o mesmo id de conexão.
- [ ] **`membros.mover` no Painel** e no `admin permissoes`, e no `README.md` do `deploy/server/`.

### App

- [ ] **Nenhum `SALA` sobra** fora dos testes, inclusive no `UpdateNotice` (o aviso de atualização que espera a
      pessoa sair da sala).
- [ ] **Trocar de sala rápido**, várias vezes seguidas: a pessoa nunca fica em duas salas, nem em nenhuma.
- [ ] **Trocar de sala com o token falhando** (API fora): a pessoa fica na sala antiga, com o erro, e não sem sala.
- [ ] **A transmissão que acaba ao trocar:** quem assistia na sala antiga vê ela acabar normalmente.
- [ ] **O "Voltar para a sala"** depois de uma ligação volta para a sala de onde a pessoa saiu, e some se ela foi
      arquivada no meio.
- [ ] **Ser movido no meio de uma pergunta** (o diálogo de trocar transmitindo aberto): o `voice.moved` ganha.
- [ ] **Ser movido estando numa ligação privada:** a API recusa (409), e o cartão nem mostra "Mover para".
- [ ] **A reconexão automática** não traz de volta quem foi desconectado.
- [ ] **O arrastar não briga** com o clique no avatar (que abre o cartão) nem com o modo Organizar.
- [ ] **A categoria recolhida** com gente na sala (o `AvatarStrip`): dá para arrastar dali também? Decidir.
- [ ] **Os textos** de criar sala, do aviso de trocar transmitindo, de "Mover para", "Desconectar da voz", "fulano
      moveu você", "Você foi desconectado" e "A sala foi arquivada", revisados.

### Canais e salas restritos

- [ ] **Nenhum vazamento por evento:** passar todos os tipos do `ServerEvent` pelo filtro, com um teste que falha
      quando entra um tipo novo com `channel_id` sem passar por ele.
- [ ] **O "começou a transmitir"** de uma sala restrita não chega a quem está fora.
- [ ] **A busca de mensagens da v0.7** já nasce passando pela `can_access` (anotar na ADR 0028).
- [x] **Quem gerencia vê tudo** (decisão 16): confirmado em 19/11. O dono tem todas as permissões e faz todas as
      ações, em tudo.
- [ ] **Um canal restrito e arquivado:** continua escondido nos Canais arquivados para quem está fora.
- [ ] **Quem saiu do grupo** sai de todas as listas.
- [ ] **O "Voltar para a sala"** depois de uma ligação, se a pessoa perdeu o acesso no meio: some.
- [ ] **O modo Organizar** de quem gerencia mostra os restritos com o cadeado, e a ordem gravada não muda a dos
      outros.
- [ ] **A lista com muita gente** no diálogo: rola e tem busca.

## Parte 2 — presença e sons

### Ausente

- [ ] **O `GetLastInputInfo`** conta o mouse e o teclado de qualquer janela, inclusive de um jogo em tela cheia
      exclusiva. O controle não conta, e por isso a regra da sala (decisão 11).
- [ ] **Computador bloqueado ou dormindo:** a conexão cai e a pessoa fica offline, não Ausente. Conferir que, ao
      voltar, não fica presa em Ausente.
- [ ] **Duas conexões da mesma pessoa** (reconexão no meio): o hub não deixa uma conexão velha ociosa travar o
      Ausente.
- [ ] **O app antigo** (`0.4.x`) não manda `idle`: aparece sempre Disponível. Aceito durante o beta.
- [ ] **A bolinha amarela** em todos os lugares em que a de status aparece, com o contraste conferido.

### Digitando

- [ ] **Quem perde a permissão do canal** no meio para de receber o `typing` dele.
- [ ] **O Invisível** não manda nada, nem nas conversas privadas.
- [ ] **Colar um texto grande** conta como digitar, uma vez.
- [ ] **A linha reservada** embaixo da caixa não pula a conversa quando aparece e some.

### Sons

- [ ] **Os sons gerados** no mesmo volume dos de hoje (`dm.wav`, `mention.wav`, `ring.wav`), conferidos no fone e na
      caixa de som.
- [ ] **Entrar numa sala cheia** toca um som só, e não um por pessoa que já estava.
- [ ] **Trocar de sala** não toca a saída de todo mundo da sala velha.
- [ ] **Os sons tocam na saída escolhida** em Voz e vídeo, como os da voz.
- [ ] **Ocupado** não cala os sons da sala, mas continua calando os de mensagem e menção.

## Riscos e cuidados

- [ ] **A troca de sala é a parte mais delicada da fase.** Hoje entrar e sair são caminhos separados, com a
      ligação no meio; a troca junta os dois sem passar pela tela vazia, e precisa da mesma limpeza (transmissão,
      câmera, `watching`, miniatura). Os testes do `VoiceProvider` cobrem a troca antes do resto.
- [ ] **Mover é poder sobre os outros.** Só quem tem a permissão, nunca para dentro de uma ligação privada, e a
      pessoa sempre fica sabendo quem moveu ou desconectou.
- [ ] **A presença não pode contar o que a pessoa faz.** O Ausente diz só que ela parou de mexer, nunca o que estava
      aberto, e o Invisível não aparece em nada novo (nem digitando, nem ausente).
