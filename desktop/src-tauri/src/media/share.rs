//! `ShareManager`: a transmissão nativa (vídeo, áudio e a conexão `:screen`) — ADR 0017.
//!
//! Os comandos (`commands/screen_share.rs`) chamam este módulo. Ele não conhece o Tauri: avisa o
//! fim de uma transmissão pelo `on_event` que recebeu no `new`, e os comandos transformam isso em
//! eventos para o frontend.
//!
//! As garantias são as do `ScreenShareManager` do IPC (ADR 0006), mais a conexão:
//!
//! - início atômico: ou o vídeo, a conexão e o áudio pedido sobem, ou nada fica rodando (e a
//!   `:screen` sai da sala);
//! - o aviso de fim sai exatamente uma vez, dado por quem removeu a sessão: a parada pelo usuário,
//!   o fim do vídeo (janela fechada, erro na GPU) ou a queda da conexão;
//! - o fim do áudio sozinho não derruba o vídeo;
//! - pedidos de parada e de ajuste de sessões antigas são ignorados.
//!
//! Regras:
//!
//! - as threads de captura e a conexão nunca tocam no `Mutex` do manager: os avisos delas só
//!   mandam um `SessionEvent` pelo canal. É isso que permite segurar o lock durante o início;
//! - `start`, `update` e `stop` bloqueiam: chamar só dentro de `spawn_blocking`.

use std::{
    path::Path,
    sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError},
    thread,
};

use tracing::{debug, info, warn};

use crate::{
    error::AppError,
    media::{
        audio::{spawn_audio_capture, AudioMode},
        encoded::{Fanout, H264File},
        publisher::{Publisher, ShareTarget},
        sources::SourceRef,
        video::{self, VideoCommand, VideoConfig, VideoControl, VideoFormat, VideoStats},
        CaptureHandle, EndReason, OnEnd,
    },
};

// ============================================================================
// O que entra e o que sai
// ============================================================================

/// Tudo que o início precisa.
#[derive(Debug, Clone)]
pub struct ShareRequest {
    pub video: VideoConfig,
    pub audio: AudioMode,
    /// O nivelador do áudio (`leveler.rs`) começa ligado ou não.
    pub leveler: bool,
    pub target: ShareTarget,
}

/// Um ajuste no meio da transmissão. A trilha na sala continua a mesma: quem assiste não sai da
/// tela.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShareChange {
    Format(VideoFormat),
    Source(SourceRef),
    Cursor(bool),
    Paused(bool),
    Audio(AudioMode),
    Leveler(bool),
}

/// Aviso do manager para fora; os comandos transformam em eventos do Tauri.
#[derive(Debug)]
pub enum ShareEvent {
    /// A transmissão acabou (`screen-share-ended`).
    Ended { session_id: u64, reason: EndReason },
    /// Só o áudio acabou; o vídeo continua (`screen-share-audio-ended`).
    AudioEnded { session_id: u64, reason: EndReason },
}

type OnShareEvent = Box<dyn Fn(ShareEvent) + Send + Sync>;
/// O aviso de queda da conexão, com a descrição.
pub type OnLinkLost = Box<dyn FnOnce(String) + Send + 'static>;

/// A conexão com a sala, do ponto de vista do manager. A de verdade é a [`NativeLink`]; os testes
/// usam uma de mentira.
pub trait Link: Send + 'static {
    /// Publica o áudio e inicia a captura dele. `Ok(None)` para `AudioMode::Off`.
    fn start_audio(
        &mut self,
        mode: AudioMode,
        on_end: OnEnd,
    ) -> Result<Option<CaptureHandle>, AppError>;
    /// Tira o áudio da sala (a captura já parou).
    fn stop_audio(&mut self);
    fn set_paused(&self, paused: bool);
    /// Liga ou desliga o nivelador do áudio. Vale para o áudio de agora e para os próximos.
    fn set_leveler(&self, enabled: bool);
    /// Sai da sala.
    fn close(self: Box<Self>);
}

/// O que o início entrega ao manager.
pub struct Started {
    pub video: CaptureHandle,
    pub control: VideoControl,
    pub stats: VideoStats,
    pub link: Box<dyn Link>,
}

