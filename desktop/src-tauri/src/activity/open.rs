//! Os jogos abertos agora (ADR 0033, decisões 1 e 5): um jogo continua aberto enquanto o processo
//! existir, mesmo fora do primeiro plano, e com dois abertos vale o último que esteve em primeiro
//! plano.

use super::catalog::Recognized;

/// Um jogo aberto: o processo e o jogo reconhecido nele.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenGame {
    pub pid: u32,
    /// Quando o processo abriu, em milissegundos desde 1970.
    pub started_ms: i64,
    pub game: Recognized,
}

/// Do último em primeiro plano para o mais antigo.
#[derive(Debug, Default)]
pub struct OpenGames(Vec<OpenGame>);

impl OpenGames {
    /// O jogo do processo `pid` foi para o primeiro plano: vai para o topo.
    pub fn focused(&mut self, open: OpenGame) {
        self.0
            .retain(|known| !(known.pid == open.pid && known.started_ms == open.started_ms));
        self.0.insert(0, open);
    }

    /// Tira os que fecharam (`alive` diz se o processo ainda roda).
    pub fn retain_alive(&mut self, mut alive: impl FnMut(u32, i64) -> bool) {
        self.0.retain(|open| alive(open.pid, open.started_ms));
    }

    /// O jogo do cartão: o último em primeiro plano que não está escondido.
    pub fn current(&self, hidden: impl Fn(&str) -> bool) -> Option<&OpenGame> {
        self.0.iter().find(|open| !hidden(&open.game.id))
    }

    /// Se o processo já está na lista (para não reconhecer o mesmo `.exe` a cada volta).
    pub fn contains(&self, pid: u32, started_ms: i64) -> bool {
        self.0
            .iter()
            .any(|open| open.pid == pid && open.started_ms == started_ms)
    }

    /// Sobe para o topo o processo que já está na lista. Devolve se achou.
    pub fn refocus(&mut self, pid: u32, started_ms: i64) -> bool {
        let Some(index) = self
            .0
            .iter()
            .position(|open| open.pid == pid && open.started_ms == started_ms)
        else {
            return false;
        };
        let open = self.0.remove(index);
        self.0.insert(0, open);
        true
    }

    pub fn clear(&mut self) {
        self.0.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::super::catalog::Source;
    use super::*;

    fn open(pid: u32, id: &str) -> OpenGame {
        OpenGame {
            pid,
            started_ms: i64::from(pid) * 10,
            game: Recognized {
                id: id.into(),
                name: id.into(),
                exe: format!(r"C:\{id}.exe"),
                source: Source::Steam,
                steam_app_id: None,
            },
        }
    }

    #[test]
    fn vale_o_ultimo_em_primeiro_plano_que_ainda_roda() {
        let mut games = OpenGames::default();
        assert!(games.current(|_| false).is_none());
        games.focused(open(1, "a"));
        games.focused(open(2, "b"));
        assert_eq!(games.current(|_| false).unwrap().game.id, "b");
        // Voltar ao primeiro o põe em cima de novo.
        assert!(games.refocus(1, 10));
        assert_eq!(games.current(|_| false).unwrap().game.id, "a");
        assert!(!games.refocus(3, 30));
        // Escondido não aparece, mas o outro aparece no lugar.
        assert_eq!(games.current(|id| id == "a").unwrap().game.id, "b");
        // Fechou: some.
        games.retain_alive(|pid, _| pid != 1);
        assert_eq!(games.current(|_| false).unwrap().game.id, "b");
        assert!(!games.contains(1, 10));
        games.retain_alive(|_, _| false);
        assert!(games.current(|_| false).is_none());
    }
}
