//! Teste de ponta a ponta da transmissão nativa contra um LiveKit local.
//!
//! Precisa de uma área de trabalho, de um `livekit-server --dev` rodando
//! (`scripts/livekit-dev.ps1`) e é `#[ignore]`:
//!
//! ```text
//! cargo test --lib share_e2e -- --ignored --nocapture
//! ASHTAR_FORCE_SOFTWARE_ENCODER=1 cargo test --lib share_e2e -- --ignored --nocapture
//! ```
//!
//! Uma `:screen` publica a tela principal; um assinante da própria crate confere o vídeo (codec e
//! fps), o áudio, a pausa e a saída da sala ao parar.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use livekit::prelude::*;
use livekit::webrtc::video_stream::native::NativeVideoStream;
use livekit_api::access_token::{AccessToken, VideoGrants};
use tauri::async_runtime;

use super::audio::AudioMode;
use super::platform::list_monitors;
use super::publisher::ShareTarget;
use super::quality::Quality;
use super::share::{ShareChange, ShareEvent, ShareManager, ShareRequest};
use super::sources::SourceRef;
use super::video::VideoConfig;

const ROOM: &str = "ashtar-e2e";

fn url() -> String {
    std::env::var("ASHTAR_LIVEKIT_URL").unwrap_or_else(|_| "ws://127.0.0.1:7880".into())
}

/// Um token do `--dev` (chave `devkey`, segredo `secret`).
fn token(identity: &str, grants: VideoGrants) -> String {
    AccessToken::with_api_key("devkey", "secret")
        .with_identity(identity)
        .with_grants(grants)
        .to_jwt()
        .expect("token")
}

/// O mesmo token que a API dá à `:screen` (Etapa 4): só publica a tela, não assina.
fn screen_token() -> String {
    token(
        "e2e:screen",
        VideoGrants {
            room_join: true,
            room: ROOM.into(),
            can_publish: Some(true),
            can_subscribe: Some(false),
            can_publish_data: Some(false),
            can_publish_sources: vec!["screen_share".into(), "screen_share_audio".into()],
            ..Default::default()
        },
    )
}

fn viewer_token() -> String {
    token(
        "e2e-viewer",
        VideoGrants {
            room_join: true,
            room: ROOM.into(),
            can_publish: Some(false),
            can_subscribe: Some(true),
            ..Default::default()
        },
    )
}

fn primary() -> SourceRef {
    let monitor = list_monitors()
        .into_iter()
        .find(|m| m.info.is_primary)
        .expect("nenhuma tela principal");
    SourceRef::Monitor(monitor.id)
}

/// O que o assinante viu.
#[derive(Debug, PartialEq)]
enum Seen {
    Video { mime: String },
    Audio,
    Muted,
    Gone,
}

#[test]
#[ignore = "precisa de área de trabalho e de um livekit-server --dev"]
fn transmite_assiste_pausa_e_para() {
    let (seen_tx, seen) = mpsc::channel();
    let frames = Arc::new(AtomicU32::new(0));

    // O assinante entra primeiro e anota tudo que vê da `:screen`.
    let (viewer, mut events) = async_runtime::block_on(Room::connect(
        &url(),
        &viewer_token(),
        RoomOptions::default(),
    ))
    .expect("o assinante entra");
    let counter = Arc::clone(&frames);
    async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            let seen = match event {
                RoomEvent::TrackSubscribed {
                    track: RemoteTrack::Video(track),
                    publication,
                    ..
                } => {
                    let counter = Arc::clone(&counter);
                    async_runtime::spawn(async move {
                        let mut stream = NativeVideoStream::new(track.rtc_track());
                        while stream.next().await.is_some() {
                            counter.fetch_add(1, Ordering::Relaxed);
                        }
                    });
                    Seen::Video {
                        mime: publication.mime_type(),
                    }
                }
                RoomEvent::TrackSubscribed {
                    track: RemoteTrack::Audio(_),
                    ..
                } => Seen::Audio,
                RoomEvent::TrackMuted { .. } => Seen::Muted,
                RoomEvent::ParticipantDisconnected(_) => Seen::Gone,
                _ => continue,
            };
            let _ = seen_tx.send(seen);
        }
    });

    let (ended_tx, ended) = mpsc::channel();
    let manager = ShareManager::new(move |event| {
        let _ = ended_tx.send(event);
    });
    let id = manager
        .start(ShareRequest {
            video: VideoConfig {
                source: primary(),
                format: Quality::Detail.format(),
                cursor: true,
            },
            audio: AudioMode::System,
            target: ShareTarget {
                url: url(),
                token: screen_token(),
                track_name: "screen-share:{\"t\":0,\"q\":\"1080p30\",\"s\":\"e2e\"}".into(),
            },
        })
        .expect("a transmissão começa");

    let next = || {
        seen.recv_timeout(Duration::from_secs(10))
            .expect("o assinante viu algo")
    };
    let mut first = [next(), next()];
    first.sort_by_key(|s| matches!(s, Seen::Audio));
    let software = std::env::var("ASHTAR_FORCE_SOFTWARE_ENCODER").is_ok_and(|v| v == "1");
    let mime = if software { "video/VP8" } else { "video/H264" };
    assert_eq!(first, [Seen::Video { mime: mime.into() }, Seen::Audio]);

    // 5 s de imagem: com a tela parada, só os reenvios (1 por segundo); mexa algo na tela para
    // ver o número subir até ~30 fps.
    let start = Instant::now();
    let before = frames.load(Ordering::Relaxed);
    std::thread::sleep(Duration::from_secs(5));
    let fps = f64::from(frames.load(Ordering::Relaxed) - before) / start.elapsed().as_secs_f64();
    println!("o assinante recebeu {fps:.1} fps");
    assert!(fps >= 0.8, "{fps:.1} fps");
    let stats = manager.stats(id).expect("números").snapshot(Instant::now());
    println!("{stats:#?}");

    manager.update(id, ShareChange::Paused(true)).unwrap();
    assert_eq!(next(), Seen::Muted);

    manager.stop(id).unwrap();
    assert_eq!(next(), Seen::Gone);
    assert!(matches!(
        ended.recv_timeout(Duration::from_secs(1)),
        Ok(ShareEvent::Ended { session_id, .. }) if session_id == id
    ));
    async_runtime::block_on(viewer.close()).ok();
}
