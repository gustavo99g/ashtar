//! O jogo aberto agora (ADR 0033): o reconhecimento, as configurações e o ícone.
//!
//! - `catalog.rs`: do caminho do `.exe` para o jogo, pelas fontes na ordem (lógica pura);
//! - `launchers.rs`: os jogos que os launchers do PC conhecem;
//! - `settings.rs`: o `activity.json`;
//! - `open.rs`: os jogos abertos e qual deles vai no cartão;
//! - `windows.rs`: o que se pergunta ao Windows.
//!
//! A tarefa é uma thread que, a cada [`TICK`], olha a janela em primeiro plano e se os jogos
//! abertos ainda rodam (o plano falava em `SetWinEventHook`; a volta curta faz o mesmo com menos
//! código e custa uma chamada de sistema por volta). Com a chave geral desligada, ela termina e só
//! volta quando a chave liga. Cada mudança do jogo do cartão vira o evento `activity:changed`.

pub mod catalog;
pub mod launchers;
mod open;
pub mod settings;
#[cfg(target_os = "windows")]
mod windows;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tracing::{info, warn};

use self::catalog::{Catalog, DetectableGame, Extra, ManualGame, Recognized, Source};
use self::open::{OpenGame, OpenGames};
use self::settings::{ActivitySettings, SeenGame};

#[cfg(target_os = "windows")]
use self::windows as platform;

/// Fora do Windows não há janela nem processo: o app só roda no Windows, e isto só existe para o
/// crate compilar nos testes de outras plataformas.
#[cfg(not(target_os = "windows"))]
mod platform {
    use std::path::PathBuf;

    use super::launchers::InstalledProgram;

    pub fn foreground() -> Option<(u32, String, i64)> {
        None
    }

    pub fn window_exe(_id: u64) -> Option<String> {
        None
    }

    pub fn still_running(_pid: u32, _started_ms: i64) -> bool {
        false
    }

    pub fn steam_root() -> Option<PathBuf> {
        None
    }

    pub fn installed_programs() -> Vec<InstalledProgram> {
        Vec::new()
    }
}

/// De quanto em quanto tempo a tarefa olha a janela em primeiro plano.
const TICK: Duration = Duration::from_secs(2);

/// De quanto em quanto tempo os launchers são lidos de novo (um jogo instalado agora).
const RESCAN_EVERY: Duration = Duration::from_secs(10 * 60);

/// O evento para o app.
pub const CHANGED_EVENT: &str = "activity:changed";

/// O jogo do cartão, como o app recebe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameView {
    pub id: String,
    pub name: String,
    pub exe: String,
    pub source: Source,
    /// Quando o processo abriu, em milissegundos desde 1970.
    pub started_ms: i64,
    /// `data:image/png;base64,...`, ou `None` (o app desenha o controle).
    pub icon: Option<String>,
}

/// Um jogo da lista de reconhecidos das configurações.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeenView {
    pub id: String,
    pub name: String,
    pub exe: String,
    pub source: Source,
    pub last_seen: i64,
    pub hidden: bool,
    pub icon: Option<String>,
}

/// Configurações › Atividade.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub enabled: bool,
    pub seen: Vec<SeenView>,
    pub manual: Vec<ManualGame>,
}

/// Uma janela da lista do seletor, no "Adicionar jogo".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowGame {
    pub id: u64,
    pub exe: Option<String>,
    /// O nome do jogo, se ela já é reconhecida.
    pub recognized: Option<String>,
}

/// A cópia da lista do Discord no PC, com o `ETag` da API.
#[derive(Debug, Default, Serialize, Deserialize)]
struct DetectableCopy {
    etag: String,
    games: Vec<DetectableGame>,
}

struct State {
    settings: ActivitySettings,
    detectable: Vec<DetectableGame>,
    detectable_etag: Option<String>,
    catalog: Catalog,
    installed: Vec<catalog::InstalledGame>,
    open: OpenGames,
    /// O que foi mandado ao app por último.
    shown: Option<GameView>,
    /// Os ícones já lidos, pelo id do jogo.
    icons: HashMap<String, Option<String>>,
}

/// O estado gerenciado pelo Tauri.
pub struct Activity {
    app: AppHandle,
    dir: PathBuf,
    extra: Extra,
    state: Mutex<State>,
    /// Se a thread está rodando.
    running: AtomicBool,
}

