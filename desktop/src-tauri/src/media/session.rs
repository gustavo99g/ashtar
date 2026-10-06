//! `ScreenShareManager`: a sessão de compartilhamento (vídeo + áudio opcional).
//!
//! Os comandos (`commands/screen_share.rs`) chamam este módulo. Ele não conhece o Tauri: avisa o
//! fim de uma sessão chamando o `on_event` que recebeu no `new`, e os comandos
//! transformam isso em eventos para o frontend.
//!
//! Garantias:
//!
//! - início atômico: ou o vídeo e o áudio pedido sobem, ou nada fica rodando
//!   (decisão 6 do `PLAN.md`);
//! - o aviso de fim de uma sessão sai exatamente uma vez, dado por quem
//!   removeu a sessão (decisão 8, ADR 0006);
//! - o fim do áudio sozinho não derruba o vídeo (decisão 7);
//! - pedidos de parada e ACKs de sessões antigas são ignorados (decisão 13).
//!
//! Regras:
//!
//! - as threads de captura nunca tocam no `Mutex` do manager: o `on_end` delas
//!   só manda um `SessionEvent` pelo canal. É isso que permite segurar o lock
//!   durante o início sem risco de deadlock;
//! - `start`, `start_with` e `stop` bloqueiam: chamar só dentro de
//!   `spawn_blocking`;
//! - o `ack` usa um lock próprio (`Shared::ack`), que só é travado por trocas
//!   rápidas: ele nunca espera um início ou um join. Quem precisa dos dois
//!   locks trava o do estado primeiro, nunca o contrário.

use std::{
    sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError},
    thread,
};

use tracing::{debug, info, warn};

use crate::{
    error::AppError,
    media::{
        audio::{spawn_audio_capture, AudioMode},
        video_capture::{spawn_video_capture, VideoCaptureConfig},
        AudioSink, CaptureHandle, EndReason, FrameGate, OnEnd, VideoSink,
    },
};

// ============================================================================
// Eventos
// ============================================================================

/// Aviso de uma captura para o manager. Sai do `on_end`, na thread da
/// captura, e é tratado na thread de eventos do manager (ADR 0006).
#[derive(Debug)]
enum SessionEvent {
    VideoEnded { session_id: u64, reason: EndReason },
    AudioEnded { session_id: u64, reason: EndReason },
}

/// Aviso do manager para fora; os comandos transformam em eventos do Tauri.
/// Sai exatamente uma vez por fim, de quem removeu a sessão (ou o áudio).
#[derive(Debug)]
pub enum ShareEvent {
    /// A sessão acabou (`screen-share-ended`).
    Ended { session_id: u64, reason: EndReason },
    /// Só o áudio acabou; o vídeo continua (`screen-share-audio-ended`).
    AudioEnded { session_id: u64, reason: EndReason },
}

type OnShareEvent = Box<dyn Fn(ShareEvent) + Send + Sync>;

// ============================================================================
// O estado
// ============================================================================

/// O portão da sessão atual, guardado à parte para o `ack` não disputar o
/// lock do estado (que o `start_with` segura durante a inicialização).
struct AckGate {
    session_id: u64,
    gate: FrameGate,
}

struct Session {
    id: u64,
    video: CaptureHandle,
    audio: Option<CaptureHandle>,
}

impl Session {
    /// Para as capturas da sessão e espera as threads terminarem.
    ///
    /// # Bloqueia
    ///
    /// Só chamar fora do lock do manager.
    fn shutdown(self) {
        // Pede a parada do áudio antes de esperar o vídeo, para as duas
        // threads encerrarem ao mesmo tempo.
        if let Some(audio) = &self.audio {
            audio.request_stop();
        }
        self.video.stop_and_join();

        if let Some(audio) = self.audio {
            audio.stop_and_join();
        }
    }
}

#[derive(Default)]
struct State {
    session: Option<Session>,
    last_id: u64,
}

/// A parte do manager que a thread de eventos também usa.
struct Shared {
    state: Mutex<State>,
    /// Só é travado por trocas rápidas, nunca durante um início ou um join.
    ack: Mutex<Option<AckGate>>,
    on_event: OnShareEvent,
}

impl Shared {
    /// Trava o estado. Se uma thread entrou em panic segurando o lock, o
    /// `Mutex` fica "envenenado"; aqui o estado continua consistente (cada
    /// alteração é uma única atribuição), então seguimos com ele.
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn lock_ack(&self) -> MutexGuard<'_, Option<AckGate>> {
        self.ack.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Desliga o ACK da sessão `session_id`, se ainda for o dela.
    fn clear_ack(&self, session_id: u64) {
        let mut ack = self.lock_ack();
        if ack.as_ref().is_some_and(|a| a.session_id == session_id) {
            *ack = None;
        }
    }

