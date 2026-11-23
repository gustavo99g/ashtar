# 0019 — Seletor de fontes próprio, com miniaturas ao vivo

- **Status:** aceita
- **Data:** 2026-11

## Contexto

A lista de fontes vinha do `DesktopCapturer` (ADR 0003), que descarta as janelas minimizadas, e o seletor
mostrava só ícones: as miniaturas estavam na v0.8 do roadmap, e o protótipo antigo as mandava como `Vec<u8>` em
JSON. Com a captura própria (ADR 0018), as duas coisas ficam ao alcance.

## Decisão

**A lista é própria:** as janelas pelo `EnumWindows`, com a regra do Alt + Tab (visível, com título, sem
`DWMWA_CLOAKED`, sem dono ou com `WS_EX_APPWINDOW`, fora do processo do app), **inclusive as minimizadas**, que
aparecem com o selo "Minimizada" e o ícone; as telas pelo `EnumDisplayMonitors`, com o tamanho real do WGC. Os ids
são o `HWND` e o `HMONITOR`.

**Miniaturas ao vivo:** uma captura do WGC por card visível (no máximo 24), reduzida na GPU para 480×270,
comprimida em JPEG a 8 fps, só quando a imagem muda, e enviada como bytes crus pelo `Channel` do Tauri. O seletor
diz quais cards estão à vista (`IntersectionObserver`). O preview de quem transmite é a miniatura da fonte em
uso.

**Escolher uma fonte a traz para a frente** (restaurando, se minimizada). Desde a v0.8 o app não se
minimiza mais: fica atrás da janela escolhida (pedido do Kid, 22/11).

**O Ashtar nunca aparece numa captura:** as janelas do app têm `WDA_EXCLUDEFROMCAPTURE`.

## Alternativas consideradas

- **Miniaturas em RGBA cru.** 520 KB por imagem a 480×270, várias vezes o JPEG de qualidade 80; com 24 cards a
  8 fps, seriam ~44 MB/s pelo `Channel`. O custo do JPEG é pequeno perto do da captura.
- **Uma imagem estática por janela, tirada ao abrir o seletor.** Mais barato, mas um jogo ou um vídeo pareceria
  parado, e a pessoa escolhe pelo que vê.
- **Esconder as minimizadas** (como antes). Era o item adiado duas vezes do `BACKLOG.md`.

## Consequências

- O seletor custa uma captura por card à vista enquanto está aberto; fechado, nada.
- O `SetForegroundWindow` só troca o foco se o app estiver em primeiro plano, o que vale no clique de
  "Compartilhar"; trocar a fonte pela bandeja pode não trazer a janela.
- A ADR 0003 fica substituída.