/// Os avisos de fim, já ligados à sessão, para quem inicia.
pub struct Ends {
    pub video: OnEnd,
    pub link_lost: OnLinkLost,
}

// ============================================================================
// O estado
// ============================================================================

#[derive(Debug)]
enum SessionEvent {
    VideoEnded {
        session_id: u64,
        reason: EndReason,
    },
    AudioEnded {
        session_id: u64,
        /// Qual das capturas de áudio da sessão: trocar o áudio começa outra.
        audio_id: u64,
        reason: EndReason,
    },
    LinkLost {
        session_id: u64,
        message: String,
    },
}

/// Uma captura de áudio da sessão, com o número dela.
struct Audio {
    id: u64,
    handle: CaptureHandle,
}

struct Session {
    id: u64,
    video: CaptureHandle,
    audio: Option<Audio>,
    /// O número da última captura de áudio começada.
    last_audio: u64,
    control: VideoControl,
    stats: VideoStats,
    link: Box<dyn Link>,
}

impl Session {
    /// Para as capturas, espera as threads e sai da sala.
    ///
    /// # Bloqueia
    ///
    /// Só chamar fora do lock do manager.
    fn shutdown(self) {
        // A sala primeiro sabe que acabou pela saída da `:screen`; as threads param juntas.
        if let Some(audio) = &self.audio {
            audio.handle.request_stop();
        }
        self.video.request_stop();
        self.link.close();
        self.video.stop_and_join();
        if let Some(audio) = self.audio {
            audio.handle.stop_and_join();
        }
    }
}

#[derive(Default)]
struct State {
    session: Option<Session>,
    last_id: u64,
}

struct Shared {
    state: Mutex<State>,
    on_event: OnShareEvent,
}

impl Shared {
    /// Trava o estado. Um panic com o lock deixa o estado consistente (cada alteração é uma
    /// única atribuição), então seguimos com ele.
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Remove a sessão `session_id`, se ainda for a atual, avisa o fim e encerra o resto.
    fn end(&self, session_id: u64, reason: EndReason) {
        let Some(session) = self.lock().session.take_if(|s| s.id == session_id) else {
            debug!(
                session_id,
                ?reason,
                "fim de uma transmissão que já saiu; ignorado"
            );
            return;
        };
        info!(session_id, ?reason, "transmissão encerrada");
        (self.on_event)(ShareEvent::Ended { session_id, reason });
        session.shutdown();
    }

    fn handle_event(&self, event: SessionEvent) {
        match event {
            SessionEvent::VideoEnded { session_id, reason } => self.end(session_id, reason),
            SessionEvent::LinkLost {
                session_id,
                message,
            } => self.end(session_id, EndReason::Error(message)),
            SessionEvent::AudioEnded {
                session_id,
                audio_id,
                reason,
            } => {
                let audio = match self.lock().session.as_mut() {
                    Some(session) if session.id == session_id => {
                        session.audio.take_if(|a| a.id == audio_id)
                    }
                    _ => None,
                };
                let Some(audio) = audio else {
                    debug!(session_id, "fim de áudio que já saiu; ignorado");
                    return;
                };
                warn!(
                    session_id,
                    ?reason,
                    "o áudio da transmissão caiu; o vídeo continua"
                );
                (self.on_event)(ShareEvent::AudioEnded { session_id, reason });
                audio.handle.stop_and_join();
                if let Some(session) = self.lock().session.as_mut() {
                    if session.id == session_id {
                        session.link.stop_audio();
                    }
                }
            }
        }
    }
}

// ============================================================================
// O manager
// ============================================================================

/// Dono da transmissão atual (no máximo uma por vez).
pub struct ShareManager {
    shared: Arc<Shared>,
    events: mpsc::Sender<SessionEvent>,
}