    fn handle_event(&self, event: SessionEvent) {
        match event {
            SessionEvent::VideoEnded { session_id, reason } => {
                let Some(session) = self.lock().session.take_if(|s| s.id == session_id) else {
                    debug!(
                        session_id,
                        "fim de vídeo de uma sessão que já saiu; ignorado"
                    );
                    return;
                };

                self.clear_ack(session_id);

                info!(
                    session_id,
                    ?reason,
                    "compartilhamento encerrado pela captura de vídeo"
                );
                (self.on_event)(ShareEvent::Ended { session_id, reason });
                session.shutdown();
            }
            SessionEvent::AudioEnded { session_id, reason } => {
                let audio = match self.lock().session.as_mut() {
                    Some(session) if session.id == session_id => session.audio.take(),
                    _ => None,
                };
                let Some(audio) = audio else {
                    debug!(
                        session_id,
                        "fim de áudio de uma sessão que já saiu; ignorado"
                    );
                    return;
                };
                warn!(
                    session_id,
                    ?reason,
                    "o áudio do compartilhamento caiu; o vídeo continua"
                );
                (self.on_event)(ShareEvent::AudioEnded { session_id, reason });
                audio.stop_and_join();
            }
        }
    }
}

// ============================================================================
// O manager
// ============================================================================

/// Dono da sessão de compartilhamento atual (no máximo uma por vez).
pub struct ScreenShareManager {
    shared: Arc<Shared>,
    events: mpsc::Sender<SessionEvent>,
}

impl ScreenShareManager {
    /// Cria o manager e a thread que trata os eventos das capturas.
    ///
    /// `on_event` é chamado uma vez por fim de sessão (ou de áudio), fora do
    /// lock, pela thread que removeu a sessão.
    ///
    /// A thread de eventos termina quando o manager é descartado e as capturas
    /// que ele iniciou terminam (o canal fecha).
    ///
    /// # Panics
    ///
    /// Se o sistema não conseguir criar a thread de eventos.
    pub fn new(on_event: impl Fn(ShareEvent) + Send + Sync + 'static) -> Self {
        let shared = Arc::new(Shared {
            state: Mutex::new(State::default()),
            ack: Mutex::new(None),
            on_event: Box::new(on_event),
        });

        let (events, rx) = mpsc::channel();
        let worker = Arc::clone(&shared);

        thread::Builder::new()
            .name("screen-share-events".to_string())
            .spawn(move || {
                for event in rx {
                    worker.handle_event(event);
                }
            })
            .expect("não foi possível criar a thread de eventos do compartilhamento");

        Self { shared, events }
    }

    /// Inicia um compartilhamento com a captura de vídeo e de áudio reais.
    ///
    /// Atômico: ver [`ScreenShareManager::start_with`].
    ///
    /// # Bloqueia
    ///
    /// Até as capturas inicializarem. Só chamar dentro de `spawn_blocking`.
    pub fn start(
        &self,
        video: VideoCaptureConfig,
        video_sink: impl VideoSink,
        audio: AudioMode,
        audio_sink: impl AudioSink,
    ) -> Result<u64, AppError> {
        let gate = video_sink.gate();

        self.start_with(
            gate,
            |on_end| spawn_video_capture(video, video_sink, on_end),
            |on_end| spawn_audio_capture(audio, audio_sink, on_end),
        )
    }

    /// Inicia uma sessão: primeiro o vídeo, depois o áudio.
    ///
    /// `start_video` e `start_audio` recebem o `on_end` já ligado a esta
    /// sessão e iniciam a captura (`start_audio` devolve `None` quando o áudio
    /// está desligado). `gate` é o portão do sink de vídeo, guardado para os
    /// ACKs.
    ///
    /// Atômico: se o áudio falhar, o vídeo já iniciado é parado e o erro volta.
    ///
    /// # Bloqueia
    ///
    /// Até as capturas inicializarem. Só chamar dentro de `spawn_blocking`.
    pub fn start_with(
        &self,
        gate: Option<FrameGate>,
        start_video: impl FnOnce(OnEnd) -> Result<CaptureHandle, AppError>,
        start_audio: impl FnOnce(OnEnd) -> Result<Option<CaptureHandle>, AppError>,
    ) -> Result<u64, AppError> {
        let mut state = self.shared.lock();

        if state.session.is_some() {
            return Err(AppError::AlreadySharing);
        }

        state.last_id += 1;
        let id = state.last_id;

        let video = start_video(self.on_end(id, Capture::Video))?;

        let audio = match start_audio(self.on_end(id, Capture::Audio)) {
            Ok(audio) => audio,
            Err(e) => {
                video.stop_and_join();
                return Err(e);
            }
        };

        info!(
            session_id = id,
            audio = audio.is_some(),
            "compartilhamento iniciado"
        );
        state.session = Some(Session { id, video, audio });

        // Ainda com o lock do estado: a ordem é sempre estado → ack, nunca o contrário.
        // Sempre sobrescreve, mesmo sem portão: assim nenhum portão de uma sessão
        // anterior sobrevive à troca.
        *self.shared.lock_ack() = gate.map(|gate| AckGate {
            session_id: id,
            gate,
        });

        Ok(id)
    }

