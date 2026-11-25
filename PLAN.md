# Plano — v0.9: Release Candidate

> As pendências estão em [`NOTES.md`](NOTES.md). O plano da v0.8 está em
> [`docs/plans/v0.8-atividade-e-moderacao.md`](docs/plans/v0.8-atividade-e-moderacao.md).

A v0.9 para de adicionar recursos e deixa o Ashtar pronto para a 1.0. O grupo já usa a 0.8.11 sem reclamar do que
funciona; o que falta é conferir o que o uso normal não exercita (convite vencido, formatar o PC, API ou LiveKit fora
do ar, restaurar o backup), fechar as centenas de itens de verificação que ficaram abertos desde a 0.2.4, e corrigir
o que aparecer. Entram só quatro ajustes pequenos, pedidos no uso real: o motivo certo quando um convite é recusado, o
cartão do link do convite no chat, a conversa privada um pouco mais larga e a transmissão assistida que continua
nas configurações. A exceção ao congelamento é o
**soundboard**, pedido pelo Kid: sons curtos do grupo, enviados por qualquer um e aprovados pelo dono, tocados na sala
e na ligação. Ele entra antes da `0.9.0`, para passar pelo mesmo teste que o resto. No servidor, o backup passa a levar
as fotos de perfil, os emojis e os sons, e a restauração é testada de verdade.

Sai como `0.9.0`, pelo beta antes do estável, igual às outras. As correções do RC saem como `0.9.x`.

| Parte | O que é | Mexe em |
|---|---|---|
| 1 | Arrumação: documentos, triagem das notas antigas, roteiro de testes | docs |
| 2 | Ajustes do uso real: convite recusado, cartão do convite, conversa mais larga | API e app |
| 3 | Soundboard: enviar, aprovar e tocar sons, com o editor e os atalhos | API e app |
| 4 | Servidor: backup das fotos, dos emojis e dos sons, restauração testada, produção revisada | API e deploy |
| 5 | Revisão antes da 1.0: dependências, limites, `admin`, textos | API, Rust e app |
| 6 | Teste com o grupo e correções | tudo |

**Objetivo da fase:** nenhum caminho principal do Ashtar quebra ou deixa alguém num estado sem saída, e o servidor
volta inteiro de um backup.

**Fora do escopo:** recurso novo além dos quatro ajustes e do soundboard (decisão do Kid, 24/11: só ajuste pequeno de
interface); efeitos no editor de som (eco, tom), silenciar os sons de uma pessoa só e sons por sala; anexos e prévias no backup (decisão do Kid, 24/11); assinatura de código do instalador, Linux, overlay e
o resto da lista "Depois da v1.0"; clipes e replay (v1.1).

