//! Criação e ciclo de vida das threads de captura.
//!
//! Toda captura (áudio, vídeo, e futuras versões de outras plataformas) nasce
//! por [`spawn_capture`]. Garantias que este módulo dá:
//!
//! - o `on_end` é chamado exatamente uma vez, e só se a captura chegou a iniciar,
//!   inclusive em caso de panic. A captura pode avisar antes de terminar
//!   ([`CaptureContext::report`]), para o fim não esperar ela soltar os recursos;
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
        mpsc, Arc, Mutex, PoisonError,
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
    on_end: EndSlot,
}

/// O `on_end`, dividido entre o [`EndGuard`] e o [`CaptureContext::report`]: quem chamar primeiro
/// leva, e o outro não faz nada.
#[derive(Clone)]
struct EndSlot {
    on_end: Arc<Mutex<Option<OnEnd>>>,
    started: Arc<AtomicBool>,
}

impl EndSlot {
    fn call(&self, reason: EndReason) {
        if !self.started.load(Ordering::Acquire) {
            return;
        }
        let taken = self
            .on_end
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(f) = taken {
            f(reason);
        }
    }
}

impl EndGuard {
    fn finish(self, reason: EndReason) {
        self.on_end.call(reason);
    }
}

impl Drop for EndGuard {
    fn drop(&mut self) {
        self.on_end.call(EndReason::Error(
            "a thread de captura terminou inesperadamente".into(),
        ));
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
    end: EndSlot,
}

impl CaptureContext {
    /// Avisa o fim agora, antes de a thread soltar o que segura. Soltar a captura de uma janela
    /// que fechou pode demorar (ou travar, como visto no fim de uma partida do League of
    /// Legends); com o aviso antes, a sessão acaba na hora e o app pode seguir para a próxima
    /// fonte. O motivo que a thread devolver depois é ignorado.
    pub fn report(&self, reason: EndReason) {
        self.end.call(reason);
    }
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

    let end = EndSlot {
        on_end: Arc::new(Mutex::new(Some(on_end))),
        started: started.clone(),
    };
    let ctx = CaptureContext {
        stop: stop.clone(),
        ready: ReadySignal {
            tx: Some(tx),
            started,
        },
        end: end.clone(),
    };

    let guard = EndGuard { on_end: end };

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

    #[test]
    fn report_avisa_antes_de_a_thread_acabar_e_uma_vez_so() {
        let (on_end, rx) = on_end_probe();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let handle = spawn_capture("test-report", on_end, move |mut ctx| {
            ctx.ready.ok();
            ctx.report(EndReason::SourceClosed);
            // Segura a thread, como um `Drop` demorado.
            let _ = release_rx.recv();
            EndReason::Stopped
        })
        .expect("inicia");
        assert!(matches!(
            rx.recv_timeout(Duration::from_secs(1)),
            Ok(EndReason::SourceClosed)
        ));
        release_tx.send(()).unwrap();
        handle.stop_and_join();
        assert!(rx.recv_timeout(Duration::from_millis(100)).is_err());
    }
}
