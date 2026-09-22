//! Código do protótipo (marco-0), isolado sem alteração de lógica.
//!
//! Tudo aqui é candidato a remoção assim que as Etapas 4 e 5 do plano
//! substituírem o caminho de captura pelos módulos em `media/` e pelos
//! comandos novos em `commands/`. Remover esta fase deve ser só apagar
//! esta pasta e a linha `mod legacy;` em `lib.rs`.

pub mod audio;
pub mod commands;
pub mod screen_share;
