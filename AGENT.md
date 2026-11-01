# AGENT.md — preferências de trabalho neste repositório

Notas para qualquer agente (eu incluído) trabalhando neste projeto. Objetivo: não perder de vista
como o dono do repo quer que as coisas sejam feitas.

## Fluxo de git

- **Nunca** rodar `git commit` ou `git push` por conta própria.
- Fazer as alterações normalmente (código, arquivos, config).
- No final da tarefa, mostrar um resumo do que mudou e **perguntar se o usuário aceita**.
- Só depois da confirmação explícita, seguir com `git add` / `git commit` / `git push` (push só se
  fizer sentido pro pedido — nem toda confirmação de commit implica push).
- Exceção: comandos de git que só leem estado (`status`, `log`, `diff`, `show`) podem ser usados
  livremente para investigar, sem pedir permissão.

## Convenção de commits

Documentada em [`docs/commit-convention.md`](docs/commit-convention.md). Resumo: `tipo(escopo):
mensagem`, com `feat`/`chore`/`docs`/`fix` etc., escopo `desktop`/`api`/sem escopo. Seguir esse
formato em toda mensagem proposta ao usuário, mesmo antes da confirmação.

## Convencao de documentacao no codigo Rust

Documentada em [docs/rust-code-documentation.md](docs/rust-code-documentation.md): `//!` de modulo
(papel/quem usa/regras), secao `# Bloqueia` em funcoes que nao podem rodar no runtime async,
`// SAFETY:` em todo `unsafe`, e `#![warn(clippy::undocumented_unsafe_blocks)]` cobrando isso.
Aplicada em `media/`, `commands/` e nos arquivos-raiz.

## Onde ficam as decisões técnicas

- `PLAN.md` — plano em andamento, com as decisões
  já tomadas registradas no topo. Só existe durante uma fase: as fases até a v0.2.2 já estão arquivadas em `docs/plans/`.
- `NOTES.md` — checklist dos problemas e pendências da fase atual, o que já foi resolvido
  e o que foi conscientemente adiado.
- [`BACKLOG.md`](BACKLOG.md) — o que as fases anteriores adiaram, agrupado pela versão que deve recebê-lo.
  Ao começar uma fase, os itens dela saem do BACKLOG e entram no `NOTES.md`.
- [`docs/plans/`](docs/plans/) — planos e notas de fases concluídas, arquivados como estavam ao fechar
  (`v0.1-reorganizacao.md`, `v0.1-notes.md`, `v0.2.0-base-de-entrega.md`, `v0.2.0-notes.md`, `v0.2.1-identidade-na-api.md`, `v0.2.1-notes.md`, `v0.2.2-ui-nova.md`, `v0.2.2-notes.md`).

### Raiz vs. `docs/`

- **Raiz** = documentos de trabalho, estado atual da fase em andamento: `README.md`, `AGENT.md`,
  `PLAN.md`, `NOTES.md`, `BACKLOG.md`. Mudam a cada tarefa, ficam visiveis assim que alguem abre o repo.
- **`docs/`** = referencia/convencao, o que vale independente da fase (`commit-convention.md`,
  `rust-code-documentation.md`), e o arquivo das fases concluidas (`docs/plans/`). Editado com pouca frequencia, consultado quando surge a duvida
  ("qual o padrao de commit?", "como documento unsafe aqui?").

Novo documento de trabalho da fase atual entra na raiz; nova convencao estavel entra em `docs/`. Ao
fechar uma fase, o `PLAN.md` e o `NOTES.md` dela vao para `docs/plans/` com o nome da versao, e a raiz
recebe os da fase seguinte.

Antes de propor mudanças de arquitetura, checar se já existe uma decisão registrada nesses dois
arquivos em vez de decidir de novo.

## Comunicação

- Respostas em português.
- Preferência por confirmar suposições/ambiguidades antes de fazer mudanças grandes ou
  arquiteturais, em vez de assumir e seguir.
- Sempre que houver dúvida (ambiguidade no pedido, decisão de design não óbvia, algo que contradiz
  o `PLAN.md`/`NOTES.md`, etc.), perguntar antes de seguir em vez de assumir.
- Ao final de cada tarefa, sempre fazer um resumo do que foi modificado e/ou do raciocínio
  seguido — não só listar arquivos alterados, mas também decisões tomadas no caminho e por quê.
- Quando encontrar um bug real (não relacionado ao pedido) no meio de uma tarefa, é ok corrigir e
  avisar — mas sinalizar claramente que é algo à parte do pedido original.
