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

## Onde ficam as decisões técnicas

- [`PLAN.md`](PLAN.md) — plano em andamento (fase atual: reorganização/correções do protótipo de
  screen share, "marco-0"), com as decisões já tomadas registradas no topo.
- [`NOTES.md`](NOTES.md) — checklist dos problemas conhecidos do protótipo, o que já foi resolvido
  e o que foi conscientemente adiado.

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
