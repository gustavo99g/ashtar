# 0033 — Atividade e jogos

- **Status:** proposta (passa a aceita com o teste de três computadores da Etapa 10 da v0.8)
- **Data:** 2026-11

## Contexto

O roadmap previa o "Jogando X" ao lado do nick, visível para todos, com uma lista de jogos mantida pelo projeto. Em
22/11 o Kid mudou o rumo: o jogo não vira status, e serve para quem joga transmitir com um clique, num cartão em cima
dos próprios controles (quadros "Atividade — jogo detectado", "Configurações — atividade" e "Configurações —
adicionar jogo"). Manter uma lista de jogos à mão também não escala; os launchers instalados já sabem quais jogos o
PC tem.

## Decisão

**Só a própria pessoa vê o jogo.** Nada vai para a API nem para os outros: a detecção, as escolhas e os jogos
adicionados ficam no PC (`activity.json` na pasta de dados do app).

**O reconhecimento roda no Rust**, acordado pela troca de janela em primeiro plano (`EVENT_SYSTEM_FOREGROUND`) e, de
reserva, a cada 15 s. Pega o caminho do `.exe` da janela (`QueryFullProcessImageNameW`, com
`PROCESS_QUERY_LIMITED_INFORMATION`, sem ler memória de processo nenhum) e procura nas fontes, nessa ordem:

1. os jogos adicionados à mão;
2. os launchers do PC (Steam, Epic, Riot, EA, Ubisoft, Battle.net e GOG), lidos dos arquivos locais ao abrir o app,
   num mapa "pasta de instalação → nome": um `.exe` de dentro da pasta é aquele jogo;
3. a lista de jogos detectáveis do Discord (pública), buscada pela **API** uma vez por dia, reduzida a "nome do
   `.exe` → nome" e servida por `GET /api/games/detectable`; o app guarda a cópia. O IP de ninguém do grupo vai para o
   Discord, e a última cópia boa vale se a lista sumir;
4. um `games-extra.json` pequeno dentro do app, só para corrigir erros das outras fontes.

**O ícone** vem do launcher (a Steam guarda o do jogo em boa qualidade) ou do `.exe` no maior tamanho (até 256 px,
lista "jumbo" do `SHGetImageList`), em cache como PNG.

**O cartão** fica no `VoiceDock`, em cima do "Voz conectada" e do painel do usuário. "Transmitir" começa a
transmissão da janela do jogo com a última qualidade, sem abrir o seletor: na sala ou na ligação em que a pessoa
está; fora da voz, um popover para cima com as salas, que entra e transmite. Transmitindo, só a bolinha dourada. O menu
tem "Não mostrar para este jogo" e "Configurações de atividade". A aba Configurações › Atividade tem a chave geral,
os jogos já vistos com uma chave cada, e "Adicionar jogo" pelas janelas abertas.

## Consequências

- A detecção depende do formato dos arquivos dos launchers, que muda: cada leitor é separado, e o que falha só deixa
  de contar, com uma linha no log.
- A lista do Discord não é nossa e pode mudar ou ser bloqueada para a VPS; é só a terceira fonte.
- Com a chave geral desligada, nada roda.