    /// Para a sessão `session_id`, se ela ainda for a atual, e avisa
    /// `ShareEvent::Ended` com `EndReason::Stopped`. Idempotente: um id que
    /// já acabou devolve `Ok(())` sem avisar nada.
    ///
    /// # Bloqueia
    ///
    /// Até as threads de captura terminarem. Só chamar dentro de `spawn_blocking`.
    pub fn stop(&self, session_id: u64) -> Result<(), AppError> {
        let Some(session) = self.shared.lock().session.take_if(|s| s.id == session_id) else {
            debug!(
                session_id,
                "pedido de parada de uma sessão que já saiu; ignorado"
            );
            return Ok(());
        };
        self.shared.clear_ack(session_id);
        info!(session_id, "compartilhamento parado pelo usuário");
        (self.shared.on_event)(ShareEvent::Ended {
            session_id,
            reason: EndReason::Stopped,
        });
        session.shutdown();
        Ok(())
    }

    /// ACK de um frame do caminho IPC. Não bloqueia: usa só o lock do ACK, que
    /// ninguém segura por mais que uma troca. Ids de sessões antigas são
    /// ignorados: frames em trânsito de uma sessão encerrada ainda geram ACKs.
    pub fn ack(&self, session_id: u64) {
        match &*self.shared.lock_ack() {
            Some(AckGate {
                session_id: id,
                gate,
            }) if *id == session_id => gate.release(),
            _ => {}
        }
    }

    fn on_end(&self, id: u64, kind: Capture) -> OnEnd {
        let events = self.events.clone();
        Box::new(move |reason| {
            let event = match kind {
                Capture::Video => SessionEvent::VideoEnded {
                    session_id: id,
                    reason,
                },
                Capture::Audio => SessionEvent::AudioEnded {
                    session_id: id,
                    reason,
                },
            };
            let _ = events.send(event);
        })
    }
}

impl Drop for ScreenShareManager {
    /// Encerra a sessão que ainda estiver ativa. Sem isso, ela ficaria presa no
    /// `Shared`, que a thread de eventos segura, e as capturas nunca parariam.
    ///
    /// Não bloqueia: soltar os handles só pede a parada (o `Drop` do
    /// `CaptureHandle`). Também não avisa o `on_event`, porque quem descarta o
    /// manager está encerrando tudo.
    fn drop(&mut self) {
        let session = self.shared.lock().session.take();
        drop(session);
    }
}

#[derive(Clone, Copy)]
enum Capture {
    Video,
    Audio,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::spawn_capture;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

    // --- Ferramentas dos testes --------------------------------------------

    /// Um manager cujos avisos chegam ao teste por um canal.
    fn manager() -> (ScreenShareManager, mpsc::Receiver<ShareEvent>) {
        let (tx, rx) = mpsc::channel();
        let manager = ScreenShareManager::new(move |event| {
            let _ = tx.send(event);
        });
        (manager, rx)
    }

    fn next_event(rx: &mpsc::Receiver<ShareEvent>) -> ShareEvent {
        rx.recv_timeout(Duration::from_secs(1))
            .expect("esperava um aviso do manager")
    }

    fn assert_no_event(rx: &mpsc::Receiver<ShareEvent>) {
        if let Ok(event) = rx.recv_timeout(Duration::from_millis(200)) {
            panic!("aviso inesperado: {event:?}");
        }
    }

    /// Controle de uma captura falsa: `end` faz ela terminar sozinha (como
    /// uma janela fechada), `finished` diz se a thread já saiu do loop.
    struct FakeControl {
        end: mpsc::Sender<EndReason>,
        finished: Arc<AtomicBool>,
    }