impl ShareManager {
    /// Cria o manager e a thread que trata os avisos das capturas e da conexão.
    ///
    /// # Panics
    ///
    /// Se o sistema não conseguir criar a thread.
    pub fn new(on_event: impl Fn(ShareEvent) + Send + Sync + 'static) -> Self {
        let shared = Arc::new(Shared {
            state: Mutex::new(State::default()),
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
            .expect("não foi possível criar a thread de eventos da transmissão");
        Self { shared, events }
    }

    /// Inicia uma transmissão de verdade: entra na sala, começa o vídeo, publica e começa o áudio.
    ///
    /// # Bloqueia
    ///
    /// Até tudo começar. Só chamar dentro de `spawn_blocking`.
    pub fn start(&self, request: ShareRequest) -> Result<u64, AppError> {
        let ShareRequest {
            video,
            audio,
            leveler,
            target,
        } = request;
        self.start_with(|ends| start_native(video, &target, leveler, ends), audio)
    }

    /// Inicia uma sessão com `start` (que entrega o vídeo e a conexão) e, depois, o áudio.
    ///
    /// Atômico: se o áudio falhar, o vídeo e a conexão são encerrados e o erro volta.
    ///
    /// # Bloqueia
    ///
    /// Até tudo começar. Só chamar dentro de `spawn_blocking`.
    pub fn start_with(
        &self,
        start: impl FnOnce(Ends) -> Result<Started, AppError>,
        audio: AudioMode,
    ) -> Result<u64, AppError> {
        let mut state = self.shared.lock();
        if state.session.is_some() {
            return Err(AppError::AlreadySharing);
        }
        state.last_id += 1;
        let id = state.last_id;

        let Started {
            video,
            control,
            stats,
            mut link,
        } = start(self.ends(id))?;

        let audio = match link.start_audio(audio, self.on_audio_end(id, 1)) {
            Ok(audio) => audio.map(|handle| Audio { id: 1, handle }),
            Err(error) => {
                video.request_stop();
                link.close();
                video.stop_and_join();
                return Err(error);
            }
        };

        info!(
            session_id = id,
            audio = audio.is_some(),
            "transmissão iniciada"
        );
        state.session = Some(Session {
            id,
            video,
            audio,
            last_audio: 1,
            control,
            stats,
            link,
        });
        Ok(id)
    }

    /// Ajusta a transmissão `session_id`, se ela ainda for a atual.
    ///
    /// Na troca de áudio, a captura atual para e outra começa; se a nova falhar, o erro volta e a
    /// transmissão segue sem áudio. O resto vai para o pipeline, que não falha por isso.
    ///
    /// # Bloqueia
    ///
    /// Na troca de áudio, até a captura nova começar. Só chamar dentro de `spawn_blocking`.
    pub fn update(&self, session_id: u64, change: ShareChange) -> Result<(), AppError> {
        let mut state = self.shared.lock();
        let Some(session) = state.session.as_mut().filter(|s| s.id == session_id) else {
            debug!(
                session_id,
                ?change,
                "ajuste de uma transmissão que já saiu; ignorado"
            );
            return Ok(());
        };
        info!(session_id, ?change, "ajuste na transmissão");
        match change {
            ShareChange::Format(format) => session.control.send(VideoCommand::Format(format)),
            ShareChange::Source(source) => session.control.send(VideoCommand::Source(source)),
            ShareChange::Cursor(enabled) => session.control.send(VideoCommand::Cursor(enabled)),
            ShareChange::Paused(paused) => {
                session.control.send(VideoCommand::Paused(paused));
                session.link.set_paused(paused);
            }
            ShareChange::Leveler(enabled) => session.link.set_leveler(enabled),
            ShareChange::Audio(mode) => {
                // Parada por nós: o `AudioEnded` que ela gera não encontra o áudio e não avisa.
                if let Some(audio) = session.audio.take() {
                    audio.handle.stop_and_join();
                    session.link.stop_audio();
                }
                session.last_audio += 1;
                let audio_id = session.last_audio;
                let on_end = self.on_audio_end(session_id, audio_id);
                session.audio = session.link.start_audio(mode, on_end)?.map(|handle| Audio {
                    id: audio_id,
                    handle,
                });
            }
        }
        Ok(())
    }

    /// Os números do vídeo da transmissão `session_id`, se ela ainda for a atual.
    pub fn stats(&self, session_id: u64) -> Option<VideoStats> {
        self.shared
            .lock()
            .session
            .as_ref()
            .filter(|s| s.id == session_id)
            .map(|s| s.stats.clone())
    }

    /// Para a transmissão `session_id` e avisa `Ended` com `Stopped`. Idempotente.
    ///
    /// # Bloqueia
    ///
    /// Até as threads terminarem e a `:screen` sair. Só chamar dentro de `spawn_blocking`.
    pub fn stop(&self, session_id: u64) -> Result<(), AppError> {
        self.shared.end(session_id, EndReason::Stopped);
        Ok(())
    }

    fn ends(&self, id: u64) -> Ends {
        let video = self.events.clone();
        let link = self.events.clone();
        Ends {
            video: Box::new(move |reason| {
                let _ = video.send(SessionEvent::VideoEnded {
                    session_id: id,
                    reason,
                });
            }),
            link_lost: Box::new(move |message| {
                let _ = link.send(SessionEvent::LinkLost {
                    session_id: id,
                    message,
                });
            }),
        }
    }

    fn on_audio_end(&self, id: u64, audio_id: u64) -> OnEnd {
        let events = self.events.clone();
        Box::new(move |reason| {
            let _ = events.send(SessionEvent::AudioEnded {
                session_id: id,
                audio_id,
                reason,
            });
        })
    }
}

impl Drop for ShareManager {
    /// Encerra a transmissão que ainda estiver ativa, sem avisar (quem descarta o manager está
    /// fechando o app).
    fn drop(&mut self) {
        if let Some(session) = self.shared.lock().session.take() {
            session.shutdown();
        }
    }
}

// ============================================================================
// O caminho de verdade
// ============================================================================

/// A conexão de verdade: o [`Publisher`] e a captura de áudio de hoje.
struct NativeLink {
    publisher: Publisher,
}

impl Link for NativeLink {
    fn start_audio(
        &mut self,
        mode: AudioMode,
        on_end: OnEnd,
    ) -> Result<Option<CaptureHandle>, AppError> {
        if mode == AudioMode::Off {
            return Ok(None);
        }
        let sink = self.publisher.publish_audio()?;
        match spawn_audio_capture(mode, sink, on_end) {
            Ok(Some(handle)) => Ok(Some(handle)),
            Ok(None) => {
                self.publisher.unpublish_audio();
                Ok(None)
            }
            Err(error) => {
                self.publisher.unpublish_audio();
                Err(error)
            }
        }
    }

    fn stop_audio(&mut self) {
        self.publisher.unpublish_audio();
    }

    fn set_paused(&self, paused: bool) {
        self.publisher.set_paused(paused);
    }

    fn set_leveler(&self, enabled: bool) {
        self.publisher.set_leveler(enabled);
    }

    fn close(self: Box<Self>) {
        self.publisher.close();
    }
}

/// Entra na sala, começa o vídeo e publica a trilha do tipo que o vídeo abriu.
fn start_native(
    config: VideoConfig,
    target: &ShareTarget,
    leveler: bool,
    ends: Ends,
) -> Result<Started, AppError> {
    let mut publisher = Publisher::connect(target, ends.link_lost)?;
    publisher.set_leveler(leveler);
    let mut sink = Fanout::new().with(publisher.video_sink());
    // Para conferir a imagem que saiu do encoder: `ASHTAR_DUMP_H264=C:\caminho\tela.h264` grava
    // o H.264 da transmissão (abre com o ffplay).
    if let Some(path) = std::env::var_os("ASHTAR_DUMP_H264") {
        match H264File::create(Path::new(&path)) {
            Ok(file) => sink = sink.with(file),
            Err(error) => warn!(%error, "não deu para criar o .h264 de diagnóstico"),
        }
    }
    let (video, control, stats) = match video::spawn_video(config, sink, ends.video) {
        Ok(started) => started,
        Err(error) => {
            publisher.close();
            return Err(error);
        }
    };
    let snapshot = stats.snapshot(std::time::Instant::now());
    let published = publisher.publish_video(
        &snapshot.encoder,
        (snapshot.width, snapshot.height),
        config.format,
        control.clone(),
    );
    if let Err(error) = published {
        video.request_stop();
        publisher.close();
        video.stop_and_join();
        return Err(error);
    }
    Ok(Started {
        video,
        control,
        stats,
        link: Box::new(NativeLink { publisher }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::spawn_capture;
    use crate::media::video::EncoderKind;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    // --- Ferramentas dos testes --------------------------------------------

    fn manager() -> (ShareManager, mpsc::Receiver<ShareEvent>) {
        let (tx, rx) = mpsc::channel();
        let manager = ShareManager::new(move |event| {
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

    fn wait_until(what: &str, condition: impl Fn() -> bool) {
        for _ in 0..200 {
            if condition() {
                return;
            }
            thread::sleep(Duration::from_millis(5));
        }
        panic!("tempo esgotado esperando: {what}");
    }

    /// Controle de uma captura de mentira: `end` faz ela terminar sozinha, `finished` diz se a
    /// thread já saiu.
    #[derive(Clone)]
    struct Fake {
        end: mpsc::Sender<EndReason>,
        finished: Arc<AtomicBool>,
    }

    impl Fake {
        fn finished(&self) -> bool {
            self.finished.load(Ordering::Acquire)
        }
    }

    /// Uma captura de mentira sobre o `spawn_capture` de verdade.
    fn fake_capture(name: &'static str, on_end: OnEnd) -> (Fake, CaptureHandle) {
        let (end, end_rx) = mpsc::channel();
        let finished = Arc::new(AtomicBool::new(false));
        let done = Arc::clone(&finished);
        let handle = spawn_capture(name, on_end, move |mut ctx| {
            ctx.ready.ok();
            let reason = loop {
                if ctx.stop.load(Ordering::Acquire) {
                    break EndReason::Stopped;
                }
                if let Ok(reason) = end_rx.recv_timeout(Duration::from_millis(5)) {
                    break reason;
                }
            };
            done.store(true, Ordering::Release);
            reason
        })
        .unwrap();
        (Fake { end, finished }, handle)
    }

    /// O que a conexão de mentira registrou, e as capturas de áudio que ela começou.
    #[derive(Clone, Default)]
    struct Record {
        calls: Arc<Mutex<Vec<String>>>,
        audio: Arc<Mutex<Vec<Fake>>>,
        link_lost: Arc<Mutex<Option<OnLinkLost>>>,
    }

    impl Record {
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
        fn audio(&self, i: usize) -> Fake {
            self.audio.lock().unwrap()[i].clone()
        }
    }

    struct FakeLink {
        record: Record,
        fail_audio: bool,
    }

    impl Link for FakeLink {
        fn start_audio(
            &mut self,
            mode: AudioMode,
            on_end: OnEnd,
        ) -> Result<Option<CaptureHandle>, AppError> {
            if mode == AudioMode::Off {
                return Ok(None);
            }
            if self.fail_audio {
                return Err(AppError::AudioCapture("falha de teste".into()));
            }
            self.record
                .calls
                .lock()
                .unwrap()
                .push("publica áudio".into());
            let (fake, handle) = fake_capture("test-audio", on_end);
            self.record.audio.lock().unwrap().push(fake);
            Ok(Some(handle))
        }
        fn stop_audio(&mut self) {
            self.record.calls.lock().unwrap().push("tira áudio".into());
        }
        fn set_paused(&self, paused: bool) {
            self.record
                .calls
                .lock()
                .unwrap()
                .push(format!("pausa {paused}"));
        }
        fn set_leveler(&self, enabled: bool) {
            self.record
                .calls
                .lock()
                .unwrap()
                .push(format!("nivela {enabled}"));
        }
        fn close(self: Box<Self>) {
            self.record.calls.lock().unwrap().push("sai da sala".into());
        }
    }

    /// Um início de mentira: vídeo falso e conexão falsa. Devolve o controle do vídeo, os
    /// comandos que ele recebe e o que a conexão registra.
    struct Setup {
        video: Arc<Mutex<Option<Fake>>>,
        commands: Arc<Mutex<Option<mpsc::Receiver<VideoCommand>>>>,
        record: Record,
    }

    impl Setup {
        fn new() -> Self {
            Self {
                video: Arc::default(),
                commands: Arc::default(),
                record: Record::default(),
            }
        }

        fn start(&self, fail_audio: bool) -> impl FnOnce(Ends) -> Result<Started, AppError> {
            let (video_slot, commands_slot, record) = (
                Arc::clone(&self.video),
                Arc::clone(&self.commands),
                self.record.clone(),
            );
            move |ends: Ends| {
                let (fake, video) = fake_capture("test-video", ends.video);
                *video_slot.lock().unwrap() = Some(fake);
                *record.link_lost.lock().unwrap() = Some(ends.link_lost);
                let (control, rx) = VideoControl::new();
                *commands_slot.lock().unwrap() = Some(rx);
                Ok(Started {
                    video,
                    control,
                    stats: VideoStats::new(EncoderKind::Software, "Teste".into(), 1),
                    link: Box::new(FakeLink { record, fail_audio }),
                })
            }
        }

        fn video(&self) -> Fake {
            self.video.lock().unwrap().clone().unwrap()
        }

        fn commands(&self) -> Vec<VideoCommand> {
            self.commands
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .try_iter()
                .collect()
        }
    }

    const SYSTEM: AudioMode = AudioMode::System;

    // --- Início e parada ---------------------------------------------------

    #[test]
    fn inicia_e_para() {
        let (manager, events) = manager();
        let setup = Setup::new();
        let id = manager.start_with(setup.start(false), SYSTEM).unwrap();

        manager.stop(id).unwrap();

        assert!(setup.video().finished() && setup.record.audio(0).finished());
        assert_eq!(setup.record.calls(), ["publica áudio", "sai da sala"]);
        assert!(matches!(
            next_event(&events),
            ShareEvent::Ended { session_id, reason: EndReason::Stopped } if session_id == id
        ));
        // O fim do vídeo que a parada gera não encontra a sessão: nenhum aviso a mais.
        assert_no_event(&events);
    }

    #[test]
    fn recusa_inicio_duplo() {
        let (manager, _events) = manager();
        let (first, second) = (Setup::new(), Setup::new());
        let id = manager
            .start_with(first.start(false), AudioMode::Off)
            .unwrap();
        assert!(matches!(
            manager.start_with(second.start(false), AudioMode::Off),
            Err(AppError::AlreadySharing)
        ));
        manager.stop(id).unwrap();
        assert!(manager
            .start_with(second.start(false), AudioMode::Off)
            .is_ok());
    }

    #[test]
    fn falha_do_audio_desfaz_tudo() {
        let (manager, events) = manager();
        let setup = Setup::new();
        let result = manager.start_with(setup.start(true), SYSTEM);

        assert!(matches!(result, Err(AppError::AudioCapture(_))));
        assert!(setup.video().finished(), "o vídeo deveria ter parado");
        assert_eq!(setup.record.calls(), ["sai da sala"]);
        assert_no_event(&events);
    }

    #[test]
    fn falha_do_inicio_nao_deixa_sessao_nem_aviso() {
        let (manager, events) = manager();
        let result = manager.start_with(
            |_ends| Err(AppError::Publish("sala cheia".into())),
            AudioMode::Off,
        );
        assert!(matches!(result, Err(AppError::Publish(_))));
        assert_no_event(&events);
        assert!(manager
            .start_with(Setup::new().start(false), AudioMode::Off)
            .is_ok());
    }

    // --- Fim vindo de fora -------------------------------------------------

    #[test]
    fn janela_fechada_encerra_e_sai_da_sala() {
        let (manager, events) = manager();
        let setup = Setup::new();
        let id = manager.start_with(setup.start(false), SYSTEM).unwrap();

        setup.video().end.send(EndReason::SourceClosed).unwrap();

        assert!(matches!(
            next_event(&events),
            ShareEvent::Ended { session_id, reason: EndReason::SourceClosed } if session_id == id
        ));
        wait_until("o áudio parar junto", || setup.record.audio(0).finished());
        assert!(setup.record.calls().contains(&"sai da sala".to_string()));
        manager.stop(id).unwrap();
        assert_no_event(&events);
    }

    #[test]
    fn queda_da_conexao_encerra_uma_vez() {
        let (manager, events) = manager();
        let setup = Setup::new();
        let id = manager
            .start_with(setup.start(false), AudioMode::Off)
            .unwrap();

        let lost = setup.record.link_lost.lock().unwrap().take().unwrap();
        lost("o servidor caiu".into());

        assert!(matches!(
            next_event(&events),
            ShareEvent::Ended { session_id, reason: EndReason::Error(message) }
                if session_id == id && message == "o servidor caiu"
        ));
        wait_until("o vídeo parar", || setup.video().finished());
        assert_no_event(&events);
    }

    #[test]
    fn queda_do_audio_mantem_o_video() {
        let (manager, events) = manager();
        let setup = Setup::new();
        let id = manager.start_with(setup.start(false), SYSTEM).unwrap();

        setup
            .record
            .audio(0)
            .end
            .send(EndReason::Error("dispositivo sumiu".into()))
            .unwrap();

        assert!(matches!(
            next_event(&events),
            ShareEvent::AudioEnded { session_id, .. } if session_id == id
        ));
        wait_until("a trilha de áudio sair", || {
            setup.record.calls().contains(&"tira áudio".to_string())
        });
        assert!(!setup.video().finished(), "o vídeo deveria continuar");
        manager.stop(id).unwrap();
    }

    // --- Ajustes -----------------------------------------------------------

    #[test]
    fn ajustes_vao_para_o_video_e_a_pausa_tambem_para_a_trilha() {
        let (manager, _events) = manager();
        let setup = Setup::new();
        let id = manager
            .start_with(setup.start(false), AudioMode::Off)
            .unwrap();

        manager.update(id, ShareChange::Cursor(false)).unwrap();
        manager
            .update(id, ShareChange::Source(SourceRef::Window(7)))
            .unwrap();
        manager.update(id, ShareChange::Paused(true)).unwrap();
        manager.update(id, ShareChange::Leveler(false)).unwrap();

        assert_eq!(
            setup.commands(),
            [
                VideoCommand::Cursor(false),
                VideoCommand::Source(SourceRef::Window(7)),
                VideoCommand::Paused(true),
            ]
        );
        // O nivelador vai para a conexão, que divide a chave com o áudio: o vídeo não sabe dele.
        assert_eq!(setup.record.calls(), ["pausa true", "nivela false"]);
        manager.stop(id).unwrap();
    }

    #[test]
    fn trocar_o_audio_encerra_o_antigo_sem_aviso() {
        let (manager, events) = manager();
        let setup = Setup::new();
        let id = manager.start_with(setup.start(false), SYSTEM).unwrap();

        manager
            .update(
                id,
                ShareChange::Audio(AudioMode::Application { process_id: 42 }),
            )
            .unwrap();
        assert!(
            setup.record.audio(0).finished(),
            "o áudio antigo deveria ter parado"
        );
        assert!(!setup.record.audio(1).finished());

        manager
            .update(id, ShareChange::Audio(AudioMode::Off))
            .unwrap();
        assert!(setup.record.audio(1).finished());
        assert_eq!(
            setup.record.calls(),
            ["publica áudio", "tira áudio", "publica áudio", "tira áudio"]
        );
        // Paradas pedidas por nós não viram aviso de queda.
        assert_no_event(&events);
        manager.stop(id).unwrap();
    }

    #[test]
    fn ignora_ajuste_e_parada_de_sessao_antiga() {
        let (manager, events) = manager();
        let setup = Setup::new();
        let id = manager
            .start_with(setup.start(false), AudioMode::Off)
            .unwrap();

        manager.update(id + 1, ShareChange::Paused(true)).unwrap();
        manager.stop(id + 1).unwrap();

        assert!(setup.commands().is_empty());
        assert!(!setup.video().finished());
        assert!(manager.stats(id + 1).is_none());
        assert!(manager.stats(id).is_some());
        assert_no_event(&events);
        manager.stop(id).unwrap();
    }

    #[test]
    fn soltar_o_manager_para_tudo() {
        let (manager, _events) = manager();
        let setup = Setup::new();
        manager.start_with(setup.start(false), SYSTEM).unwrap();
        drop(manager);
        assert!(setup.video().finished());
        assert!(setup.record.calls().contains(&"sai da sala".to_string()));
    }
}
