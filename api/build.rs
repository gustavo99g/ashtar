// O `sqlx::migrate!()` embute `migrations/` na compilação, mas o cargo não sabe que a pasta
// importa: sem isto, uma migração nova ou editada não força a recompilação.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
