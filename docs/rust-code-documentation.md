# Convenção de documentação no código Rust (`desktop/src-tauri`)

Este projeto não é uma biblioteca pública, mas tem bastante FFI e regras de concorrência fáceis de
quebrar sem perceber (threads que não podem bloquear o runtime async, handles que precisam de
`Drop`, `unsafe` por todo lado no Win32). A convenção abaixo existe para que essas regras fiquem
escritas perto do código que as protege, não só na cabeça de quem escreveu.

Aplicada hoje em `media/` e nos arquivos-raiz (`error.rs`, `lib.rs`, `main.rs`). Ainda não foi
aplicada em `legacy/`, que é código do protótipo candidato a remoção (ver `PLAN.md`/`NOTES.md`).

## 1. `//!` no topo de cada módulo: o "porquê" e as regras

Todo arquivo com código real (não os stubs vazios do esqueleto de `media/`) começa com um
comentário de módulo (`//!`) dizendo:

- o papel do módulo;
- quem usa ele (outros módulos, comandos futuros);
- as regras/garantias que ele protege.

Nomes entre `[colchetes]` viram links clicáveis na doc gerada, e o compilador avisa se o item
deixar de existir (link quebrado). Exemplo real, `media/capture.rs`:

```rust
//! Criação e ciclo de vida das threads de captura.
//!
//! Toda captura (áudio, vídeo, e futuras versões de outras plataformas) nasce
//! por [`spawn_capture`]. Garantias que este módulo dá:
//!
//! - o `on_end` é chamado exatamente uma vez, e só se a captura chegou a iniciar,
//!   inclusive em caso de panic;
//! - um [`CaptureHandle`] esquecido pede a parada da thread no `Drop`.
//!
//! Regras para quem usa:
//!
//! - [`spawn_capture`] e [`CaptureHandle::stop_and_join`] bloqueiam: chamar só
//!   dentro de `spawn_blocking`;
//! - nunca chamar `stop_and_join` a partir da própria thread de captura.
```

## 2. `# Bloqueia`: seção fixa para funções que não podem rodar no runtime async

O Rust já tem a convenção de seções como `# Panics` e `# Safety` em doc comments (`///`). Este
projeto acrescenta uma própria, sempre com esse título exato, em toda função que bloqueia a thread
chamadora (I/O síncrono, `join`, `recv` bloqueante etc.):

```rust
/// Espera a thread de captura terminar e libera os recursos dela.
///
/// # Bloqueia
///
/// Só chamar dentro de `spawn_blocking`, e nunca a partir da própria
/// thread de captura.
pub fn stop_and_join(mut self) { ... }
```

Usar sempre o título `# Bloqueia` (não variações como "Blocking" ou "Nota"), porque a convenção só
vale alguma coisa se for buscável: `rg "# Bloqueia" -A2 src-tauri/src` lista toda função que não
pode ser chamada do runtime async, num lugar só.

Hoje marcadas assim: `spawn_capture`, `CaptureHandle::stop_and_join`, `list_capture_sources`,
`capturer_sources`, `icon_data_url`, `find_icon`, `ask_window_icon`, `window_details`,
`monitor_details`.

## 3. `// SAFETY:` acima de todo bloco `unsafe`

Convenção oficial do Rust, aplicada com rigor no FFI do Win32 (`media/platform/win32/**`), que é
onde mora o maior risco do projeto. O comentário explica **por que aquela chamada específica é
seguro**, não o que ela faz:

```rust
// SAFETY: o Vec vive até o fim desta função, e EnumDisplayMonitors só
// retorna depois de chamar o callback para todos os monitores.
unsafe {
    EnumDisplayMonitors(ptr::null_mut(), ptr::null(), Some(collect_monitor), data)
};
```

Vale também para `unsafe` em testes (ex.: `GetForegroundWindow` nos testes de `window.rs`), e para
o corpo de funções `unsafe extern "system"` usadas como callback (o que garante que o Windows só as
chama com ponteiros/estado válidos).

### Aplicação automática: clippy

```rust
// lib.rs
#![warn(clippy::undocumented_unsafe_blocks)]
```

Com isso, todo `unsafe` sem o comentário `// SAFETY:` imediatamente acima vira aviso do
`cargo clippy`. Rodar `cargo clippy` antes de commitar código com FFI novo é o jeito de saber se
esqueceu algum.

## 4. Ler tudo como site navegável

```bash
cargo doc --document-private-items --open
```

O `--document-private-items` é essencial aqui: num app (ao contrário de uma lib publicada), quase
tudo é privado (`pub(crate)` ou sem `pub` nenhum), e é justamente esse código privado — threads de
captura, FFI do Win32 — que mais precisa da documentação acima. Sem a flag, o `cargo doc` mostraria
uma doc quase vazia.

`cargo doc` também valida os links entre colchetes do item 1: um `[nome_errado]` vira warning de
"link não resolvido" na geração da doc, o que serve como teste de que a documentação não ficou
desatualizada.

## Ao adicionar código novo em `media/` (ou onde essa convenção se aplicar)

1. Todo módulo novo (`mod foo;` com conteúdo real) ganha um `//!` no topo.
2. Toda função que bloqueia ganha `# Bloqueia` no doc comment.
3. Todo `unsafe { ... }` novo ganha `// SAFETY:` explicando por que aquela chamada específica é
   segura, antes de escrever o código — não depois, quando já esqueceu o raciocínio.
4. Antes de commitar: `cargo clippy` (sem avisos de `undocumented_unsafe_blocks`) e
   `cargo doc --document-private-items` (sem links quebrados).
