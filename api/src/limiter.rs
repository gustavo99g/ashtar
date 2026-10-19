//! Limite de tentativas erradas de convite.
//!
//! Só o uso de convite entra aqui. O login com a chave do dispositivo fica de fora
//! (ver `routes::auth::login`).
//!
//! Conta as falhas de todo mundo junto, numa janela de tempo. Por IP não
//! daria: atrás do Tailscale Funnel todas as chamadas chegam do mesmo
//! endereço local. Com 60 bits no código do convite e 20 erros a cada 10
//! minutos, adivinhar um código levaria muito mais que o universo tem de
//! idade; o custo é que alguém errando de propósito trava o uso de convites
//! por alguns minutos, o que para um grupo pequeno é aceitável.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::error::ApiError;

pub struct AttemptLimiter {
    max_failures: usize,
    window: Duration,
    failures: Mutex<VecDeque<Instant>>,
}

impl AttemptLimiter {
    pub fn new(max_failures: usize, window: Duration) -> Self {
        Self {
            max_failures,
            window,
            failures: Mutex::new(VecDeque::new()),
        }
    }

    /// 20 falhas a cada 10 minutos.
    pub fn default_for_api() -> Self {
        Self::new(20, Duration::from_secs(10 * 60))
    }

    /// `Err(TooManyAttempts)` se o limite da janela já foi atingido.
    pub fn check(&self) -> Result<(), ApiError> {
        self.check_at(Instant::now())
    }

    /// Conta uma tentativa errada.
    pub fn record_failure(&self) {
        self.record_failure_at(Instant::now());
    }

    fn check_at(&self, now: Instant) -> Result<(), ApiError> {
        let mut failures = self.failures.lock().unwrap();
        while failures
            .front()
            .is_some_and(|t| now.duration_since(*t) >= self.window)
        {
            failures.pop_front();
        }
        if failures.len() >= self.max_failures {
            Err(ApiError::TooManyAttempts)
        } else {
            Ok(())
        }
    }

    fn record_failure_at(&self, now: Instant) {
        self.failures.lock().unwrap().push_back(now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trava_no_limite_e_solta_depois_da_janela() {
        let limiter = AttemptLimiter::new(2, Duration::from_secs(60));
        let start = Instant::now();

        limiter.record_failure_at(start);
        assert!(limiter.check_at(start).is_ok());
        limiter.record_failure_at(start);
        assert!(limiter.check_at(start).is_err());

        assert!(limiter.check_at(start + Duration::from_secs(60)).is_ok());
    }
}