impl Activity {
    /// Lê o `activity.json` e a cópia da lista, e começa a tarefa se a chave estiver ligada.
    pub fn start(app: &AppHandle) -> Arc<Self> {
        let dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("ashtar"));
        let settings = ActivitySettings::load(&dir.join("activity.json"));
        let copy: DetectableCopy = std::fs::read_to_string(dir.join("detectable-games.json"))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        let extra = Extra::bundled();
        let activity = Arc::new(Self {
            app: app.clone(),
            dir,
            state: Mutex::new(State {
                catalog: Catalog::new(&settings.manual, Vec::new(), &copy.games, &extra),
                settings,
                detectable_etag: (!copy.games.is_empty()).then_some(copy.etag),
                detectable: copy.games,
                installed: Vec::new(),
                open: OpenGames::default(),
                shown: None,
                icons: HashMap::new(),
            }),
            extra,
            running: AtomicBool::new(false),
        });
        if activity.lock().settings.enabled {
            Self::spawn(&activity);
        }
        activity
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn spawn(activity: &Arc<Self>) {
        if activity.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let activity = Arc::clone(activity);
        let spawned = std::thread::Builder::new()
            .name("atividade".into())
            .spawn(move || activity.run());
        if let Err(error) = spawned {
            warn!(%error, "não foi possível começar o reconhecimento do jogo");
        }
    }

    fn run(&self) {
        info!("reconhecimento do jogo ligado");
        let mut scanned: Option<Instant> = None;
        loop {
            if !self.lock().settings.enabled {
                break;
            }
            if scanned.is_none_or(|at| at.elapsed() >= RESCAN_EVERY) {
                self.rescan();
                scanned = Some(Instant::now());
            }
            self.tick();
            std::thread::sleep(TICK);
        }
        self.lock().open.clear();
        self.running.store(false, Ordering::SeqCst);
        self.publish();
        info!("reconhecimento do jogo desligado");
    }

    /// Lê os launchers do PC de novo e refaz o catálogo.
    fn rescan(&self) {
        let installed = launchers::scan(platform::steam_root(), &platform::installed_programs());
        let mut state = self.lock();
        if state.installed != installed {
            info!(jogos = installed.len(), "jogos dos launchers");
            state.installed = installed;
            self.rebuild(&mut state);
        }
    }

    fn rebuild(&self, state: &mut State) {
        state.catalog = Catalog::new(
            &state.settings.manual,
            state.installed.clone(),
            &state.detectable,
            &self.extra,
        );
    }

    /// Uma volta: a janela em primeiro plano e os jogos que fecharam.
    fn tick(&self) {
        let foreground = platform::foreground();
        let mut state = self.lock();
        state.open.retain_alive(platform::still_running);
        if let Some((pid, exe, started_ms)) = foreground {
            if !state.open.refocus(pid, started_ms) {
                if let Some(game) = state.catalog.recognize(&exe) {
                    self.remember(&mut state, &game);
                    state.open.focused(OpenGame {
                        pid,
                        started_ms,
                        game,
                    });
                }
            }
        }
        drop(state);
        self.publish();
    }

    /// Põe o jogo no topo dos que já abriram neste PC e grava.
    fn remember(&self, state: &mut State, game: &Recognized) {
        let new = state.settings.saw(SeenGame {
            id: game.id.clone(),
            name: game.name.clone(),
            exe: game.exe.clone(),
            source: game.source,
            last_seen: now_ms(),
        });
        if new {
            info!(jogo = %game.name, fonte = ?game.source, "jogo reconhecido");
        }
        self.save(state);
    }

    fn save(&self, state: &State) {
        if let Err(error) = state.settings.save(&self.dir.join("activity.json")) {
            warn!(%error, "não foi possível gravar o activity.json");
        }
    }

    /// O jogo do cartão agora, com o ícone.
    fn current(&self) -> Option<GameView> {
        let open = {
            let state = self.lock();
            state
                .open
                .current(|id| state.settings.is_hidden(id))
                .cloned()?
        };
        let icon = self.icon(&open.game.id, &open.game.exe);
        Some(GameView {
            id: open.game.id,
            name: open.game.name,
            exe: open.game.exe,
            source: open.game.source,
            started_ms: open.started_ms,
            icon,
        })
    }

    /// Manda o `activity:changed` se o jogo do cartão mudou.
    fn publish(&self) {
        let current = self.current();
        {
            let mut state = self.lock();
            if state.shown == current {
                return;
            }
            state.shown.clone_from(&current);
        }
        if let Err(error) = self.app.emit(CHANGED_EVENT, &current) {
            warn!(%error, "não foi possível avisar o jogo ao app");
        }
    }

