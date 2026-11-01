# 0012 — Arquitetura do frontend

- **Status:** aceita
- **Data:** 2026-10

## Contexto

A v0.2.2 refaz a casca do app a partir do protótipo (o canvas "Clone do Discord — telas"): entrada por
convite, tela do servidor, sala, configurações e Painel de controle. O `desktop/` da v0.2.0 cresceu por
tipo de arquivo (`components/voice` ao lado de `features/voice`, `pages/`, `stores/navigation.ts`), com um
chat de mentira, telas de login de exemplo e um `lib/api.ts` único. A v0.2.3 traz o chat com WebSocket, e
as telas da v0.2.2 precisam recebê-lo sem ser refeitas. Só uma pessoa programa, então as regras de onde
cada coisa mora precisam ser cobradas pelas ferramentas, não pela memória.

## Decisão

**Pastas por domínio.** `app/` (bootstrap, providers, router), `routes/` (telas de rota,
finas), `layouts/` (`AppShell`), `features/*` (`voice`, `screen-share`, `identity`, `settings`, `updater`,
e `chat` na v0.2.3), `components/ui` (o design system, sem regra de negócio), `lib/api`, `lib/query`, `lib/tauri` (e
`lib/realtime` na v0.2.3) e `styles/`. Cada feature guarda os seus componentes, o `queries.ts`, o store e
um `index.ts`, que é a única porta de entrada para o resto do app.

**Regras cobradas pelo ESLint, no CI.** `components/ui` não importa `features`. Uma feature só usa o
`index.ts` de outra (`eslint-plugin-boundaries`, que pega também o caminho relativo). Só `lib/tauri`
importa `@tauri-apps`. Só `lib/api` chama `fetch` e só `lib/realtime` abre `WebSocket`
(`no-restricted-globals`). Só `features/voice` importa a `Room` do `livekit-client`.

**Estado: um lugar para cada tipo.** Dados do servidor ficam no TanStack Query, em camadas: `lib/api/*` são
funções sem React; `features/*/queries.ts` guarda as chaves e os hooks e é o único que mexe no cache do seu
domínio; `lib/query` (o `queryClient`) só tenta de novo em erro de rede, fim do tempo e erro 5xx, nunca em erro de
regra. Ele fica em `lib/` e não em `app/` porque as features também usam a instância fora de componentes (limpar o cache ao sair do grupo, os eventos do chat), e uma feature não importa `app/`. O que precisa ser quase ao vivo na v0.2.2 é consulta repetida (`refetchInterval`): quem está na sala
a cada 5 s, com a tela visível, e os membros para o aviso do dono a cada 30 s. O estado do app (conexão de
voz, preferências locais como o tema) fica no zustand. A mídia fica no LiveKit, pelo `VoiceProvider`, que
vive em `app/`, acima das rotas. Segredos nunca chegam ao frontend (ADR 0013).

**Navegação.** Router de memória (`createMemoryRouter`). A rota diz o que se vê (entrada, servidor, sala,
configurações); o store guarda só a conexão de voz. As configurações são rotas desenhadas por cima do
`AppShell`, o ESC volta para a rota anterior e trocar de rota não derruba a chamada.

**Componentes.** O shadcn (estilo `base-vega`, Base UI, `cva`, ícones do Lucide) gera o `components/ui`,
ajustado aos tokens e com os estados de carregando, vazio, erro, offline e conectando. As features montam
as peças do domínio em cima dele. Não há catálogo de componentes: o canvas faz esse papel.

**Tokens e temas.** Os nomes do shadcn são a base, com os extras do app em volta. Três camadas:
`primitives.css` com a paleta crua; `styles/themes/*.css`, em que cada tema preenche o mesmo contrato; e o
`App.css`, com `@theme inline` e `--color-*: initial`, que desliga a paleta padrão do Tailwind. O contrato
cobre também o que o shadcn usa fora dos nomes dele (o fundo escuro do diálogo e o texto branco do botão de
perigo). A troca é por `data-theme`, com um registro em `styles/themes/index.ts`, e um script no CI confere
que cada tema define o contrato inteiro. O tema muda só cor, raio e no máximo fonte. Por enquanto só existe
o tema escuro do canvas.

