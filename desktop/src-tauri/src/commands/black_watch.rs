//! A conferência de tela preta da própria transmissão ([`crate::media::black`]): o app começa ao
//! transmitir (e não pausado) e para ao pausar ou parar. Cada mudança vai pelo `Channel`: `true`
//! começou a sair preta, `false` voltou a ter imagem.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use tauri::ipc::Channel;
use tauri::State;

use super::run_blocking;
use crate::error::AppError;
use crate::media::black::{looks_black, BlackWatch, CHECK_EVERY};
use crate::media::sources::SourceRef;
use crate::media::thumbnails::{self, ThumbnailsHandle};
use crate::media::SinkStatus;

#[derive(Default)]
pub struct BlackWatches {
    next_id: AtomicU64,
    open: Mutex<HashMap<u64, ThumbnailsHandle>>,
}

/// Começa a conferir `source` e devolve o id para parar.
#[tauri::command]
pub async fn black_watch_start(
    state: State<'_, BlackWatches>,
    source: SourceRef,
    channel: Channel<bool>,
) -> Result<u64, AppError> {
    let handle = run_blocking(move || {
        let mut watch = BlackWatch::default();
        let mut checked: Option<Instant> = None;
        thumbnails::spawn_thumbnails(
            vec![source],
            Box::new(move |_, jpeg| {
                let now = Instant::now();
                if checked.is_some_and(|at| now.duration_since(at) < CHECK_EVERY) {
                    return SinkStatus::Continue;
                }
                checked = Some(now);
                let Ok(image) = image::load_from_memory(jpeg) else {
                    return SinkStatus::Continue;
                };
                let black = looks_black(image.to_rgb8().as_raw());
                match watch.see(black, now) {
                    // A janela que pediu foi embora: para.
                    Some(change) if channel.send(change).is_err() => SinkStatus::Stop,
                    _ => SinkStatus::Continue,
                }
            }),
        )
    })
    .await?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    lock(&state)?.insert(id, handle);
    Ok(id)
}

/// Para a conferência `id`. Um id que não existe mais não faz nada.
#[tauri::command]
pub async fn black_watch_stop(state: State<'_, BlackWatches>, id: u64) -> Result<(), AppError> {
    let Some(handle) = lock(&state)?.remove(&id) else {
        return Ok(());
    };
    run_blocking(move || {
        handle.stop_and_join();
        Ok(())
    })
    .await
}

fn lock<'a>(
    state: &'a State<'_, BlackWatches>,
) -> Result<std::sync::MutexGuard<'a, HashMap<u64, ThumbnailsHandle>>, AppError> {
    state
        .open
        .lock()
        .map_err(|_| AppError::Internal("estado da conferência envenenado".into()))
}
