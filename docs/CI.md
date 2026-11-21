# CI (GitHub Actions)

O repositório é público, então os minutos dos runners do GitHub (Ubuntu e Windows) são grátis e
sem cota. Mesmo assim, a esteira roda só o necessário, para o resultado chegar mais rápido:

| Workflow | Quando roda | Onde |
| --- | --- | --- |
| `ci-api.yml` | PR para dev/main que muda `api/` (ou os tipos gerados) | Ubuntu |
| `ci-app.yml` | PR para dev/main que muda o frontend do `desktop/` | Ubuntu |
| `ci-windows.yml` | PR para dev/main que muda `desktop/src-tauri/` | Windows |
| `release.yml` | Push na dev (beta) e na main (estável) | Ubuntu; o beta compila no Windows |
| `api-image.yml` | Manual | Ubuntu |

- Push em branch de feature não roda nada: o PR já cobre.
- Um push novo no PR cancela o run anterior do mesmo workflow.
- Todos os workflows de CI também têm Run workflow para rodar à mão.

## Repositório público: cuidados

- **Segredos:** ficam só nos Secrets do repositório; nunca em arquivo, log ou `echo`. PRs de
  fork não recebem os segredos.
- **PRs de fork:** em Settings > Actions > General, deixe "Require approval for all external
  contributors" (ou pelo menos para quem é novo), para um fork não rodar workflows sem você ver.
- **Sem runner próprio:** não registre um runner self-hosted neste repositório. Num repo
  público, qualquer PR de fork pode rodar código nessa máquina.
- Se o repositório voltar a ser privado, os minutos voltam a contar (Windows em dobro). Aí vale
  rever o job Windows, por exemplo para não rodar em PR rascunho.
