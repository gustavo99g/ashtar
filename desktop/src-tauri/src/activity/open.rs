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

    /// Se o processo já está na lista.
    pub fn contains(&self, pid: u32, started_ms: i64) -> bool {
        self.0
            .iter()
            .any(|open| open.pid == pid && open.started_ms == started_ms)
    }

    /// A janela em primeiro plano é de um processo que o jogo aberto `parent` abriu (o
    /// `Jogo-Win64-Shipping.exe` que o `Jogo.exe` da Unreal abre): o jogo passa a ser desse
    /// processo, que é o que tem a janela para transmitir, e vai para o topo. Devolve se achou.
    pub fn adopt(&mut self, parent: u32, pid: u32, started_ms: i64) -> bool {
        let Some(index) = self.0.iter().position(|open| open.pid == parent) else {
            return false;
        };
        let mut open = self.0.remove(index);
        open.pid = pid;
        open.started_ms = started_ms;
        self.0.insert(0, open);
        true
    }

    /// Os processos abertos do jogo chamado `name`, do que abriu por último para o mais antigo: o
    /// cliente e a partida de um jogo como o League of Legends. A transmissão fica no mais novo
    /// que tem janela, e volta para o de antes quando ele fecha.
    pub fn family(&self, name: &str) -> Vec<u32> {
        let mut family: Vec<&OpenGame> = self
            .0
            .iter()
            .filter(|open| open.game.name == name)
            .collect();
        family.sort_by_key(|open| std::cmp::Reverse(open.started_ms));
        family.into_iter().map(|open| open.pid).collect()
    }

    /// Quando o jogo chamado `name` abriu: o processo mais antigo dele ainda aberto (o cliente do
    /// League of Legends, não a partida). O tempo do cartão não recomeça a cada processo.
    pub fn opened_ms(&self, name: &str) -> Option<i64> {
        self.0
            .iter()
            .filter(|open| open.game.name == name)
            .map(|open| open.started_ms)
            .min()
    }

    /// O nome do jogo aberto no processo `pid`, se é um.
    pub fn name_of(&self, pid: u32) -> Option<&str> {
        self.0
            .iter()
            .find(|open| open.pid == pid)
            .map(|open| open.game.name.as_str())
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
        assert!(!games.refocus(1, 10));
        games.retain_alive(|_, _| false);
        assert!(games.current(|_| false).is_none());
    }

    #[test]
    fn a_janela_do_filho_fica_com_o_jogo() {
        let mut games = OpenGames::default();
        games.focused(open(1, "p3r"));
        games.focused(open(2, "outro"));
        assert!(games.contains(1, 10));
        // O P3R.exe (1) abriu o P3R-Win64-Shipping.exe (5), que tem a janela.
        assert!(games.adopt(1, 5, 55));
        let current = games.current(|_| false).unwrap();
        assert_eq!((current.pid, current.game.id.as_str()), (5, "p3r"));
        assert!(!games.contains(1, 10));
        assert!(!games.adopt(9, 6, 66));
    }

    #[test]
    fn a_familia_do_jogo_do_mais_novo_ao_mais_antigo() {
        let mut games = OpenGames::default();
        games.focused(open(1, "League of Legends"));
        games.focused(open(3, "League of Legends"));
        games.focused(open(2, "Hades"));
        // Voltar ao cliente não muda a ordem: a partida abriu depois.
        assert!(games.refocus(1, 10));
        assert_eq!(games.family("League of Legends"), [3, 1]);
        assert_eq!(games.family("Hades"), [2]);
        games.retain_alive(|pid, _| pid != 3);
        assert_eq!(games.family("League of Legends"), [1]);
        assert_eq!(games.name_of(1), Some("League of Legends"));
        assert_eq!(games.name_of(3), None);
        games.focused(open(4, "League of Legends"));
        assert_eq!(games.opened_ms("League of Legends"), Some(10));
        assert_eq!(games.opened_ms("Nenhum"), None);
    }
}