    impl FakeControl {
        fn finished(&self) -> bool {
            self.finished.load(Ordering::Acquire)
        }
    }

    /// Espera até 1 s por uma condição que outra thread deve tornar verdadeira.
    fn wait_until(what: &str, condition: impl Fn() -> bool) {
        for _ in 0..200 {
            if condition() {
                return;
            }
            thread::sleep(Duration::from_millis(5));
        }
        panic!("tempo esgotado esperando: {what}");
    }

    /// Uma captura de mentira, construída sobre o `spawn_capture` de verdade.
    /// Devolve o controle e a função que a inicia (o que o `start_with` espera).
    fn fake_capture(
        name: &'static str,
    ) -> (
        FakeControl,
        impl FnOnce(OnEnd) -> Result<CaptureHandle, AppError>,
    ) {
        let (end_tx, end_rx) = mpsc::channel();
        let finished = Arc::new(AtomicBool::new(false));

        let control = FakeControl {
            end: end_tx,
            finished: Arc::clone(&finished),
        };

        let start = move |on_end: OnEnd| {
            spawn_capture(name, on_end, move |mut ctx| {
                ctx.ready.ok();

                let reason = loop {
                    if ctx.stop.load(Ordering::Acquire) {
                        break EndReason::Stopped;
                    }
                    if let Ok(reason) = end_rx.recv_timeout(Duration::from_millis(5)) {
                        break reason;
                    }
                };

                finished.store(true, Ordering::Release);
                reason
            })
        };

        (control, start)
    }

    fn no_audio(_on_end: OnEnd) -> Result<Option<CaptureHandle>, AppError> {
        Ok(None)
    }

    // --- Início e parada ---------------------------------------------

    #[test]
    fn inicia_e_para() {
        let (manager, events) = manager();
        let (video, start_video) = fake_capture("test-video");
        let (audio, start_audio) = fake_capture("test-audio");

        let id = manager
            .start_with(None, start_video, |on_end| start_audio(on_end).map(Some))
            .expect("deveria iniciar");

        manager.stop(id).unwrap();

        // O `stop` só volta depois das threads terminarem.
        assert!(video.finished() && audio.finished());
        assert!(matches!(
            next_event(&events),
            ShareEvent::Ended { session_id, reason: EndReason::Stopped } if session_id == id
        ));
        // O `VideoEnded` que a parada gera não encontra a sessão: nenhum aviso a mais.
        assert_no_event(&events);
    }

    #[test]
    fn recusa_inicio_duplo_e_libera_na_hora_da_parada() {
        let (manager, _events) = manager();
        let (_video, start_video) = fake_capture("test-video-1");

        let id = manager.start_with(None, start_video, no_audio).unwrap();

        let (_video2, start_video2) = fake_capture("test-video-2");
        let result = manager.start_with(None, start_video2, no_audio);
        assert!(matches!(result, Err(AppError::AlreadySharing)));

        manager.stop(id).unwrap();

        let (_video3, start_video3) = fake_capture("test-video-3");
        let second = manager
            .start_with(None, start_video3, no_audio)
            .expect("depois da parada, um novo início deveria funcionar na hora");
        assert_ne!(second, id);
    }

    #[test]
    fn falha_do_audio_desfaz_o_video() {
        let (manager, events) = manager();
        let (video, start_video) = fake_capture("test-video");

        let result = manager.start_with(None, start_video, |_on_end| {
            Err(AppError::AudioCapture("falha de teste".into()))
        });

        assert!(matches!(result, Err(AppError::AudioCapture(_))));
        assert!(
            video.finished(),
            "o vídeo que já tinha subido deveria ter parado"
        );
        assert_no_event(&events);

        let (_video2, start_video2) = fake_capture("test-video-2");
        assert!(manager.start_with(None, start_video2, no_audio).is_ok());
    }

