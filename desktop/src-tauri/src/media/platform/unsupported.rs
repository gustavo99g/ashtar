//! Implementação usada em qualquer sistema sem suporte de plataforma.
//!
//! Vazio por enquanto. Ganha, nos passos 3 e 5, as mesmas funções que
//! `win32/` — todas retornando `AppError::Unsupported` — para que o
//! projeto compile em outras plataformas e o frontend receba um erro
//! claro, em vez de o build quebrar por símbolos inexistentes.