    /// O ícone do jogo: do cache em `icons/<id>.png`, ou tirado do `.exe` e guardado.
    ///
    /// # Bloqueia
    ///
    /// Lê o disco na primeira vez de cada jogo.
    fn icon(&self, id: &str, exe: &str) -> Option<String> {
        if let Some(icon) = self.lock().icons.get(id) {
            return icon.clone();
        }
        let file = self.dir.join("icons").join(format!("{id}.png"));
        let png = std::fs::read(&file).ok().or_else(|| {
            let png = crate::media::sources::exe_icon_png(exe, 256)?;
            if let Err(error) = write_icon(&file, &png) {
                warn!(%error, "não foi possível guardar o ícone do jogo");
            }
            Some(png)
        });
        let icon = png.map(|png| format!("data:image/png;base64,{}", STANDARD.encode(png)));
        self.lock().icons.insert(id.to_owned(), icon.clone());
        icon
    }

    // --- O que os comandos pedem ---

    pub fn state(&self) -> Option<GameView> {
        self.current()
    }

    pub fn settings(&self) -> SettingsView {
        let (enabled, seen, manual) = {
            let state = self.lock();
            let seen: Vec<(SeenGame, bool)> = state
                .settings
                .seen
                .iter()
                .map(|game| (game.clone(), state.settings.is_hidden(&game.id)))
                .collect();
            (state.settings.enabled, seen, state.settings.manual.clone())
        };
        SettingsView {
            enabled,
            seen: seen
                .into_iter()
                .map(|(game, hidden)| SeenView {
                    icon: self.icon(&game.id, &game.exe),
                    id: game.id,
                    name: game.name,
                    exe: game.exe,
                    source: game.source,
                    last_seen: game.last_seen,
                    hidden,
                })
                .collect(),
            manual,
        }
    }

    pub fn set_enabled(activity: &Arc<Self>, enabled: bool) {
        {
            let mut state = activity.lock();
            state.settings.enabled = enabled;
            activity.save(&state);
        }
        if enabled {
            Self::spawn(activity);
        }
    }

    pub fn set_hidden(&self, id: &str, hidden: bool) {
        {
            let mut state = self.lock();
            state.settings.set_hidden(id, hidden);
            self.save(&state);
        }
        self.publish();
    }

    /// Adiciona o `.exe` da janela `window_id` com o nome `name`. Devolve o jogo.
    pub fn add_game(&self, window_id: u64, name: &str) -> Option<ManualGame> {
        let exe = platform::window_exe(window_id)?;
        let game = ManualGame {
            exe,
            name: name.trim().to_owned(),
        };
        if game.name.is_empty() {
            return None;
        }
        let mut state = self.lock();
        let key = catalog::normalize(&game.exe);
        state
            .settings
            .manual
            .retain(|known| catalog::normalize(&known.exe) != key);
        state.settings.manual.push(game.clone());
        // O jogo já aberto com outro nome (ou nenhum) é reconhecido de novo na próxima volta.
        state.open.clear();
        self.rebuild(&mut state);
        self.save(&state);
        Some(game)
    }

    pub fn remove_game(&self, exe: &str) {
        {
            let mut state = self.lock();
            let key = catalog::normalize(exe);
            state
                .settings
                .manual
                .retain(|known| catalog::normalize(&known.exe) != key);
            state.open.clear();
            self.rebuild(&mut state);
            self.save(&state);
        }
        self.publish();
    }

    /// As janelas do seletor com o `.exe` e, se já for jogo, o nome.
    pub fn windows(&self, ids: &[u64]) -> Vec<WindowGame> {
        ids.iter()
            .map(|&id| {
                let exe = platform::window_exe(id);
                let recognized = exe
                    .as_deref()
                    .and_then(|exe| self.lock().catalog.recognize(exe))
                    .map(|game| game.name);
                WindowGame {
                    id,
                    exe,
                    recognized,
                }
            })
            .collect()
    }

    /// O `ETag` da cópia da lista do Discord, para o app pedir com `If-None-Match`.
    pub fn detectable_etag(&self) -> Option<String> {
        self.lock().detectable_etag.clone()
    }

    /// Troca a cópia da lista do Discord pela que o app buscou na API.
    pub fn set_detectable(&self, etag: String, games: Vec<DetectableGame>) {
        let copy = DetectableCopy { etag, games };
        if let Err(error) = write_json(&self.dir.join("detectable-games.json"), &copy) {
            warn!(%error, "não foi possível guardar a lista de jogos");
        }
        let mut state = self.lock();
        info!(jogos = copy.games.len(), "lista de jogos detectáveis");
        state.detectable = copy.games;
        state.detectable_etag = Some(copy.etag);
        self.rebuild(&mut state);
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |at| at.as_millis() as i64)
}

fn write_icon(file: &Path, png: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(file, png)
}

/// Grava por um arquivo temporário, como o `activity.json`.
fn write_json(file: &Path, value: &impl Serialize) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let partial = file.with_extension("json.part");
    std::fs::write(&partial, serde_json::to_vec(value)?)?;
    std::fs::rename(&partial, file)
}
