# NOTES — pendências da v0.2.0 (base de entrega)

Lista de verificação da fase descrita no [`PLAN.md`](PLAN.md). Cada item deve ser resolvido ou
conscientemente adiado (marcar como tal) antes de fechar a fase. A lista da fase anterior está arquivada em
[`docs/plans/v0.1-notes.md`](docs/plans/v0.1-notes.md).

## Vindos do BACKLOG

- [ ] **Logs em arquivo** (item 04 da v0.1, adiado em 2026-10-07): hoje o `tracing` só escreve no terminal,
      e no executável de um amigo não há como ver o que aconteceu. Resolve na Etapa 2.

## Antes de distribuir a v0.2.0

- [ ] **Trocar a key do LiveKit.** O secret da key atual apareceu numa conversa de suporte; apagar a key no
      painel, criar outra e atualizar o `.env` da API.
- [ ] **Relógio do computador da API sincronizado.** O token é assinado com o `nbf` do relógio local; com o
      relógio ~1 minuto adiantado, o LiveKit Cloud recusou com "invalid token" (2026-10-06). Vale até a API ir
      para a VPS (v0.2.1). Alternativa no código: gerar o token com o `nbf` alguns segundos no passado.
- [ ] **Avisar o grupo** que a v0.2.0 é instalada pelo `-setup.exe` e substitui o executável da v0.1, que
      pode ser apagado.

## Riscos e cuidados

- [ ] **Chave privada do updater** com cópia de segurança fora do GitHub (decisão 7). Sem ela, nenhuma
      atualização chega a quem já instalou.
- [ ] **Minutos do GitHub Actions** (decisão 11): acompanhar o consumo do primeiro mês. Se apertar, rodar o
      job Windows só no release.
- [ ] **`VITE_API_URL` no pipeline:** hoje a URL do Tailscale Funnel; quando a API mudar de endereço (v0.2.1),
      a variável do repositório muda e sai uma versão nova. O app instalado continua com a URL antiga até
      atualizar, então a URL antiga precisa responder até todos atualizarem.
- [ ] **Versão mínima só depois de todos na v0.2.0** (decisão 8): ligar `MIN_CLIENT_VERSION` antes disso
      tira da sala quem ainda está na v0.1, sem mensagem clara.
- [ ] **API sem proteção até a v0.2.2:** quem descobrir a URL fixa do Funnel consegue tokens do LiveKit.
      Acompanhar o consumo no painel; se aparecer uso estranho, adiantar o código de acesso.
