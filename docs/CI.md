# CI (GitHub Actions)

O repositório é público, então os minutos dos runners do GitHub (Ubuntu e Windows) são grátis e
sem cota. Mesmo assim, a esteira roda só na dev e na main, e só o que mudou:

| Workflow | Quando roda | Onde |
| --- | --- | --- |
| `ci-api.yml` | Push na dev/main que muda `api/` (ou os tipos gerados) | Ubuntu |
| `ci-app.yml` | Push na dev/main que muda o frontend do `desktop/` | Ubuntu |
| `ci-windows.yml` | Push na dev/main que muda `desktop/src-tauri/` | Windows |
| `release.yml` | Push na dev (beta) e na main (estável) | Ubuntu; o beta roda as checagens completas e compila no Windows |
| `api-image.yml` | Manual | Ubuntu |

- Push em branch de feature e PR não rodam nada. O CI confere o que entrou na dev ou na main,
  depois do merge.
- Para checar uma branch antes do merge (por exemplo, Rust que só compila no Windows), use
  Actions > (workflow) > Run workflow, escolhendo a branch.
- Um push novo na mesma branch cancela o run anterior do mesmo workflow.

## Repositório público: cuidados

- **Segredos:** ficam só nos Secrets do repositório; nunca em arquivo, log ou `echo`. PRs de
  fork não recebem os segredos.
- **PRs de fork:** em Settings > Actions > General, deixe "Require approval for all external
  contributors" (ou pelo menos para quem é novo), para um fork não rodar workflows sem você ver.
- **Sem runner próprio:** não registre um runner self-hosted neste repositório. Num repo
  público, qualquer PR de fork pode rodar código nessa máquina.
- Se o repositório voltar a ser privado, os minutos voltam a contar (Windows em dobro). Aí vale
  rever o job Windows, por exemplo para não rodar em PR rascunho.

## Checagens antes do push

Como branch e PR não rodam o CI, o `.githooks/pre-push` roda as checagens rápidas no seu PC,
só nas áreas que mudaram desde a dev (ou desde o último push da branch):

- `api/`: `cargo fmt --check`.
- `desktop/src-tauri/`: `cargo fmt --check`.
- Resto do `desktop/`: lint, contrato dos temas, typecheck e testes.

Ative uma vez por clone com `git config core.hooksPath .githooks`. Para pular num push,
use `git push --no-verify`. O clippy e os testes do Rust ficam de fora por serem lentos: rode à
mão ou pelo Run workflow do CI Windows.
