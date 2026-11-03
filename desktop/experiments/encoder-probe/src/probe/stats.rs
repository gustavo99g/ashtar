//! Medidas: percentis, CPU do processo e o relatório final.

use std::time::{Duration, Instant};

use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

/// Série de valores em milissegundos.
#[derive(Default)]
pub struct Series(Vec<f64>);

impl Series {
    pub fn push(&mut self, value: Duration) {
        self.0.push(value.as_secs_f64() * 1000.0);
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// `p50 / p95 / p99 / máx` em ms, ou "sem dados".
    pub fn summary(&self) -> String {
        if self.0.is_empty() {
            return "sem dados".into();
        }
        let mut sorted = self.0.clone();
        sorted.sort_by(f64::total_cmp);
        let at = |p: f64| sorted[((sorted.len() - 1) as f64 * p).round() as usize];
        format!(
            "p50 {:.2} · p95 {:.2} · p99 {:.2} · máx {:.2} ms",
            at(0.50),
            at(0.95),
            at(0.99),
            sorted[sorted.len() - 1]
        )
    }
}

/// Tempo de CPU do processo (usuário + kernel) desde o início.
pub struct CpuClock {
    wall: Instant,
    cpu: Duration,
}

impl CpuClock {
    pub fn start() -> Self {
        Self {
            wall: Instant::now(),
            cpu: process_cpu(),
        }
    }

    /// Uso médio de CPU desde `start`, em "% de um núcleo" e em "% da máquina".
    pub fn usage(&self) -> (f64, f64) {
        let cpu = process_cpu().saturating_sub(self.cpu).as_secs_f64();
        let wall = self.wall.elapsed().as_secs_f64().max(1e-9);
        let one_core = cpu / wall * 100.0;
        let cores = std::thread::available_parallelism().map_or(1, |n| n.get()) as f64;
        (one_core, one_core / cores)
    }
}

fn process_cpu() -> Duration {
    let (mut created, mut exited, mut kernel, mut user) = Default::default();
    // SAFETY: o pseudo-handle do processo atual é sempre válido; os FILETIME são locais.
    let ok = unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        )
    };
    if ok.is_err() {
        return Duration::ZERO;
    }
    let ticks = |t: FILETIME| (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime);
    // FILETIME conta em unidades de 100 ns.
    Duration::from_nanos((ticks(kernel) + ticks(user)) * 100)
}
