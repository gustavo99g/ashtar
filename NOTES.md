# NOTES — pendências da v0.9 (Release Candidate)

Lista de verificação da fase descrita no [`PLAN.md`](PLAN.md). Cada item deve ser resolvido ou conscientemente
adiado (marcar como tal) antes de fechar a entrega em que ele está.

Base: a `main` com a `0.8.11` (merge do PR #44, `b8fc1a0`). A correção da barra de tarefas na tela cheia
(`858da4a`, só na `feature/0.8`) entra quando passar pela `dev` como `0.8.12`.

## Do uso real (24/11)

- O grupo usa a 0.8.11 sem reclamar do que já funciona.
- [x] *(feito na v0.9 (Etapa 2))* **Mensagem do convite recusado.** Um amigo viu "Convite inválido, expirado ou já usado" com o convite ainda
      ativo no Painel: o código chegou errado. A API junta quatro casos num erro só (`ApiError::InvalidInvite`).
      Separar: "Este convite venceu", "Este convite já foi usado", "Este convite foi revogado" e "Código não
      encontrado" (o `find_valid` em `identity/invites.rs` vira uma busca pelo código e uma conferência depois).
- [x] *(feito na v0.9 (Etapa 3))* **Prévia do link do convite** (o Kid aprovou na 0.9, 24/11). A prévia da API recusa a própria VPS
      (`own_addresses` em `previews/mod.rs`), então o link do convite nunca ganha cartão. O app reconhece o link e
      monta o cartão ele mesmo pela rota de leitura do convite (`preview`): quem convidou, ou de quem é a conta na
      recuperação, e quando vence. A proteção da VPS não muda.
- [x] *(roteiro do RC, A06)* **Formatar o PC entra direto** (teste A06). Um amigo formatou e o Kid mandou um convite de recuperação, que
      funcionou; mas o Kid tinha desvinculado o computador antes, o que libera a chave, então o caso não prova nada
      sobre a chave. Pelo desenho, formatar não muda a chave e basta instalar o app. Conferir no teste do RC, sem
      desvincular antes.
- [x] *(feito na v0.9 (Etapa 4))* **Link para baixar o app**, para mandar a quem formatou ou trocou de PC sem gerar convite (24/11). O
      `/download` já existe; o Painel › Convites ganha "Copiar link para baixar o app" (decisão 9 do plano).

- [x] *(feito na v0.9 (Etapa 4))* **A janela da conversa privada um pouco mais larga** (pedido do Kid, 24/11). Hoje é `w-[380px]` em
      `dms/components/DmWindow.tsx` (quadro "Lateral — conversa embaixo"). Proposta: 440 px, com a altura de até
      540 igual. Conferir que três abertas (a expandida e duas abas de 210) ainda cabem ao lado da lateral numa
      janela de 1280 px.

## Triagem das notas antigas (Etapa 1)

Os 255 itens em aberto das notas da v0.2.2 à v0.8 (e os 5 deste arquivo) ganharam destino, marcado no próprio item:
110 provados no uso até a 0.8.11, 26 feitos, 43 obsoletos (a VPS, o app antigo, os experimentos já decididos), 12
aceitos como regra ou limitação, 55 no roteiro do RC (`docs/testes-rc.md`, com o número do caso) e 9 no
`BACKLOG.md` (2 já estavam lá; os outros na seção "Da triagem das notas antigas"). A triagem não achou defeito para corrigir antes da 1.0.

- [ ] **Perguntas ao Kid** (os itens marcados "pergunta ao Kid"; sem resposta, ficam no roteiro):
      1. Alguém já transmitiu um jogo em tela cheia exclusiva (não a janela sem borda)? (M12)
      2. Alguém tem monitor HDR, ou transmite de notebook com duas placas? (M03)
      3. Quais placas o grupo tem, e todas já transmitiram (NVIDIA, Intel, AMD)? (M15)
      4. A ligação tocando com um jogo em tela cheia já roubou o foco do jogo? (A17)
      5. Algum anti-cheat (Vanguard, EAC, BattlEye) já reclamou do Ashtar? (M10)
      6. Alguém usa fone Bluetooth na chamada, e ele já ficou trocando de dispositivo? (M02)

## Decisões do Kid (24/11)

- **Backup:** o banco (como hoje, todo dia), os emojis do grupo e as fotos de perfil. Os emojis e as fotos vão
  junto da rotina do banco, mas só o que é novo: os arquivos nunca mudam depois de gravados (o id é o nome), então
  a cópia manda só os ids que ainda não estão fora da VPS, e na maioria dos dias não manda nada. Anexos, prévias e
  o resto dos arquivos ficam fora. Na
  restauração testada do RC, os emojis voltam com o banco; um anexo sem arquivo aparece como indisponível, sem
  quebrar a mensagem.
- **Soundboard** (pedido do Kid, 24/11): entra na 0.9, antes da `0.9.0`. Quadro "Soundboard — tocar sons" no canvas.
  Os sons são do grupo (permissão "Gerenciar sons", Painel › Sons; até 5 s, 1 MB, MP3/OGG/WAV, até 50). O botão
  Sons fica no painel de voz (embaixo à esquerda) e na barra da chamada, na sala e na ligação; abre a grade para
  cima. Cada app toca o arquivo guardado (a API só avisa a sala), um som a cada 3 s por pessoa. Enquanto toca, quem
  tocou ganha o ícone dourado de onda na lista e no bloco, sem o nome nem o emoji do som. Para quem ouve: só a chave
  geral e o volume do soundboard em Configurações › Notificações, nada de silenciar uma pessoa (decisão do Kid,
  24/11). Os sons entram no backup junto das fotos e dos emojis.
- **Soundboard — 4 lugares com atalho** (Kid, 24/11; quadro "Soundboard — atalhos"): a primeira linha da grade tem
  4 lugares fixos, cada um com um atalho global (padrão Ctrl + Alt + 1 a 4, trocáveis em Configurações › Atalhos ›
  Soundboard). Arrastar um som para um lugar põe ele lá (ocupado troca; lugar para lugar troca os dois; para fora
  esvazia), e o botão direito no som tem "Pôr no lugar 1–4". O atalho é do lugar, não do som. Na lista, o som que
  está num lugar ganha o número dourado no canto. A grade tem 4 colunas, como a linha dos lugares. Os lugares e os
  atalhos ficam no PC de cada um.
- **Transmissão nas configurações** (Kid, 24/11, no uso): a pausa da transmissão assistida ao abrir as configurações
  incomoda. Decisão 27 do plano: a miniatura continua por cima das configurações, e a tela continua sendo baixada.
- **Bloquear sons** (Kid, 24/11): fica na moderação de voz, vale em todas as salas até liberar, não nas ligações
  privadas. Decisão 24 do plano.
- **Congelamento:** entram ajustes pequenos de interface (a prévia do convite, a largura da conversa privada).
