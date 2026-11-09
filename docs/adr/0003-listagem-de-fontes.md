# 0003 — Listagem de fontes vinda do `DesktopCapturer`

- **Status:** substituída por 0019 (v0.2.4)
- **Data:** 2026-09

## Contexto

O protótipo listava janelas com `EnumWindows` e monitores com `EnumDisplayMonitors`, e depois passava
esses ids para o capturer. Isso tinha dois problemas:

- A lista podia incluir fontes que o capturer não aceita, que só falhavam na hora de compartilhar.
- Os ids de monitor não batem: o libwebrtc identifica telas pelo índice do `EnumDisplayDevicesW`, não
  pelo `HMONITOR`. Com um monitor só, a correspondência pode acontecer por coincidência.

## Decisão

O `DesktopCapturer` é a fonte da verdade sobre **quais fontes existem e quais são seus ids**. A
listagem pede a ele as janelas e as telas, e a plataforma só complementa cada item:

- para janelas: o PID do processo e o ícone, e a decisão de esconder a janela (as do próprio app);
- para monitores: posição, tamanho e se é o principal, obtidos cruzando o índice do libwebrtc com o
  `GetMonitorInfoW` pelo nome do dispositivo (`\\.\DISPLAY1`).

A listagem bloqueia (enumeração e extração de ícones) e roda dentro de `spawn_blocking`.

## Alternativas consideradas

- **Manter a enumeração própria e mapear os ids.** Mais código, e a lista continuaria podendo
  divergir do que o capturer aceita.

## Consequências

- Toda fonte listada é capturável; `SourceNotFound` só acontece se a janela fechar entre a listagem e
  o início do compartilhamento.
- A listagem em si é código compartilhado entre plataformas; só o complemento é específico.
- Os filtros de janela (invisíveis, ocultas, de ferramenta) são os do libwebrtc. Se aparecerem
  janelas indesejadas, filtros próprios entram no complemento da plataforma.
- O mapeamento de monitores ainda precisa ser confirmado com dois monitores conectados.
