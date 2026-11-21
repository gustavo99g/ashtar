# CI (GitHub Actions)

O repositório é privado, então o GitHub cobra os minutos de Actions de uma cota mensal, e o
minuto de Windows conta em dobro. A esteira foi montada para gastar o mínimo:

| Workflow | Quando roda | Onde |
| --- | --- | --- |
| `ci-api.yml` | PR para dev/main que muda `api/` (ou os tipos gerados) | Ubuntu |
| `ci-app.yml` | PR para dev/main que muda o frontend do `desktop/` | Ubuntu |
| `ci-windows.yml` | PR **não rascunho** que muda `desktop/src-tauri/` | Windows |
| `release.yml` | Push na dev (beta) e na main (estável) | Ubuntu; o beta compila no Windows |
| `api-image.yml` | Manual | Ubuntu |

- Push em branch de feature não roda nada: o PR já cobre.
- Num PR rascunho, o Rust do desktop não é checado. Ele roda quando o PR é marcado como pronto
  para revisão. Para rodar antes, use Actions > CI Windows > Run workflow, na branch do PR.
- Todos os workflows de CI também têm Run workflow para rodar à mão.

## Runner próprio no Windows

Os jobs de Windows (`ci-windows.yml` e o beta do `release.yml`) leem o runner da variável do
repositório `WINDOWS_RUNNER`. Sem ela, usam o `windows-latest` do GitHub. Com um runner no seu
PC, esses minutos não contam na cota.

1. No GitHub: Settings > Actions > Runners > New self-hosted runner > Windows. Siga os comandos
   da página no PowerShell (baixar, `config.cmd` e, de preferência, instalar como serviço quando
   o `config.cmd` perguntar). Os rótulos padrão `self-hosted` e `Windows` bastam.
2. O PC precisa ter o que o build já usa: Git for Windows (o `bash` precisa estar no PATH do
   serviço), Rust (`rustup`), as Build Tools do Visual Studio com C++ e o WebView2. Node e
   pnpm são instalados pelo próprio workflow.
3. Em Settings > Secrets and variables > Actions > Variables, crie `WINDOWS_RUNNER` com o valor
   `["self-hosted","windows"]`.

Para voltar ao runner do GitHub, apague a variável. Com o PC desligado, os jobs de Windows
ficam na fila até ele voltar (por até 24 h).
