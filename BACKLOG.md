# BACKLOG — o que a reorganização deixou para as próximas etapas

Itens adiados ao fechar a reorganização do compartilhamento de tela (Etapas 1 a 6 de [`docs/plans/v0.1-reorganizacao.md`](docs/plans/v0.1-reorganizacao.md), concluída em
2026-10-06). Vieram de [`docs/plans/v0.1-notes.md`](docs/plans/v0.1-notes.md), com o texto e as evidências originais, e estão sob a versão que deve
recebê-los segundo o `docs/roadmap.md`.

Ao resolver um item, apague-o daqui e registre o resultado no ADR ou no commit.

## Correções fora de ordem

Bugs que saem assim que ficarem prontos, pelo auto-update, sem esperar a entrega da ordem.

- [ ] **Enxugar o `admin`** (o que sobrou da Etapa 8; o código de acesso e a rota `/api/voice/join`
      já saíram): o Painel de controle cobre `convite`, `convites`, `revogar`, `membros`, `remover`,
      `desvincular`, `beta` e `permissoes`. **Não tirar o `recuperacao`**: se o dono perde o computador, ele
      não consegue abrir o Painel, e esse comando é o único jeito de criar a recuperação dele. Ficariam
      `dono`, `backup`, `recuperacao` e, de preferência, `membros`, só para conferir o banco. Se for feito,
      atualizar o `README.md`, o `scripts/local/admin-shell.ps1` (a lista de comandos) e os testes.

## v0.2.2 — UI nova

- [ ] O app passa a usar as rotas de identidade que a v0.2.1 deixou prontas na API (`/api/auth/redeem`,
      `/api/auth/login`, `/api/me`, `/api/voice/token`): chave do dispositivo calculada no desktop (hash do
      hardware, ou 32 bytes aleatórios no cofre do Windows quando o hardware é genérico), telas de convite e de
      escolha do nick, e fim do `idiot-<uuid>`. Em seguida, desligar o código de acesso provisório, a rota
      `/api/voice/join` e subir o `MIN_CLIENT_VERSION` (ADR 0011).
- [ ] Criar o dono pelo `admin dono` e gerar um convite de recuperação para vincular o computador do dono
      (decisão 5 do plano da v0.2.1, `docs/plans/v0.2.1-identidade-na-api.md`).

- [ ] O seletor (`SourcePicker`) e a trava de uma transmissão por vez (`ScreenShareButton`) existem e foram
      usados nos testes de 05 e 06/10 (ADR 0009). A trava só considera tracks já assinados e não impede duas
      pessoas de iniciarem ao mesmo tempo; o erro de início não tem como ser dispensado. A UI de voz é
      provisória. **Adiado para a UI nova (v0.2.2).**
- [ ] Os textos dos presets (`presets.ts`) prometem mais fluidez do que o medido em jogo: o Equilibrado ("sem
      perder fluidez") ficou em 25–34 fps e o Nitidez em 18–25 fps, abaixo dos 30 do próprio nome (ADR 0009). **Adiado para a UI nova (v0.2.2).**

- [ ] Rotas de administração na API e tela de administração na UI, no lugar do `admin` temporário da v0.2.1:
      criar, listar e revogar convite, remover membro, desvincular dispositivo, marcar o beta e ver as
      permissões. Ficam sobre as funções de `identity/`, que já recebem o `actor`. Depois, tirar do `admin` o
      que a UI cobrir e deixar só `dono` e `backup`.

- [ ] Tela de usuários em que o dono marca quem recebe o beta. A API (devolver o canal e a permissão no
      `admin`) sai na v0.2.1 (`NOTES.md`); a tela e o app guardando o último valor vêm aqui, e substituem a
      variável `ASHTAR_UPDATE_CHANNEL`. Papel de dono ("supremo"), acima de administrador; só ele marca o beta.
- [x] Organizar as features do front pelo padrão da ADR 0014 (gavetas `components/`, `hooks/`, `stores/`,
      `model/`; a `voice` em subdomínios e a `server` separada). Feito em 31/10, sem regra de ESLint: é
      convenção. O que difere do plano está na seção "Como ficou" da ADR.

## v0.5 — Salas e presença

- [x] No cartão do usuário (ADR 0020), "Mover para outra sala": entrou com as várias salas de voz (ADR 0026), junto do
      "Desconectar da voz" e do arrastar entre salas.

## v0.8 — Moderação

- [ ] A seção Moderação do cartão do usuário (silenciar o microfone de alguém e deixar surdo, para todos),
      que está no canvas ("Menu do usuário — com ações") e ficou fora da v0.3: pede uma permissão nova e um
      comando no servidor de voz.

## Mais adiante

O aviso de conteúdo protegido está na v0.8 do roadmap (`## Screen Share`); as miniaturas foram adiantadas para a v0.2.4; Linux, depois da v1.0; sem versão para funcionalidades novas de voz.

- [ ] Aviso de possível conteúdo protegido (frames totalmente pretos por vários segundos).
- [ ] Suporte a Linux (risco principal: WebRTC no WebKitGTK) e versão web.
- [ ] Qualquer funcionalidade nova de voz além do que já existe.
- [ ] O overlay em jogos, desenhado no canvas e sem versão (a câmera entrou na v0.4).
- [ ] `@todos`, silenciar com prazo e grupos privados com mais de duas pessoas (fora da v0.3).
- [ ] Um segundo tema (claro, por exemplo). A troca por `data-theme` já existe desde a v0.2.2 (ADR 0012);
      a opção aparece nas configurações quando o tema existir, com o contraste conferido.
