use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};

/// Contador de frames em trânsito do caminho IPC.
///
/// O decremento (`release`) satura em zero em vez de estourar: um ACK
/// duplicado não pode fazer o contador dar a volta para o valor máximo e
/// deixar o portão fechado para sempre.
#[derive(Clone)]
pub struct FrameGate {
    in_flight: Arc<AtomicU32>,
    max: u32,
}

impl FrameGate {
    pub fn new(max: u32) -> Self {
        Self {
            in_flight: Arc::new(AtomicU32::new(0)),
            max,
        }
    }

    pub fn is_open(&self) -> bool {
        self.in_flight.load(Ordering::Acquire) < self.max
    }

    pub fn enter(&self) {
        self.in_flight.fetch_add(1, Ordering::AcqRel);
    }

    pub fn release(&self) {
        let _ = self
            .in_flight
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_sub(1));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closes_at_max_reopens_on_release_and_never_locks_forever_on_extra_release() {
        let gate = FrameGate::new(2);
        assert!(gate.is_open());

        gate.enter();
        assert!(gate.is_open());

        gate.enter();
        assert!(!gate.is_open(), "deveria fechar ao atingir o máximo");

        gate.release();
        assert!(gate.is_open(), "deveria reabrir depois do release");

        // ACK duplicado: mais releases do que enters, com o contador em
        // zero. Sem a saturação em `release()`, isso faria o contador dar
        // a volta (underflow) e o portão nunca mais abriria.
        gate.release();
        gate.release();
        assert!(
            gate.is_open(),
            "release a mais no zero não pode deixar o portão fechado para sempre"
        );
    }
}
