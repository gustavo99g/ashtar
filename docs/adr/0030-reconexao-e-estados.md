# 0030 — Reconexão, estados de conexão e logs

- **Status:** proposta (passa a aceita com o teste de três computadores da Etapa 11 da v0.6)
- **Data:** 2026-11

## Contexto

Até a v0.5, o app se recuperava das quedas curtas que o `livekit-client` resolve sozinho, e só. Quando o LiveKit
desistia, a voz ficava em "Sem conexão com a sala" até a pessoa clicar; quando a conexão `:screen` do publicador
nativo (ADR 0017) caía, a transmissão acabava; um microfone USB desconectado caía no padrão do Windows sem aviso; e a
queda da API não aparecia em lugar nenhum, só nas telas que falhavam. Quando algo dava errado, o dono pedia a pasta de
logs pelo WhatsApp.

## Decisão

**A voz volta sozinha.** Um `Disconnected` que não foi pedido, nem é a sala arquivada, nem a pessoa tirada, movida
ou sem acesso (ADRs 0026 e 0028), não limpa a sala: o app pede um token novo e entra de novo na mesma sala, com
esperas de 1, 2, 5, 10, 20 e 30 segundos, e a cada 30 até 5 minutos. O painel mostra "Reconectando…". O mute e o
surdo voltam como estavam; a câmera não volta (ADR 0025: nunca liga sozinha). O Windows voltando da suspensão força
uma tentativa na hora.

**A transmissão nativa volta sozinha.** Quando a `:screen` cai e a voz continua, o Rust entra de novo com um token
novo e republica as trilhas, sem parar a captura nem o encoder. Se a voz também caiu, espera a voz voltar. Depois de
2 minutos, acaba como antes.

**Dispositivos:** o escolhido que some passa para o padrão do Windows na hora, sem sair da sala, com um aviso; quando
volta, troca de volta e o aviso some. Sem microfone nenhum, a pessoa fica na sala mutada.

**"Sem conexão com o servidor"** é uma faixa no alto da janela, quando o WebSocket passa de 5 segundos sem
conectar, com a próxima tentativa e Tentar agora. Ao voltar, o app recarrega canais, membros, não lidas e o canal
aberto. A voz não depende da faixa. A API ganha tempo limite de 30 segundos por pedido (120 no upload de logs).

**A qualidade da conexão** aparece só quando está ruim: o ícone de sinal no bloco e na lista da sala, do
`ConnectionQuality` que o LiveKit calcula para cada participante. Os números (ping e perda de pacotes) vêm da própria
pessoa, numa mensagem de dados da sala a cada 5 segundos (`voice.stats`), e aparecem no cartão dela.

**"Enviar logs"** junta os logs dos últimos 2 dias num `.zip` (no Rust), com um texto opcional, e manda para a API
(`POST /api/logs`, até 10 MB, um a cada 5 minutos por pessoa). A API grava o arquivo ao lado do banco e guarda 30
dias. Só o dono vê e baixa, numa tela Logs do Painel de controle, e recebe um aviso quando chega um.

## Alternativas consideradas

- **Reconectar só pelo `livekit-client`:** ele já tenta por uns 20 segundos e desiste; uma queda de roteador passa
  disso.
- **Reconectar para sempre:** uma sala que nunca mais vai existir (servidor fora) deixaria o painel girando; 5
  minutos e depois o Tentar de novo de sempre.
- **O `ConnectionQuality` só, sem números:** diz que está ruim, mas não se é perda ou atraso.
- **Medir a conexão dos outros pelo próprio `getStats`:** só mostra o caminho até o servidor de quem mede, não o
  da outra pessoa.
- **Logs para um serviço de fora** (Sentry e parecidos): os logs saem para terceiros, e o grupo é pequeno o bastante
  para o dono olhar.

## Consequências

- O `VoiceProvider` passa a distinguir os motivos de saída da sala; um motivo novo do LiveKit precisa entrar na lista
  de "não volta".
- O publicador nativo (ADR 0017) ganha um estado novo, "reconectando", e o app responde ao pedido de token dele.
- O app antigo não manda `voice.stats`: o cartão mostra só o ícone.
- A pasta `data/logs/` da API não entra no backup (são de 30 dias).
- Sinal para rever: a reconexão trazendo de volta quem não devia, ou a faixa aparecendo em quedas que ninguém
  sentiu.
