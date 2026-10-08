# NOTES — pendências da v0.2.0 (base de entrega)

Lista de verificação da fase descrita no [`PLAN.md`](PLAN.md). Cada item deve ser resolvido ou
conscientemente adiado (marcar como tal) antes de fechar a fase. A lista da fase anterior está arquivada em
[`docs/plans/v0.1-notes.md`](docs/plans/v0.1-notes.md).

## Vindos do BACKLOG

- [ ] **Logs em arquivo** (item 04 da v0.1, adiado em 2026-10-07): hoje o `tracing` só escreve no terminal,
      e no executável de um amigo não há como ver o que aconteceu. Resolve na Etapa 2.

- [ ] **Código de acesso provisório** (item 03 da v0.1, adiado para cá em 2026-10-07): hoje a API emite o
      token para qualquer chamada que chegue à URL fixa do Funnel. Resolve na Etapa 6 (decisão 11).

## Antes de distribuir a v0.2.0

- [ ] **Trocar a key do LiveKit.** O secret da key atual apareceu numa conversa de suporte; apagar a key no
      painel, criar outra e atualizar o `.env` da API.
- [ ] **Relógio do computador da API sincronizado.** O token é assinado com o `nbf` do relógio local; com o
      relógio ~1 minuto adiantado, o LiveKit Cloud recusou com "invalid token" (2026-10-06). Vale até a API ir
      para a VPS (v0.2.6). Alternativa no código: gerar o token com o `nbf` alguns segundos no passado.
- [ ] **Avisar o grupo** que a v0.2.0 é instalada pelo `-setup.exe` e substitui o executável da v0.1, que
      pode ser apagado.

- [ ] **Renomear `master` para `main`** e passar a trabalhar por pull request (`dev` = beta, `main` =
      estável, decisão 3).

## Riscos e cuidados

- [ ] **Chave privada do updater** com cópia de segurança fora do GitHub (decisão 7). Sem ela, nenhuma
      atualização chega a quem já instalou.
- [ ] **Minutos do GitHub Actions** (decisão 12): acompanhar o consumo do primeiro mês. Se apertar, rodar o
      job Windows só no release.
- [ ] **`VITE_API_URL` no pipeline:** hoje a URL do Tailscale Funnel; quando a API mudar de endereço (v0.2.6),
      a variável do repositório muda e sai uma versão nova. O app instalado continua com a URL antiga até
      atualizar, então a URL antiga precisa responder até todos atualizarem.
- [ ] **Versão mínima só depois de todos na v0.2.0** (decisão 8): ligar `MIN_CLIENT_VERSION` antes disso
      tira da sala quem ainda está na v0.1, sem mensagem clara.
- [ ] **API sem proteção até `ACCESS_CODE` ser ligada:** quem descobrir a URL fixa do Funnel consegue
      tokens do LiveKit. Acompanhar o consumo no painel.
- [ ] **Consumo de minutos do LiveKit Cloud:** se um mês passar de ~60% dos 5.000 minutos, o servidor
      (v0.2.6) passa à frente, ou o plano pago cobre o mês (gatilho no `docs/roadmap.md`).
- [ ] **Token de publicação no `ashtar-releases`:** se for fine-grained, expira em no máximo um ano.
      Anotar aqui a data de expiração ao criá-lo; vencido, o pipeline para de publicar.
- [ ] **Contrato da API durante o beta** (decisão 3): quem está no beta e o grupo usam a mesma API. Mudança
      de contrato sempre compatível com a versão anterior até a promoção.
