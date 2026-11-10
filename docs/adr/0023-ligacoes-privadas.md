# 0023 — Ligações privadas

- **Status:** proposta (falta o resultado do experimento da ligação recebida, Etapa 18 da v0.3)
- **Data:** 2026-11

## Contexto

A última parte da v0.3 é a ligação entre duas pessoas, a partir da conversa privada (ADR 0021): tocar,
atender, recusar, chamada perdida, tela compartilhada dentro dela e um registro no histórico. O desenho foi
fechado em 08/11, no canvas (linha "Ligação privada").

A voz do app é uma conexão do WebView com uma sala do LiveKit, cujo nome é o id de um canal de voz (ADR 0016), e
a tela é uma segunda conexão, `{user_id}:screen`, publicada do Rust (ADR 0017). O app fica numa sala por vez. O
webhook do LiveKit avisa a API de quem entrou e saiu, e a API repassa a lista a todos (ADR 0015). No LiveKit
Cloud gratuito, cada conexão conta minutos.

## Decisão

**A sala da ligação é a própria conversa:** o nome da sala no LiveKit é o id da `dm`. O `POST /api/voice/token`
e o `/voice/screen-token` passam a aceitar esse id, só para os dois e só com a ligação atendida.

**A sinalização é da API.** Chamar, atender, recusar, cancelar e desligar são rotas sob
`/api/dms/{id}/call`, e os eventos `call.ringing`, `call.accepted` e `call.ended` saem só para os dois, pelo
`publish_to` (ADR 0021). A tabela `calls` guarda cada ligação, com no máximo uma em andamento por conversa.

**30 segundos tocando sem resposta viram chamada perdida.** Ao subir, a API fecha as ligações que ficaram
abertas.

**Os dois ligando ao mesmo tempo viram uma ligação só:** a segunda chamada vale como atender a primeira.

**A ligação acaba quando um dos dois sai.** O webhook da sala privada não vira `voice.participants` para
todos: ele encerra a ligação, e a API apaga a sala para o outro não ficar sozinho nela.

**O registro é uma mensagem de sistema na conversa** (`messages.kind = 'call'`), com o resultado e a duração.
A chamada perdida conta como não lida para quem não atendeu.

**Uma conexão de voz por vez.** Quem atende estando numa sala sai dela (o botão vira "Sair e atender"); quem
liga só sai da sala quando a outra pessoa atende. Transmitindo, o aviso é obrigatório e diz quantos estão
assistindo. Entrar numa sala durante a ligação avisa que ela vai ser encerrada. Ao fim, ninguém volta sozinho:
quem estava numa sala vê "Voltar para a sala".

**Quem liga nunca vê "ocupado",** e os outros membros não ficam sabendo da ligação: os dois só saem da lista
da sala.

**Para quem está offline, o botão Ligar fica apagado.** Quem está Invisível aparece offline, então também não
recebe ligação.

**Em Ocupado, a ligação não toca:** sem cartão, som nem notificação. Aparece só o avatar dourado na lateral,
e a conversa mostra a faixa Recusar e Atender.

**A tela da ligação é a da sala** (`VoiceRoom`), com outro cabeçalho e sem Convidar. A tela compartilhada usa
o publicador nativo como está, e a trava de uma transmissão por vez vale por sala.

**Só é publicada com o LiveKit na VPS** (v0.2.5): uma ligação com tela compartilhada dos dois lados são até
quatro conexões contando minutos.

**A ligação recebida com a janela fechada:** a decidir pelo experimento da Etapa 18 (a notificação do Windows
com botões, ou uma janela própria, pequena, sempre no topo, que não rouba o foco). O resultado entra aqui.

## Alternativas consideradas

- **Sinalizar pelo LiveKit** (os dois já na sala, um "tocando" por mensagem de dados): quem recebe teria de
  estar conectado a uma sala para saber que está sendo chamado, e a ligação não tocaria com o app parado.
- **Uma sala com nome próprio** (`call-<id>`): a regra de quem pode entrar teria de ser escrita de novo. Com
  o id da conversa, é a regra de leitura que já existe.
- **O registro numa tabela à parte, juntado ao histórico no app:** o app teria de intercalar duas listas com
  cursores diferentes. Como mensagem, o registro já vem na ordem, na paginação e na reconexão.
- **Ficar na sala e na ligação ao mesmo tempo:** duas conexões de voz, dois microfones abertos e a dúvida de
  quem está ouvindo o quê. O Discord também não deixa.
- **Mostrar "em ligação" para os outros:** é privada; o desenho só tira os dois da lista da sala.
- **Tocar para quem está offline e registrar a perdida:** a pessoa abriria o app com uma chamada perdida de
  horas atrás. Uma mensagem resolve melhor.
- **Quem liga sair da sala ao chamar:** sairia à toa numa chamada perdida.
- **Publicar no LiveKit Cloud:** funciona, mas a cota gratuita já aperta com a `:screen` (ADR 0017).

## Consequências

- O `VoiceProvider` passa a saber de que tipo é a conexão: sala ou ligação.
- O webhook precisa separar sala de voz de conversa privada antes de publicar qualquer coisa: um erro ali
  conta a todos quem está falando com quem. Tem teste com a terceira conexão.
- A mensagem ganha um tipo. Um app antigo mostra o texto "Ligação" no lugar do registro.
- Uma ligação presa (o app de alguém caiu) se resolve pelo webhook, pelo tempo limite e pela limpeza ao subir a
  API.
- A v0.3.2 depende da v0.2.5.
- Rever se entrarem os grupos privados (mais de duas pessoas): "acaba quando um sai" deixa de valer.