    #[test]
    fn ignora_parada_e_ack_de_sessao_antiga() {
        let (manager, events) = manager();
        let (video, start_video) = fake_capture("test-video");
        let gate = FrameGate::new(1);

        let id = manager
            .start_with(Some(gate.clone()), start_video, no_audio)
            .unwrap();

        gate.enter();
        assert!(!gate.is_open());

        manager.ack(id + 1);
        assert!(
            !gate.is_open(),
            "ACK de outra sessão não pode abrir o portão"
        );

        manager.ack(id);
        assert!(gate.is_open());

        manager.stop(id + 1).unwrap();
        assert!(
            !video.finished(),
            "parada de outra sessão não pode parar esta"
        );
        assert_no_event(&events);

        manager.stop(id).unwrap();
    }
    #[test]
    fn ack_nao_espera_um_inicio_lento() {
        let (manager, _events) = manager();
        let manager = Arc::new(manager);
        let (_video, start_video) = fake_capture("test-video-lento");

        let starting = {
            let manager = Arc::clone(&manager);
            thread::spawn(move || {
                let slow_video = |on_end| {
                    thread::sleep(Duration::from_millis(500));
                    start_video(on_end)
                };
                manager.start_with(None, slow_video, no_audio)
            })
        };

        // Dá tempo de o início pegar o lock do estado.
        thread::sleep(Duration::from_millis(100));

        let before = Instant::now();
        manager.ack(99);
        assert!(
            before.elapsed() < Duration::from_millis(100),
            "o ack esperou o início: {:?}",
            before.elapsed()
        );

        let id = starting.join().unwrap().unwrap();
        manager.stop(id).unwrap();
    }

    #[test]
    fn soltar_o_manager_para_as_capturas() {
        let (manager, _events) = manager();
        let (video, start_video) = fake_capture("test-video");

        manager.start_with(None, start_video, no_audio).unwrap();
        drop(manager);

        wait_until("a captura parar", || video.finished());
    }

    #[test]
    fn falha_do_video_nao_deixa_sessao_nem_aviso() {
        let (manager, events) = manager();

        let result = manager.start_with(
            None,
            |_on_end| Err(AppError::VideoCapture("falha de teste".into())),
            no_audio,
        );

        assert!(matches!(result, Err(AppError::VideoCapture(_))));
        assert_no_event(&events);

        // Nada ficou preso: um novo início funciona.
        let (_video, start_video) = fake_capture("test-video");
        assert!(manager.start_with(None, start_video, no_audio).is_ok());
    }

    #[test]
    fn clear_ack_nao_apaga_o_portao_de_outra_sessao() {
        let (manager, _events) = manager();
        let shared = &manager.shared;

        *shared.lock_ack() = Some(AckGate {
            session_id: 2,
            gate: FrameGate::new(1),
        });

        // A sessão 1 já acabou, mas o portão guardado é o da 2: tem que ficar.
        shared.clear_ack(1);
        assert!(shared.lock_ack().is_some());

        shared.clear_ack(2);
        assert!(shared.lock_ack().is_none());
    }

    #[test]
    fn iniciar_sem_portao_apaga_o_portao_antigo() {
        let (manager, _events) = manager();
        *manager.shared.lock_ack() = Some(AckGate {
            session_id: 99,
            gate: FrameGate::new(1),
        });

        let (_video, start_video) = fake_capture("test-video");
        manager.start_with(None, start_video, no_audio).unwrap();

        assert!(
            manager.shared.lock_ack().is_none(),
            "o portão de uma sessão anterior não pode sobreviver"
        );
    }

    // --- Fim vindo das capturas --------------------------------------

    #[test]
    fn fonte_fechada_encerra_a_sessao() {
        let (manager, events) = manager();
        let (video, start_video) = fake_capture("test-video");
        let (audio, start_audio) = fake_capture("test-audio");

        let id = manager
            .start_with(None, start_video, |on_end| start_audio(on_end).map(Some))
            .unwrap();

        video.end.send(EndReason::SourceClosed).unwrap();

        assert!(matches!(
            next_event(&events),
            ShareEvent::Ended { session_id, reason: EndReason::SourceClosed } if session_id == id
        ));
        wait_until("o áudio parar junto", || audio.finished());

        // Parar uma sessão que já acabou não faz nada.
        manager.stop(id).unwrap();
        assert_no_event(&events);
    }

    #[test]
    fn queda_do_audio_mantem_o_video() {
        let (manager, events) = manager();
        let (video, start_video) = fake_capture("test-video");
        let (audio, start_audio) = fake_capture("test-audio");

        let id = manager
            .start_with(None, start_video, |on_end| start_audio(on_end).map(Some))
            .unwrap();

        audio
            .end
            .send(EndReason::Error("dispositivo sumiu".into()))
            .unwrap();

        assert!(matches!(
            next_event(&events),
            ShareEvent::AudioEnded { session_id, reason: EndReason::Error(message) }
                if session_id == id && message == "dispositivo sumiu"
        ));
        assert!(!video.finished(), "o vídeo deveria continuar");

        manager.stop(id).unwrap();
        assert!(matches!(
            next_event(&events),
            ShareEvent::Ended {
                reason: EndReason::Stopped,
                ..
            }
        ));
        assert_no_event(&events);
    }
}
