//! Comandos das miniaturas ao vivo (ADR 0019): começar, trocar as fontes e parar. Cada miniatura
//! vai pelo `Channel` do Tauri como bytes crus (`thumbnails::thumbnail_message`), sem base64.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::error::AppError;
use crate::media::sources::SourceRef;
use crate::media::thumbnails::{self, ThumbnailsHandle};
use crate::media::SinkStatus;

use super::run_blocking;

/// As miniaturas abertas, por id. O seletor abre uma, a própria transmissão (o preview) outra.
#[derive(Default)]
pub struct Thumbnails {
    next_id: AtomicU64,
    open: Mutex<HashMap<u64, ThumbnailsHandle>>,
}

/// Começa as miniaturas de `sources` e devolve o id para trocar as fontes e parar.
#[tauri::command]
pub async fn thumbnails_start(
    state: State<'_, Thumbnails>,
    sources: Vec<SourceRef>,
    channel: Channel<InvokeResponseBody>,
) -> Result<u64, AppError> {
    let handle = run_blocking(move || {
        thumbnails::spawn_thumbnails(
            sources,
            Box::new(move |source, jpeg| {
                let message = thumbnails::thumbnail_message(source, jpeg);
                // A janela que pediu foi embora (recarregou ou fechou): para.
                match channel.send(InvokeResponseBody::Raw(message)) {
                    Ok(()) => SinkStatus::Continue,
                    Err(_) => SinkStatus::Stop,
                }
            }),
        )
    })
    .await?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    lock(&state)?.insert(id, handle);
    Ok(id)
}

/// Troca as fontes das miniaturas `id`. Um id que não existe mais não faz nada.
#[tauri::command]
pub async fn thumbnails_update(
    state: State<'_, Thumbnails>,
    id: u64,
    sources: Vec<SourceRef>,
) -> Result<(), AppError> {
    if let Some(handle) = lock(&state)?.get(&id) {
        handle.set_sources(sources);
    }
    Ok(())
}

/// Para as miniaturas `id` e espera a thread terminar. Um id que não existe mais não faz nada.
#[tauri::command]
pub async fn thumbnails_stop(state: State<'_, Thumbnails>, id: u64) -> Result<(), AppError> {
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
    state: &'a State<'_, Thumbnails>,
) -> Result<std::sync::MutexGuard<'a, HashMap<u64, ThumbnailsHandle>>, AppError> {
    state
        .open
        .lock()
        .map_err(|_| AppError::Internal("estado das miniaturas envenenado".into()))
}
