# Convenção de commits

Este é um monorepo (`api/`, `desktop/`, `docs/`), então o commit sempre deixa claro **onde** a
mudança aconteceu além do **tipo** de mudança. O padrão observado no histórico do projeto é uma
versão enxuta do [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<escopo>): <mensagem curta>
```

## Tipos usados até agora

| Tipo    | Quando usar                                                              |
|---------|---------------------------------------------------------------------------|
| `feat`  | Funcionalidade nova (endpoint, componente, integração, tela).            |
| `chore` | Setup, configuração, dependências, reorganização de pastas — sem mudar comportamento visível para o usuário. |
| `docs`  | Só documentação (README, roadmap, notas, planos).                       |

Tipos padrão do Conventional Commits que ainda não apareceram no histórico mas são válidos aqui
se a mudança pedir: `fix` (correção de bug), `refactor` (mudança interna sem alterar comportamento),
`test`, `perf`, `style`.

## Escopos

O escopo é o pacote do monorepo afetado:

- `desktop` — o app Tauri (`desktop/`).
- `api` — o backend (`api/`).
- **sem escopo** (`feat: ...`, `chore: ...`, `docs: ...`) — quando a mudança é transversal (ex.:
  `docs: readme e roadmap atualizados`) ou afeta a raiz do repositório, não um pacote específico.

Exemplos reais do histórico:

```
feat(desktop): add livekit integration
feat(api): add livekit token room generation
chore(desktop): initial tauri setup
chore(api): create initial axum and tokio api setup
docs: readme and roadmap updated
feat: adicionado streaming de audio do tauri para o react
```

## Mensagem

- Curta, resume o quê, não o como (detalhes ficam no corpo do commit ou na descrição do PR, se
  precisar).
- Português ou inglês, o que já foi usado nos dois — mantenha consistência no mesmo commit
  (não misture os dois na mesma mensagem).
- Sem ponto final.

## Commits fora do padrão

Alguns commits recentes (correções de tracing/panic hook, limpeza de `println!`) saíram sem tipo
nem escopo (`"inicializa tracing e hook de panic"`, `"corrige filtro de tracing: ..."`). Não é o
padrão do projeto — deveriam ter sido `chore(desktop): inicializa tracing e hook de panic` e
`fix(desktop): corrige filtro de tracing que RUST_LOG vazio silenciava`. A partir de agora, siga o
formato `tipo(escopo): mensagem` para todo commit em `desktop/` ou `api/`.
