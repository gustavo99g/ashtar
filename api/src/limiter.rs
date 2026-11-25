//! Limites: tentativas erradas de convite ([`AttemptLimiter`]) e envio de
//! mensagens por pessoa ([`SendLimiter`]).
//!
//! **Convites.** O [`AttemptLimiter`] só vale para o uso de convite; o login
//! com a chave do dispositivo fica de fora (ver `routes::auth::login`). Ele
//! conta as falhas de todo mundo junto, numa janela de tempo. Por IP não
//! daria: atrás do Tailscale Funnel todas as chamadas chegam do mesmo
//! endereço local. Com 60 bits no código do convite e 20 erros a cada 10
//! minutos, adivinhar um código levaria muito mais que o universo tem de
//! idade; o custo é que alguém errando de propósito trava o uso de convites
//! por alguns minutos, o que para um grupo pequeno é aceitável.
//!
//! **Chat.** O [`SendLimiter`] conta os envios de cada pessoa separados (aqui
//! há sessão, então dá para saber quem é): 5 mensagens a cada 5 s (ADR 0015).
//!
//! **Sons.** O [`SoundLimiter`] faz o mesmo para o soundboard, com mais um intervalo mínimo entre
//! dois sons: 5 a cada 30 s e 3 s entre um e outro (ADR 0037).

use std::collections::{HashMap, VecDeque};
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

/// Quantas mensagens cada pessoa envia numa janela de tempo. Cada membro tem a
/// sua conta, guardada só na memória: reiniciar a API zera tudo, o que não
/// importa para um limite de segundos.
pub struct SendLimiter {
    max: usize,
    window: Duration,
    sent: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl SendLimiter {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            max,
            window,
            sent: Mutex::new(HashMap::new()),
        }
    }

    /// 5 mensagens a cada 5 segundos.
    pub fn default_for_chat() -> Self {
        Self::new(5, Duration::from_secs(5))
    }

    /// Conta um envio de `user_id`, ou `Err(TooManyMessages)` se ele já chegou
    /// ao limite da janela (e aí não conta).
    pub fn try_send(&self, user_id: &str) -> Result<(), ApiError> {
        self.try_send_at(user_id, Instant::now())
    }

    fn try_send_at(&self, user_id: &str, now: Instant) -> Result<(), ApiError> {
        let mut sent = self.sent.lock().unwrap();
        let times = sent.entry(user_id.to_owned()).or_default();
        while times
            .front()
            .is_some_and(|t| now.duration_since(*t) >= self.window)
        {
            times.pop_front();
        }
        if times.len() >= self.max {
            return Err(ApiError::TooManyMessages);
        }
        times.push_back(now);
        Ok(())
    }
}

/// Quantos sons cada pessoa toca: até `max` na janela e nunca dois com menos de `gap` entre eles.
/// Só na memória, como o [`SendLimiter`].
pub struct SoundLimiter {
    max: usize,
    window: Duration,
    gap: Duration,
    played: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl SoundLimiter {
    pub fn new(max: usize, window: Duration, gap: Duration) -> Self {
        Self {
            max,
            window,
            gap,
            played: Mutex::new(HashMap::new()),
        }
    }

    /// 5 sons a cada 30 segundos, 3 segundos entre um e outro.
    pub fn default_for_sounds() -> Self {
        Self::new(5, Duration::from_secs(30), Duration::from_secs(3))
    }

    /// Conta um som de `user_id`, ou `Err(TooManySounds)` (e aí não conta).
    pub fn try_play(&self, user_id: &str) -> Result<(), ApiError> {
        self.try_play_at(user_id, Instant::now())
    }

    fn try_play_at(&self, user_id: &str, now: Instant) -> Result<(), ApiError> {
        let mut played = self.played.lock().unwrap();
        let times = played.entry(user_id.to_owned()).or_default();
        while times
            .front()
            .is_some_and(|t| now.duration_since(*t) >= self.window)
        {
            times.pop_front();
        }
        let too_soon = times
            .back()
            .is_some_and(|t| now.duration_since(*t) < self.gap);
        if too_soon || times.len() >= self.max {
            return Err(ApiError::TooManySounds);
        }
        times.push_back(now);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sons_tem_intervalo_e_limite_na_janela() {
        let limiter = SoundLimiter::new(3, Duration::from_secs(30), Duration::from_secs(3));
        let start = Instant::now();
        let at = |s| start + Duration::from_secs(s);
        assert!(limiter.try_play_at("a", at(0)).is_ok());
        // Antes dos 3 s, não.
        assert!(limiter.try_play_at("a", at(2)).is_err());
        assert!(limiter.try_play_at("b", at(2)).is_ok());
        assert!(limiter.try_play_at("a", at(3)).is_ok());
        assert!(limiter.try_play_at("a", at(6)).is_ok());
        // O quarto na janela, não; quando o primeiro sai da janela, volta.
        assert!(limiter.try_play_at("a", at(20)).is_err());
        assert!(limiter.try_play_at("a", at(30)).is_ok());
    }

    #[test]
    fn envio_trava_por_pessoa_e_solta_na_janela() {
        let limiter = SendLimiter::new(2, Duration::from_secs(5));
        let start = Instant::now();

        assert!(limiter.try_send_at("a", start).is_ok());
        assert!(limiter.try_send_at("a", start).is_ok());
        assert!(limiter.try_send_at("a", start).is_err());
        // Outra pessoa tem a própria conta.
        assert!(limiter.try_send_at("b", start).is_ok());
        // A recusa não conta: passada a janela, volta a valer.
        assert!(
            limiter
                .try_send_at("a", start + Duration::from_secs(5))
                .is_ok()
        );
    }

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
