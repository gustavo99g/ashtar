# NOTES — pendências da v0.2.2 (UI nova)

Lista de verificação da fase descrita no [`PLAN.md`](PLAN.md). Cada item deve ser resolvido ou
conscientemente adiado (marcar como tal) antes de fechar a fase. A lista da fase anterior está arquivada em
[`docs/plans/v0.2.1-notes.md`](docs/plans/v0.2.1-notes.md).

## Vindos do BACKLOG

- [ ] **Seletor e trava de uma transmissão por vez** (adiados da v0.1): a trava só considera trilhas já
      assinadas, não impede duas pessoas de começarem juntas, e o erro de início não pode ser dispensado.
      Resolve na Etapa 5 (a trava olha as publicações da sala, e quem começou depois vê um aviso
      dispensável).
- [ ] **Textos dos presets** prometem mais fluidez do que o medido em jogo (Equilibrado 25 a 34 fps,
      Nitidez 18 a 25 fps; ADR 0009). Resolve na Etapa 5.
- [x] **Botão "Abrir pasta de logs"** (adiado da v0.2.0): vira um comando Rust, porque a permissão
      `opener:default` não abre caminhos locais. Resolvido na Etapa 6 (`open_log_dir`).
- [ ] **Interruptor do beta e canal por pessoa** (adiados da v0.2.0 e da v0.2.1): o dono liga e desliga no
      Painel (Etapa 7). O canal por pessoa está feito (Etapa 6): o app passa ao Rust o canal da API depois
      do `/api/me`, só na memória, e a variável `ASHTAR_UPDATE_CHANNEL` ficou só para o desenvolvimento.
- [ ] **Administração pela interface** no lugar do `admin` temporário: rotas na Etapa 1, telas na Etapa 7;
      o `admin` fica só com `dono` e `backup` na Etapa 8.

## Vindos da v0.2.1

- [ ] **Identidade falsa nova a cada entrada** (`idiot-<uuid>`, nome `Idiota-<uuid>`): o app passa a entrar
      pelo `POST /api/voice/token`, com o nome visível e o nick vindos do banco (Etapa 5). A rota antiga sai
      na Etapa 8.
- [ ] **Rota antiga aberta:** `/api/voice/join` continua aceitando o código de acesso. Sai na Etapa 8,
      junto com o `ACCESS_CODE` e a subida do `MIN_CLIENT_VERSION`.
- [ ] **Vincular o computador do dono:** `admin dono` e uma recuperação para você mesmo, aberta no app
      beta (Etapa 8).
- [ ] **Backup fora do computador** e uma restauração testada **antes** de o grupo entrar (Etapa 5 da
      v0.2.1). Se a v0.2.1 fechar sem isso, fica aqui como condição da troca.
- [ ] **Comparação do código de acesso** sem tempo constante em `client_policy.rs`: some com o código de
      acesso na Etapa 8.

## Antes da troca do grupo

- [ ] **A API da Etapa 1 no computador de casa**, com `PUBLIC_URL` no `.env`, antes de o app novo ir ao
      beta. Ela atende o app instalado (rota antiga) e o novo ao mesmo tempo.
- [ ] **O link depois do auto-update:** confirmar no beta que o instalador passivo registra o esquema
      `ashtar` (e, se não registrar, que o registro ao abrir cobre).
- [ ] **A página do convite no WhatsApp:** colar um link de convite num chat e conferir o cartão da prévia
      (título, texto e ícone).
- [ ] **Roteiro manual com dois computadores** da Etapa 8, inteiro, no beta.
- [ ] **Avisar o grupo** do que muda: ao abrir a versão nova, cada um vai precisar do link que você mandar.

## Riscos e cuidados

- [ ] **Hardware genérico:** quem cai na chave aleatória perde a conta ao formatar e precisa de uma
      recuperação. O log da Etapa 3 mostra quantos são no beta (ADR 0013).
- [ ] **A troca tem de ser junta** (Etapa 8): sem o código de acesso e com a rota antiga no ar, a rota velha
      daria token a qualquer um que mandasse a versão certa no cabeçalho. A API sobe sem a rota, com o
      `MIN_CLIENT_VERSION` novo e sem o `ACCESS_CODE`, numa vez só.
- [ ] **Contrato da API durante o beta:** o app instalado e o novo usam a mesma API. A Etapa 1 só acrescenta;
      o nome do participante no `voice/token` muda, mas só o app novo usa essa rota.
- [ ] **A barra própria** perde o menu de encaixe do Windows 11 (ADR 0012).
- [ ] **A trava de uma transmissão** continua só no app: um app modificado passa por cima. Para o grupo, dá
      para aceitar, como hoje.
- [ ] **Consultas repetidas pelo Funnel:** cada tela do servidor aberta faz uma chamada a cada 5 s, e o app
      do dono uma a cada 30 s. Se a API do computador de casa sentir, aumentar o intervalo (ADR 0012).
- [ ] **Minutos do GitHub Actions:** o Vitest e a conferência dos tipos gerados entram no job do Windows,
      que conta em dobro. Acompanhar o consumo do mês da troca.
- [ ] **Quem sai do beta** fica na versão que já tem até o estável passar dela (o updater não volta
      versão). Uma versão do beta que já estava baixada, esperando o reiniciar, também é instalada ao
      fechar o app.
- [ ] **O "Atualizar agora" da entrada espera sem notícia:** o updater não avisa quando não há versão nova
      (nem sem rede), então a tela espera até 2 minutos antes de desistir (Etapa 4.5). O
      `checkForUpdateNow` da Etapa 6.4 devolve o resultado e pode substituir essa espera; a troca fica
      para depois da 0.2.2.
