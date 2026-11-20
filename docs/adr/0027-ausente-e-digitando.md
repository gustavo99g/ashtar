# 0027 — Ausente e "digitando…"

- **Status:** proposta (passa a aceita com o teste de três computadores da Etapa 15 da v0.5)
- **Data:** 2026-11

## Contexto

A v0.3 trouxe três status (Disponível, Ocupado e Invisível, ADR 0022). Faltava saber se alguém está longe do
computador, e, no chat, se alguém está escrevendo uma resposta. Os dois são presença: dizem que a pessoa está ou não
ali, nunca o que ela faz.

## Decisão

**Ausente é o quarto status**, com a bolinha amarela, nos mesmos lugares das outras. Tem dois jeitos:

- **manual**, no menu do status do painel (Disponível, Ausente, Ocupado e Invisível), gravado no servidor como os
  outros;
- **automático**, só para quem está Disponível: 10 minutos sem teclado nem mouse em todo o Windows
  (`GetLastInputInfo`, lido pelo Rust a cada 30 segundos). O app avisa a API só quando muda (`idle` no socket), e a
  API mostra Ausente para os outros sem mudar o status gravado. O primeiro toque volta a Disponível.

**Numa sala de voz, ninguém fica ausente sozinho**: quem joga de controle não toca no teclado. O Ausente manual
vale dentro da sala.

**Ausente não cala nada**: avisos, sons, notificações e o toque da ligação continuam. Quem cala é o Ocupado.

**"Digitando…"** aparece embaixo da caixa de texto do canal e da conversa privada ("fulano está digitando…", "fulano
e beltrano estão digitando…", "várias pessoas estão digitando…") e, na lista de conversas, no lugar da última
mensagem. O app manda `typing` pelo socket no máximo a cada 3 segundos enquanto a pessoa escreve; a API repassa
`typing { channel_id, user_id }` só para quem pode ler o canal, pela mesma regra de leitura, e nunca para a própria
pessoa. O app esquece quem digitava 6 segundos depois do último aviso, ou quando chega a mensagem dela. O Invisível
não manda.

**Os sons da sala** (sem ADR própria, entram na seção de sons da 0022): alguém entrou, alguém saiu, você mutou e
desmutou, ficou surdo e voltou, e alguém começou ou parou de transmitir na sua sala. Cada um tem uma chave em
Notificações, ligada por padrão, e tocam também em Ocupado. Entrar numa sala cheia toca um som só, e trocar de sala
não toca a saída de todo mundo da sala velha.

## Alternativas consideradas

- **Inatividade só no Ashtar** (foco da janela): quem está jogando ficaria Ausente o tempo todo.
- **O Ausente automático gravado como status:** um computador que dorme deixaria a pessoa Ausente para sempre; o
  `idle` é da conexão e some com ela.
- **"Digitando…" por REST:** um pedido por aviso, sem ganho; o socket já está aberto.

## Consequências

- O app antigo não manda `idle` nem `typing`: aparece sempre Disponível e nunca digitando. Aceito durante o beta.
- Duas conexões da mesma pessoa: ela só está Ausente quando todas as conexões dela estão.
- Sinal para rever: reclamação de Ausente no meio de uma partida fora da sala, ou o "digitando…" piscando demais.
