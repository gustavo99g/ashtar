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

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread::{self, JoinHandle},
};

use crate::error::AppError;

#[derive(Debug, Clone)]
pub enum EndReason {
    Stopped,
    SourceClosed,
    Error(String),
}

pub type OnEnd = Box<dyn FnOnce(EndReason) + Send + 'static>;

/// Garante que `on_end` seja chamado no máximo uma vez, e só se a captura
/// chegou a iniciar (`ReadySignal::ok`). Roda mesmo se a thread entrar em
/// panic, porque `Drop` executa durante o desempilhamento — combinado ao
/// hook de panic instalado em `main.rs`, isso faz um panic numa captura
/// aparecer no log e encerrar a sessão, em vez de deixar o app achando que
/// ainda está compartilhando.
struct EndGuard {
    on_end: Option<OnEnd>,
    started: Arc<AtomicBool>,
}

impl EndGuard {
    fn finish(mut self, reason: EndReason) {
        if let Some(f) = self.on_end.take() {
            if self.started.load(Ordering::Acquire) {
                f(reason);
            }
        }
    }
}

impl Drop for EndGuard {
    fn drop(&mut self) {
        if let Some(f) = self.on_end.take() {
            if self.started.load(Ordering::Acquire) {
                f(EndReason::Error(
                    "a thread de captura terminou inesperadamente".into(),
                ));
            }
        }
    }
}

/// Handle de uma thread de captura viva.
pub struct CaptureHandle {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl CaptureHandle {
    /// Não bloqueia. Seguro de qualquer lugar.
    pub fn request_stop(&self) {
        self.stop.store(true, Ordering::Release);
    }

    /// Espera a thread de captura terminar e libera os recursos dela.
    ///
    /// # Bloqueia
    ///
    /// Só chamar dentro de `spawn_blocking`, e nunca a partir da própria
    /// thread de captura.
    pub fn stop_and_join(mut self) {
        self.request_stop();

        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for CaptureHandle {
    fn drop(&mut self) {
        self.request_stop();
    }
}

pub struct CaptureContext {
    pub stop: Arc<AtomicBool>,
    pub ready: ReadySignal,
}

pub struct ReadySignal {
    tx: Option<mpsc::SyncSender<Result<(), AppError>>>,
    started: Arc<AtomicBool>,
}

impl ReadySignal {
    pub fn ok(&mut self) {
        self.started.store(true, Ordering::Release);

        if let Some(tx) = self.tx.take() {
            let _ = tx.send(Ok(()));
        }
    }

    pub fn fail(&mut self, error: AppError) {
        if let Some(tx) = self.tx.take() {
            let _ = tx.send(Err(error));
        }
    }
}

/// Cria a thread de captura padrão: nomeia a thread, espera a
/// inicialização (`CaptureContext::ready`) e garante que `on_end` seja
/// reportado exatamente uma vez. O corpo só precisa inicializar, chamar
/// `ctx.ready.ok()` ou `ctx.ready.fail(erro)`, rodar enquanto `ctx.stop`
/// for falso, e devolver o motivo do fim.
///
/// # Bloqueia
///
/// Espera a inicialização terminar antes de devolver. Só chamar dentro de
/// `spawn_blocking`.
pub fn spawn_capture(
    name: &str,
    on_end: OnEnd,
    body: impl FnOnce(CaptureContext) -> EndReason + Send + 'static,
) -> Result<CaptureHandle, AppError> {
    let stop = Arc::new(AtomicBool::new(false));
    let started = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::sync_channel(1);

    let ctx = CaptureContext {
        stop: stop.clone(),
        ready: ReadySignal {
            tx: Some(tx),
            started: started.clone(),
        },
    };

    let guard = EndGuard {
        on_end: Some(on_end),
        started,
    };

    let thread = thread::Builder::new()
        .name(name.into())
        .spawn(move || guard.finish(body(ctx)))
        .map_err(|e| AppError::Internal(e.to_string()))?;

    match rx.recv() {
        Ok(Ok(())) => Ok(CaptureHandle {
            stop,
            thread: Some(thread),
        }),
        Ok(Err(error)) => {
            let _ = thread.join();
            Err(error)
        }
        Err(_) => {
            let _ = thread.join();
            Err(AppError::Internal(format!(
                "{name} terminou antes de iniciar"
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn on_end_probe() -> (OnEnd, mpsc::Receiver<EndReason>) {
        let (tx, rx) = mpsc::channel();

        let on_end: OnEnd = Box::new(move |reason| {
            let _ = tx.send(reason);
        });

        (on_end, rx)
    }

    #[test]
    fn ok_then_stop_reports_stopped() {
        let (on_end, rx) = on_end_probe();

        let handle = spawn_capture("test-ok-stop", on_end, |mut ctx| {
            ctx.ready.ok();

            while !ctx.stop.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(1));
            }

            EndReason::Stopped
        })
        .expect("deveria iniciar com sucesso");

        handle.stop_and_join();

        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(EndReason::Stopped) => {}
            other => panic!("esperava EndReason::Stopped, veio {other:?}"),
        }
    }

    #[test]
    fn fail_returns_error_and_never_calls_on_end() {
        let (on_end, rx) = on_end_probe();

        let result = spawn_capture("test-fail", on_end, |mut ctx| {
            ctx.ready
                .fail(AppError::Internal("falhou de propósito".into()));
            EndReason::Stopped
        });

        assert!(matches!(result, Err(AppError::Internal(_))));
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
    }

    #[test]
    fn panic_after_ok_reports_error() {
        let (on_end, rx) = on_end_probe();

        let handle = spawn_capture("test-panic-after-ok", on_end, |mut ctx| {
            ctx.ready.ok();
            panic!("panic proposital depois do ok()");
        })
        .expect("deveria iniciar com sucesso");

        // A thread já panicou sozinha; só soltamos o handle (sem
        // stop_and_join, já que a thread não está mais rodando o loop).
        drop(handle);

        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(EndReason::Error(_)) => {}
            other => panic!("esperava EndReason::Error, veio {other:?}"),
        }
    }

    #[test]
    fn panic_before_ok_returns_internal_and_never_calls_on_end() {
        let (on_end, rx) = on_end_probe();

        let result = spawn_capture("test-panic-before-ok", on_end, |_ctx| {
            panic!("panic proposital antes do ok()");
        });

        assert!(matches!(result, Err(AppError::Internal(_))));
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
    }
}
