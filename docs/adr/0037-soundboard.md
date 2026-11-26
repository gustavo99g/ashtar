# 0037 — Soundboard

- **Status:** proposta (passa a aceita com os testes M17, M18 e A21 a A23 da noite de teste da v0.9)
- **Data:** 2026-11

## Contexto

O soundboard estava em "Depois da v1.0". O Kid pediu em 24/11 para ele entrar na v0.9, antes da `0.9.0`, e desenhou
com o Claude no canvas (linha "Release Candidate (0.9)": "Soundboard — tocar sons", "Soundboard — atalhos", "Sons —
aba Meus sons e editor", "Sons — aba Aprovação", "Sons — aba Todos os sons" e "Sons — arrastando um arquivo"). Os
emojis do grupo (v0.7) são o modelo: arquivo na tabela `files`, uma permissão e uma tela de gerenciar.

## Decisão

**Os sons são do grupo**, até 50 aprovados. Um som tem arquivo (`kind` novo `sound` em `files`), nome (até 24
caracteres, sem repetir o de outro som aprovado ou aguardando, sem diferenciar maiúscula), emoji, quem enviou e a
situação: `pending`, `approved` ou `rejected`, com o motivo e quem decidiu.

**Duas permissões.** "Enviar sons" (`sons.enviar`) vem ligada para todo mundo: a migração dá a quem já está no grupo, e
entrar por convite dá a quem chega; dá para tirar em Membros. "Aprovar sons" (`sons.aprovar`) aprova, recusa, renomeia
e exclui qualquer som. O dono tem as duas.

**O envio passa por aprovação.** O enviado fica `pending`, com até 3 aguardando por pessoa; quem tem "Aprovar sons"
envia direto como aprovado. Aprovar ou recusar (motivo opcional) avisa quem enviou pelo tempo real. O recusado fica na
lista da pessoa, com o motivo, até ela apagar ou reenviar. Aprovar com 50 sons no grupo é recusado.

**Uma tela, Configurações › Servidor › Sons**, com abas pela permissão: "Meus sons" (todos), "Aprovação" e "Todos os
sons" (só com "Aprovar sons"). O botão é "Carregar som", e arrastar um arquivo na tela faz o mesmo.

**O editor fica no app.** O app decodifica o arquivo (MP3, OGG ou WAV, até 10 MB) com o Web Audio e mostra a onda com
duas alças para escolher até 5 s, o play do trecho, um volume (-12 a +6 dB), "Igualar volume" (normaliza o pico) e
"Suavizar início" e "Suavizar fim". O que sobe é o trecho editado, em WAV mono 16 bits de 48 kHz (5 s dão uns 470 KB),
sem precisar de codificador no app. A API confere de novo: WAV, até 5 s pela duração lida do cabeçalho e até 1 MB.

**Tocar é um aviso da API, e cada app toca o seu arquivo.** `POST /api/voice/sounds/{id}/play` aceita só som aprovado,
de quem está numa sala de voz ou numa ligação e não está com os sons bloqueados, e manda o `voice.sound_played` para
quem está no mesmo lugar. Cada app toca o arquivo que guardou, no volume do soundboard. Limite por pessoa na API: um
som a cada 3 s e no máximo 5 a cada 30 s. Quem tocou ganha a onda dourada na lista e no bloco, sem o nome do som.

**Bloquear sons é moderação de voz** (ADR 0034): quem tem "Moderar voz" bloqueia e libera os sons de alguém pelo
cartão na sala. Vira a coluna `sounds_blocked` em `voice_moderation` e vale como o silenciar: em todas as salas do
grupo até alguém liberar, e não nas ligações privadas. Vai para o registro.

**A grade e os atalhos:** o botão Sons fica no painel de voz e na barra da chamada. A grade tem 4 colunas, busca e
volume; a primeira linha tem 4 lugares, cada um com um atalho global (padrão Ctrl + Alt + 1 a 4). Arrastar um som
para um lugar põe ele lá, e o botão direito tem "Pôr no lugar 1–4". Os lugares ficam no PC de cada um. Um som excluído
que estava num lugar deixa o lugar vazio.

**Para quem ouve, só a chave geral e o volume**, em Configurações. Nada de silenciar os sons de uma pessoa.

## Consequências

- É recurso novo dentro do RC: entra inteiro antes da `0.9.0` e, depois do beta, só recebe correção.
- O app antigo ignora o `voice.sound_played`; quem está nele não ouve os sons, e nada quebra.
- Os sons entram no backup junto das fotos e dos emojis (ADR 0036).
- Eco, tom e outros efeitos, sons por sala e silenciar uma pessoa ficam fora.
