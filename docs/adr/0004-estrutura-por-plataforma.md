# 0004 — Código de sistema operacional isolado por plataforma

- **Status:** aceita
- **Data:** 2026-09

## Contexto

O app só roda no Windows hoje, mas a intenção é suportar Linux e, talvez, uma versão web. Parte do
código é inevitavelmente específica do Windows (WASAPI, ícones via GDI, geometria de monitores), e
misturá-la ao resto tornaria o suporte a outra plataforma uma reescrita.

## Decisão

- Todo código específico de um sistema operacional fica em `media/platform/<plataforma>/`, atrás de
  `#[cfg(target_os = "...")]`. A pasta do Windows se chama `win32`, e não `windows`, para não
  conflitar com o nome da crate `windows`.
- Em qualquer sistema sem implementação, `media/platform/unsupported.rs` fornece as mesmas funções,
  devolvendo valores padrão ou `AppError::Unsupported`.
- Só os pontos de entrada comuns (`media/sources.rs`, `media/audio.rs`) chamam `platform::`. O resto
  do código nunca usa `platform::win32` diretamente.
- As chamadas ao Windows usam a crate `windows-sys`, e recursos que precisam ser liberados (objetos
  GDI, device contexts) são embrulhados em guards RAII.

## Alternativas consideradas

- **Adiar a separação até existir uma segunda plataforma.** Mais barato agora, mas o código
  específico se espalharia e a separação futura custaria bem mais.
- **Declarações FFI escritas à mão.** Eram o que o protótipo usava; um tipo errado vira corrupção de
  memória silenciosa, e o `windows-sys` tem as declarações geradas a partir dos metadados do próprio
  Windows.

## Consequências

- O projeto compila em outro sistema sem implementação específica, e o frontend recebe um erro claro
  em vez de o build quebrar.
- O `unsupported.rs` não é verificado pelo compilador no Windows; ele deve continuar trivial.
- Uma versão para Linux entra como `platform/linux/`, sem mudar quem chama.