Base: a `main` com a `0.8.11` (merge do PR #44, `b8fc1a0`). A correção da barra de tarefas na tela cheia
(`858da4a`, na `feature/0.8`) entra quando o Kid aprovar a `0.8.12` e ela passar pela `dev`. Em cada etapa,
`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` e `cargo test` (em `api/` e em
`desktop/src-tauri/`) e `pnpm lint`, `pnpm build` e `pnpm test` (em `desktop/`) devem passar, também pelo hook de
pre-push.

## O que já existe

Levantado na `main` (`b8fc1a0`), para o plano não refazer:

- **O convite recusado** é um erro só, `ApiError::InvalidInvite` ("Convite inválido, expirado ou já usado."), para
  código errado, vencido, revogado e esgotado. O `find_valid` (`identity/invites.rs`) faz tudo numa consulta, e o
  `redeem` e o `preview` passam por ele. A página do link no navegador (`routes/pages.rs`) também não diz o motivo
  ("Esse convite não vale mais") e conta a falha no limite de tentativas (`state.limiter`).
- **O link do convite** é `{PUBLIC_URL}/invite/CÓDIGO` (e `/recovery/CÓDIGO`), servido pela própria API, com as tags
  `og:` e o `ashtar://invite/CÓDIGO` para abrir o app. Fora do Ashtar (WhatsApp) ele já ganha prévia.
- **A prévia de links** da API recusa os endereços da própria VPS (`own_addresses` em `previews/mod.rs`), então o
  link do convite nunca ganha cartão dentro do Ashtar.
- **O `/download`** já existe (`routes/pages.rs`) e manda para o instalador da última versão estável. É o link para
  quem formatou ou trocou de PC; falta só ele estar à mão do dono.
- **A janela da conversa privada** tem `w-[380px]` e até 540 de altura (`dms/components/DmWindow.tsx`); as abas das
  outras têm 210 (`DmDock.tsx`), até três ao lado da lateral.
- **O backup** (`deploy/server/backup.sh`, todo dia às 22:30): `admin backup` faz o `VACUUM INTO` em `data/backups/`
  (as 14 mais recentes) e o `rclone` manda a cópia nova para o R2. Os arquivos (`data/files/`, ADR 0031) ficam fora.
  A restauração do banco está escrita no `deploy/server/README.md`, mas a dos arquivos não existe.
- **Os arquivos** têm um `kind` (`avatar`, `attachment`, `preview`, `emoji`) na tabela `files`, e o id é o nome no
  disco. Um arquivo nunca muda depois de gravado: trocar a foto grava outro id.
- **As notas antigas** têm cerca de 250 itens `[ ]` de verificação, da `v0.2.4-notes.md` à `v0.8-notes.md`. A raiz
  ainda tem o `NOTES.md` da v0.6, e o plano e as notas da v0.6 não estão em `docs/plans/`.
- **Os testes do roadmap** (M01–M10 e A01–A17) estão só listados no `docs/roadmap.md`, sem roteiro.
- **Os emojis do grupo** (v0.7) são o modelo para os sons: arquivo `emoji` na tabela `files`, permissão "Gerenciar
  emojis" (`emojis.gerenciar`) e o Painel › Emojis. As permissões guardadas (`identity/permissions.rs`) são dadas uma a
  uma; nenhuma vem ligada por padrão hoje.
- **A moderação na voz** (ADR 0034) guarda silenciado e surdo na tabela `voice_moderation`, por pessoa, valendo em
  todas as salas do grupo até alguém liberar, e não vale nas ligações privadas. Quem modera precisa de "Moderar voz".

## Progresso

| Etapa | O que | Situação |
|---|---|---|
| 0 | Documentos, roadmap, BACKLOG | Feito |
| 1 | Triagem das notas e roteiro de testes | Feito |
| 2 | API e app: o motivo do convite recusado | Feito |
| 3 | App: o cartão do convite no chat | Feito |
| 4 | App: a conversa mais larga, o link para baixar e a transmissão nas configurações | Feito |
| 5 | API: sons, envio e aprovação | Feito |
| 6 | API e app: tocar na sala e na ligação, atalhos e bloqueio | Feito |
| 7 | App: a tela Sons e o editor | Feito |
| 8 | Servidor: backup das fotos, dos emojis e dos sons | Feito |
| 9 | Servidor: restauração testada e produção revisada | Pendente |
| 10 | Revisão antes da 1.0 | Pendente |
| 11 | Lançamento da `0.9.0` no beta | Pendente |
| 12 | Noite de teste com o grupo | Pendente |
| 13 | Correções `0.9.x` e o estável | Pendente |

## Decisões

### Combinado (24/11)

- **A 0.9 é o Release Candidate.** Não entra recurso novo; entram ajustes pequenos de interface, sem tela nova.
- **O backup leva o banco, os emojis, as fotos de perfil e os sons**, todo dia, junto. Anexos e prévias ficam fora.
- **O cartão do link do convite** entra na 0.9.
- **A conversa privada** fica um pouco mais larga.
- **Lançamento** igual às outras: `0.9.0` no beta, depois o estável.
- **O soundboard entra na 0.9**, antes da `0.9.0` (desenhado no canvas, linha "Release Candidate (0.9)": "Soundboard
  — tocar sons", "Soundboard — atalhos", "Sons — aba Meus sons e editor", "Sons — aba Aprovação", "Sons — aba Todos
  os sons" e "Sons — arrastando um arquivo").

### Decidido neste plano

**Convite (parte 2)**

1. **O motivo da recusa vai para a pessoa.** O `InvalidInvite` ganha o motivo: `NotFound` ("Esse código não existe.
   Confira se copiou o link inteiro."), `Expired` ("Esse convite venceu. Peça um novo ao dono do grupo."), `Used`
   ("Esse convite já foi usado.") e `Revoked` ("Esse convite foi cancelado."). O `find_valid` vira `find_by_code`
   (só pelo hash) e uma conferência em Rust, que o `redeem`, o `preview` e a página usam, para os três nunca
   discordarem. O `kind` do erro continua `invalid_invite`, com um campo `reason` no corpo, para o app antigo seguir
   funcionando.
2. **Dizer o motivo não abre brecha.** O código tem entropia de sobra para ninguém achar um por tentativa, e toda
   recusa continua contando no limite de tentativas. Saber que um código existe e venceu não dá acesso a nada.
3. **A página do navegador** usa o mesmo motivo no título ("Esse convite venceu", "Esse convite já foi usado"…), e o
   código não encontrado fica com o texto de hoje.

**O cartão do convite (parte 2)**

4. **Quem monta o cartão é o app**, não a prévia da API. A proteção da VPS (`own_addresses`) não muda. O app reconhece
   no texto da mensagem os links `{PUBLIC_URL}/invite/CÓDIGO`, `{PUBLIC_URL}/recovery/CÓDIGO` e `ashtar://…`, e
   desenha o cartão embaixo, no lugar da prévia.
5. **Rota nova, só para quem está no grupo:** `GET /api/invites/preview/{código}`, autenticada, devolve o tipo, a
   pessoa (quem convidou, ou de quem é a conta na recuperação), a validade e a situação (`pending`, `expired`,
   `used`, `revoked`, `not_found`). Ela **não conta no limite de tentativas**, porque quem vê o cartão de um convite
   velho no histórico não está adivinhando código. A rota pública (`/invite/…`) continua contando.
6. **O cartão:** o ícone do Ashtar, "Convite de Kid para o Ashtar" (ou "Trocar de computador · conta de Fulano"), a
   validade em palavras ("Vale até amanhã, 08:00", a mesma função `valid_until`) e um botão Copiar link. Um convite que
   não vale mais fica apagado, com o motivo ("Venceu", "Já foi usado", "Cancelado"). Quem já está no grupo não tem o
   que fazer com o convite, então o cartão não tem botão de entrar. A situação é buscada ao mostrar e guardada por 1
   minuto, com até 5 cartões por tela.
7. **O link do convite não ganha também a prévia da API**: a API já não busca, e o app ignora prévias vindas de
   `{PUBLIC_URL}`.

**Ajustes de interface (parte 2)**

8. **A conversa privada passa de 380 para 440 px** de largura, com a mesma altura. Numa janela de 1280 px com a
   lateral aberta, a expandida e duas abas de 210 ainda cabem; se não couberem, a última aba vira o "+N" (o
   `DOCK_SLOTS` passa a depender da largura disponível).
9. **O link para baixar fica à mão do dono:** em Painel › Convites, um botão "Copiar link para baixar o app" copia o
   `{PUBLIC_URL}/download`. É o que se manda para quem formatou o PC: pelo desenho, a conta volta sozinha sem
   convite nem recuperação (teste A06). Sem tela nova.
27. **A transmissão assistida não para nas configurações** (pedido do Kid, 24/11, no uso). Hoje a miniatura some e a
    tela deixa de ser baixada ao abrir as configurações (`inSettings` em `MiniShare.tsx`), e isso incomoda. Passa a
    seguir: a miniatura aparece por cima das configurações, no canto de baixo à direita, com o mesmo recolher, X,
    volume e "Voltar para a sala", e a assinatura continua (`shown` do `roomView`). Recolhida, vira a aba na lateral,
    como no canal. As conversas privadas continuam escondidas nas configurações.

**Servidor (parte 4)**

10. **A cópia dos arquivos é incremental, no mesmo horário do banco.** Um comando novo do `admin`,
    `admin arquivos-backup`, lista os ids dos arquivos `avatar`, `emoji` e `sound` que existem no banco. O `backup.sh` passa
    essa lista para `rclone copy --files-from … --ignore-existing` de `data/files/` para `r2:{bucket}/{prefixo}/files/`.
    Como um arquivo nunca muda, o que já está no R2 não sobe de novo; na maioria dos dias não sobe nada.
11. **As fotos anteriores** ("Fotos anteriores" do Perfil) também são `avatar` e entram, para a pessoa conseguir voltar
    a uma delas depois de uma restauração.
12. **Nada é apagado do R2** pela cópia: um emoji ou uma foto apagados no app ficam lá. O volume é pequeno (fotos de
    256 px, emojis de 128 px e sons de até 1 MB, no máximo 50 aprovados); se um dia pesar, uma limpeza mensal entra depois.
13. **Restaurar = banco + arquivos.** O `deploy/server/README.md` ganha o passo de baixar a pasta `files/` do R2
    para `data/files/` antes de subir a API. Um anexo sem o arquivo aparece como "Arquivo indisponível", sem quebrar a
    mensagem nem a conversa (conferir no teste; se quebrar, é correção da Etapa 9).
14. **A restauração é testada numa cópia, não na VPS de produção:** a API de casa (ou um contêiner local) sobe com o
    backup do R2 e o app aponta para ela pelo `VITE_API_URL` de desenvolvimento.

**Revisão e testes (partes 5 e 6)**

15. **A triagem das notas antigas** marca como feito o que o uso do grupo já provou (com a versão em que foi visto),
    passa para o roteiro de testes o que o uso não exercita, e manda para o `BACKLOG.md` o que não vale corrigir antes
    da 1.0, com o motivo. Nenhum `[ ]` fica sem destino.
16. **O roteiro de testes** fica em `docs/testes-rc.md`: cada caso com o passo a passo, o que tem de acontecer e quem
    testou em qual versão. Os casos do roadmap são renumerados e ganham os que vieram depois (lista abaixo).
17. **Correção no RC é só correção.** O que aparecer no teste e for recurso novo vai para o `BACKLOG.md`, com a versão
    sugerida. Depois da `0.9.0`, isso vale também para o soundboard.

**Soundboard (parte 3)**

18. **Os sons são do grupo**, até 50 aprovados. Um som tem arquivo (kind novo `sound` na tabela `files`), nome (até
    24 caracteres), emoji, quem enviou e a situação: `pending`, `approved` ou `rejected`, com o motivo e quem decidiu.
    O nome não pode repetir o de outro som aprovado ou aguardando (sem diferenciar maiúscula), e a recusa diz isso na
    hora do envio.
19. **Duas permissões novas.** "Enviar sons" (`sons.enviar`) vem ligada para todo mundo: a migração dá a quem já está
    no grupo, e entrar por convite dá a quem chega. Dá para tirar de alguém em Membros. "Aprovar sons"
    (`sons.aprovar`) aprova, recusa, renomeia e exclui qualquer som; o dono tem as duas.
20. **O envio passa por aprovação.** O som enviado fica `pending`, com até 3 aguardando por pessoa. Quem tem "Aprovar
    sons" envia direto como aprovado. Aprovar ou recusar (com motivo opcional) avisa quem enviou, pelo tempo real e
    pela notificação. O recusado fica na lista da pessoa, com o motivo, até ela apagar ou editar e reenviar. Aprovar
    com 50 sons no grupo é recusado com "O grupo já tem 50 sons. Exclua um antes de aprovar outro."
21. **Uma tela só, Configurações › Servidor › Sons**, com abas pela permissão: "Meus sons" para todos (o que a pessoa
    enviou, com Aguardando, Aprovado e Recusado com o motivo; ouvir, editar e cancelar enquanto aguarda),
    "Aprovação" (a fila, com contador dourado) e "Todos os sons" (os aprovados, com ouvir, renomear e excluir), as duas
    só com "Aprovar sons". O botão é "Carregar som", e arrastar um arquivo em qualquer lugar da tela faz o mesmo. O
    Painel › Sons dos primeiros desenhos sai.
22. **O editor fica no app, antes do envio.** O app decodifica o arquivo (MP3, OGG ou WAV, de qualquer duração e até
    10 MB) e mostra a onda com duas alças para escolher o trecho de até 5 s, o play só do trecho, um volume (-12 a +6
    dB), "Igualar volume" (normaliza o pico) e "Suavizar início" e "Suavizar fim" (fade curto). O que sobe é sempre o
    trecho já editado, em WAV mono de 48 kHz (5 s dão uns 470 KB), para não precisar de codificador no app. A API
    confere de novo: só WAV, até 5 s pela duração lida do arquivo e até 1 MB. Eco, tom e outros efeitos ficam fora.
23. **Tocar é um aviso da API, e cada app toca o seu arquivo.** `POST /api/voice/sounds/{id}/play` só aceita som
    aprovado, de quem está numa sala ou numa ligação e não está com os sons bloqueados. A API manda o
    `voice.sound_played` para quem está na mesma sala ou ligação, e cada app toca o arquivo que já guardou, no volume
    do soundboard. Limite por pessoa, conferido na API: um som a cada 3 s e no máximo 5 a cada 30 s. Enquanto toca, quem
    tocou ganha a onda dourada na lista e no bloco, sem o nome nem o emoji do som.
24. **Bloquear sons é moderação de voz.** No cartão da pessoa na sala, junto de Silenciar e Deixar surdo, quem tem
    "Moderar voz" tem "Bloquear sons" e "Liberar sons". Vira a coluna `sounds_blocked` na `voice_moderation` e vale
    como o silenciar (ADR 0034): em todas as salas do grupo até alguém liberar, fora das ligações privadas, com
    registro no audit. Para quem foi bloqueado, o botão Sons fica apagado com "Um moderador bloqueou seus sons". Confirmado pelo Kid (24/11).
25. **A grade e os atalhos** (quadros "Soundboard — tocar sons" e "Soundboard — atalhos"): o botão Sons fica no painel
    de voz e na barra da chamada, na sala e na ligação; a grade tem 4 colunas, a busca e o volume. A primeira linha tem
    4 lugares, cada um com um atalho global (padrão Ctrl + Alt + 1 a 4, em Configurações › Atalhos › Soundboard).
    Arrastar um som para um lugar põe ele lá, e o botão direito tem "Pôr no lugar 1–4"; o som que está num lugar ganha
    o número dourado na lista. Os lugares ficam no PC de cada um. Um som excluído que estava num lugar deixa o lugar
    vazio com "Som removido".
26. **Para quem ouve, só a chave geral e o volume**, em Configurações › Notificações. Nada de silenciar os sons de uma
    pessoa (decisão do Kid, 24/11).

## Roteiro de testes

### Mídia

```text
M01 — Dois participantes
M02 — Microfone, mute e deafen
M03 — Screen Share (Movimento e Nitidez)
M04 — Screen Share + áudio
M05 — Terceiro participante
M06 — Reentrada
M07 — Reconexão (queda curta de rede e volta da suspensão)
M08 — Duas transmissões simultâneas, foco e miniaturas
M09 — Ligação privada, com tela compartilhada
M10 — Supressão de ruído, cancelamento de eco e pressionar para falar com um jogo em foco
M11 — Câmera na sala e na ligação
M12 — Transmitir o jogo pelo cartão, dentro e fora da sala
M13 — Moderação na voz (silenciar, surdo, câmera, encerrar transmissão)
M14 — Print da transmissão
M15 — Placa AMD com o encoder da placa falhando (AMF e plano B)
M16 — Janela que muda de tamanho e jogo que troca de janela (LoL)
M17 — Soundboard na sala e na ligação (tocar, atalho com um jogo em foco, onda dourada, volume e chave geral)
M18 — Bloquear e liberar os sons de alguém, e o limite de 5 sons em 30 s
```

### Aplicação

```text
A01 — Convite válido
A02 — Código errado
A03 — Convite vencido
A04 — Convite já usado e convite cancelado
A05 — Convite de recuperação
A06 — Formatar o PC e entrar direto, sem desvincular
A07 — Hardware com UUID inválido
A08 — Dispositivo desvinculado
A09 — API indisponível
A10 — LiveKit indisponível
A11 — Navegação texto + voz
A12 — Atualização automática
A13 — Cliente abaixo da versão mínima
A14 — Mensagem privada
A15 — Troca de nome e foto
A16 — Menção em canal silenciado
A17 — Ligação recebida estando numa sala
A18 — Versão no canal beta antes de todos
A19 — Cartão do convite no chat
A20 — Anexos, prévia de link e busca (e assistir uma transmissão com as configurações abertas)
A21 — Enviar som: carregar, arrastar, cortar, volume e o limite de 3 aguardando
A22 — Aprovar e recusar som, com o aviso para quem enviou e o limite de 50
A23 — Lugares do soundboard: arrastar, trocar, esvaziar e som excluído
```

### Servidor

```text
S01 — Backup do banco, das fotos, dos emojis e dos sons no R2
S02 — Restauração completa numa cópia
S03 — Servidor fora do ar avisa no celular
```

## Etapa 0: Documentos, roadmap e BACKLOG

Só documentos.

- O `PLAN.md` e o `NOTES.md` da v0.8 vão para `docs/plans/` (o plano já está lá: só conferir); o plano e as notas da
  v0.6 também, que ficaram fora; a raiz recebe estes.
- `docs/roadmap.md`: a v0.9 diz que sai na `0.9.0`, com o roteiro novo (M01–M18, A01–A23, S01–S03), os quatro ajustes,
  o soundboard e o backup das fotos, dos emojis e dos sons; a v0.8 diz que saiu na `0.8.0` e foi até a `0.8.11`.
- `BACKLOG.md`: a "Cópia dos arquivos" de "Mais adiante" passa a falar só dos anexos e das prévias.
- ADR `0036-backup-das-fotos-emojis-e-sons.md`, com as decisões 10 a 14.
- ADR `0037-soundboard.md`, com as decisões 18 a 26. A decisão 27 vai como adendo no ADR 0024 (miniatura).

## Etapa 1: Triagem das notas e roteiro de testes

Só documentos, com o Kid respondendo o que o grupo já usou.

- Passar pelas notas `v0.2.4` a `v0.8` em `docs/plans/` e dar destino a cada `[ ]` (decisão 15). O que precisar da
  memória do Kid ("isso já aconteceu com vocês?") vira uma lista curta numa mensagem só, não uma pergunta por item.
- Escrever o `docs/testes-rc.md` (decisão 16).
- O `NOTES.md` da raiz ganha as correções que a triagem achou.

**Pronto quando:** nenhum `[ ]` antigo sem destino, e o roteiro escrito.

## Etapa 2: API e app, o motivo do convite recusado

- `identity/invites.rs`: `find_by_code` e a conferência (decisão 1), com testes para os quatro motivos e para o
  `redeem` e o `preview` darem o mesmo.
- `error.rs`: o `reason` no corpo do `invalid_invite`, exportado para o TypeScript.
- `routes/pages.rs`: o título pelo motivo (decisão 3).
- App: a tela de convite e a de recuperação mostram o texto do motivo.

## Etapa 3: App, o cartão do convite no chat

- API: `GET /api/invites/preview/{código}` (decisão 5), com teste de que não conta no limite e de que pede sessão.
- App: reconhecer os links (decisão 4), o cartão (decisão 6) e ignorar a prévia de `{PUBLIC_URL}` (decisão 7). Num
  canal, numa conversa privada e numa mensagem encaminhada.

## Etapa 4: App, a conversa mais larga, o link para baixar e a transmissão nas configurações

- `DmWindow.tsx`: 440 px; `DmDock.tsx`: as abas que cabem (decisão 8). Conferir em 1280, 1366 e 1920 px.
- Painel › Convites: "Copiar link para baixar o app" (decisão 9).
- `MiniShare.tsx`: a miniatura nas configurações (decisão 27), numa camada por cima delas, e a assinatura seguindo.
  Conferir que ela não cobre o Salvar nem o teste de microfone de Voz e vídeo (recolhida, a aba sai do caminho).

## Etapa 5: API, sons, envio e aprovação

- Migração: a tabela `sounds` (decisão 18), o kind `sound` em `files`, as permissões `sons.enviar` e `sons.aprovar`
  (decisão 19), com `sons.enviar` dada a todos os membros, e a coluna `sounds_blocked` em `voice_moderation`.
- Rotas: enviar, listar os meus, listar a fila, listar os aprovados, aprovar, recusar com motivo, renomear, excluir e
  cancelar o meu enquanto aguarda (decisão 20). A conferência do arquivo lê a duração do WAV (decisão 22).
- O aviso de aprovado e recusado, pelo tempo real e pela notificação, e o contador da fila para quem aprova.
- Testes: os limites (3 aguardando, 50 aprovados, 5 s, 1 MB, nome repetido), as permissões e quem envia aprovado
  direto.

## Etapa 6: API e app, tocar na sala e na ligação, atalhos e bloqueio

- API: `POST /api/voice/sounds/{id}/play` e o `voice.sound_played` (decisão 23), com os dois limites; "Bloquear sons"
  e "Liberar sons" nas rotas de moderação (decisão 24). Testes do limite, do bloqueio e de quem não está na sala.
- App: o botão Sons no painel de voz e na barra da chamada, a grade, tocar com o cache dos arquivos, a onda dourada em
  quem tocou, e a chave geral e o volume em Configurações › Notificações (decisões 25 e 26).
- App: os 4 lugares, arrastar e "Pôr no lugar", os atalhos globais (o mesmo mecanismo do pressionar para falar) e o
  "Som removido".
- App: "Bloquear sons" no cartão da pessoa na sala, e o botão apagado para quem foi bloqueado.

## Etapa 7: App, a tela Sons e o editor

- Configurações › Servidor › Sons com as três abas e o contador (decisão 21); sai o Painel › Sons.
- O editor (decisão 22): decodificar com o Web Audio, a onda, as alças, o play do trecho, o volume, igualar e
  suavizar, e gerar o WAV. Teste do corte e do WAV gerado (duração e tamanho).
- Carregar som e arrastar um arquivo em qualquer lugar da tela.

## Etapa 8: Servidor, backup das fotos, dos emojis e dos sons

- `admin arquivos-backup` (decisão 10), com teste, levando os sons junto.
- `backup.sh`: a cópia incremental depois do banco. Uma falha na cópia dos arquivos aparece no log
  (`/var/log/ashtar-backup.log`) e não desfaz o backup do banco.
- O Painel › Servidor mostra o último backup dos arquivos junto do último do banco.
- A imagem da API sai pelo Actions e a VPS atualiza (o Kid roda; o passo a passo vai no README).

## Etapa 9: Servidor, restauração testada e produção revisada

- Restaurar numa cópia (decisão 14): baixar o último backup e a pasta `files/` do R2, subir, entrar pelo app e
  conferir membros, histórico, fotos, emojis e um anexo indisponível (S02).
- `deploy/server/README.md`: o passo a passo da restauração completa (decisão 13).
- Revisar o `api.env` e o `.env` da VPS contra o `.env.example` (variável sobrando ou faltando), o
  `MIN_CLIENT_VERSION`, e o UptimeRobot (S03).
- Disco, CPU, memória e tráfego da VPS num mês de uso, anotados no README.

## Etapa 10: Revisão antes da 1.0

- `cargo audit` (em `api/` e em `desktop/src-tauri/`) e `pnpm audit`: atualizar o que tiver aviso de segurança; o que
  não der, anotado no `NOTES.md` com o motivo.
- Os limites de tentativas e de envio revisados com o uso real.
- O `admin` enxuto (item de "Correções fora de ordem" do `BACKLOG.md`): ficam `dono`, `backup`, `arquivos-backup`,
  `recuperacao` e `membros`.
- Os textos de erro e de carregamento: passar pelas telas principais com a API fora do ar e com a rede lenta, e
  trocar todo texto técnico ou genérico ("Erro interno") que a pessoa possa ver por um que diga o que fazer.

## Etapa 11: Lançamento da `0.9.0` no beta

- `CHANGELOG.md` com a seção `0.9.0`, a versão no `package.json` e no `tauri.conf.json`.
- A `feature/0.9` vai para a `dev`, que publica no beta.

## Etapa 12: Noite de teste com o grupo

- O roteiro inteiro (M, A e S), com a `0.9.0` do beta. O que precisa de mais de um PC é feito na mesma noite.
- Uma noite inteira de uso medindo memória e CPU do app (o cache de `blob:` do chat, a transmissão de várias horas).
- O M15 com a RX 7600 do amigo do Kid.
- Cada falha vira um item no `NOTES.md`, com o caso do roteiro.

## Etapa 13: Correções `0.9.x` e o estável

- Cada correção sai como `0.9.x` pelo beta; o caso que falhou é testado de novo nela.
- Com o roteiro todo passando numa versão só, o PR da `dev` para a `main` promove para o estável.
- A 1.0 é a fase seguinte: o grupo usar o Ashtar como ferramenta principal por algumas semanas, como diz o roadmap.

## Riscos e cuidados

- **A triagem pode virar uma lista enorme de testes.** O uso do grupo já cobre muita coisa; só entra no roteiro o
  que o uso normal não exercita ou o que já quebrou antes.
- **O motivo da recusa muda o corpo do erro.** O app antigo só lê o `kind`; o `reason` é campo novo e opcional.
- **A rota do cartão não conta no limite de tentativas.** Ela pede sessão de quem já está no grupo; quem não está não
  chega nela.
- **O `rclone --files-from` com milhares de ids:** a lista sai num arquivo temporário, não numa linha de comando.
- **A restauração na VPS de produção apagaria o que entrou depois do backup.** Por isso o teste é numa cópia.
- **O RC não pode virar mais uma versão de recursos.** Pedido novo que aparecer no teste vai para o `BACKLOG.md`.
- **O soundboard é um recurso grande dentro do RC.** Ele entra inteiro antes da `0.9.0` e passa pelo mesmo roteiro
  (M17, M18, A21–A23); depois do beta, só correção.
- **Spam de sons numa sala.** Os limites ficam na API, não só no app, e quem modera pode bloquear.
- **Decodificar áudio no app:** um arquivo estranho pode não abrir no Web Audio. O editor mostra "Não deu para abrir
  esse arquivo. Tente MP3, OGG ou WAV." em vez de travar.