**Tipos da API.** Gerados do Rust com o `ts-rs` para dentro de `lib/api`; o CI confere se os arquivos
gerados estão em dia. Os comandos do Tauri continuam escritos à mão em `lib/tauri/commands/` (era um arquivo só até a ADR 0014).

**Janela.** 1440 × 900, o tamanho dos quadros, com mínimo de 1000 × 640. Numa tela que não comporta (a
primeira abertura, sem nada gravado), ela fica com 90% da área útil do monitor, centralizada. Sem a barra do
Windows (`decorations: false`): a barra de título é do app, e o `tauri-plugin-window-state` lembra o
tamanho e a posição. Toda tela funciona do mínimo até uma tela grande maximizada.

**Testes.** Vitest e Testing Library para a lógica (stores, erros do `apiFetch`, cor do nick, campo de
colar o convite), rodando no CI do desktop.

## Alternativas consideradas

- **`specta` e `tauri-specta`**, que gerariam os tipos da API e dos comandos juntos: ainda em release
  candidate (2.0.0-rc.25). O `ts-rs` é estável (12.0.1) e os comandos são poucos.
- **Router com hash ou com o histórico do navegador:** o app não tem barra de endereço, o link do convite
  chega pelo deep link e o token vive só na memória, então toda recarga passa pela entrada de qualquer
  jeito. O hash só ajudaria a recarga no desenvolvimento.
- **Catálogo de componentes (Ladle):** o canvas já mostra cada tela e estado; um catálogo seria uma segunda
  fonte para manter igual.
- **Tudo no zustand, sem TanStack Query:** cache, nova tentativa, consulta repetida e invalidação teriam de
  ser escritos à mão, e o chat da v0.2.3 precisa de todos.
- **SSE (`GET /api/events`) para o quase ao vivo:** mais uma conexão longa pelo Funnel, ainda sem teste,
  para ser trocada pelo WebSocket do chat na versão seguinte. A consulta repetida custa pouco para um
  grupo de 10 pessoas.
- **Manter as pastas por tipo:** foi o que espalhou a voz por três pastas.
- **Janela de 1280 × 800** (a escolha até 18/10): cabe em quase toda tela, mas abre menor que os quadros.
  Com o ajuste à área útil na primeira abertura, os 1440 × 900 servem também num notebook de 1366 × 768.
- **A barra do Windows:** destoa dos quadros. Com a barra própria, o menu de encaixe do Windows 11 (passar o
  mouse no Maximizar) some; arrastar até a borda e Win + setas continuam.

## Consequências

- Uma feature nova é uma pasta nova com o seu `index.ts`; o ESLint recusa atalhos entre features.
- O cache de cada domínio tem um dono só (`queries.ts`). Na v0.2.3, o `realtime.ts` da feature atualiza o
  mesmo cache com os eventos do WebSocket, e as telas não mudam.
- Toda recarga, inclusive no desenvolvimento, volta para a entrada.
- O app do dono faz uma chamada a cada 30 s, e cada tela do servidor aberta, uma a cada 5 s. O aviso de
  quem entrou pode atrasar até 30 s.
- Mudar um tipo da API no Rust sem regenerar o TypeScript deixa o CI vermelho.
- A troca de tema fica pronta por baixo; a opção só aparece nas configurações quando existir um segundo
  tema, com o contraste conferido.
- Rever quando chegar o chat (`lib/realtime` e o fim da consulta repetida), um segundo tema, uma segunda
  janela (a transmissão destacada, por exemplo) ou se o `tauri-specta` sair estável.
- Desde a v0.2.3, o tempo real é o WebSocket da ADR 0015 (`lib/realtime` e um `realtime.ts` por feature), e
  as consultas repetidas só rodam com ele fora.
