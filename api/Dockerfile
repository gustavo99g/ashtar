# Imagem da API (servidor e `admin`). O GitHub Actions gera e publica no GHCR
# (.github/workflows/api-image.yml); a VPS só baixa. Contexto do build: a pasta api/.

FROM rust:1.98.1-slim-trixie AS build
WORKDIR /src
COPY . .
RUN cargo build --release --locked --bins

FROM debian:trixie-20261020-slim
RUN useradd --system --uid 10001 --home-dir /data ashtar
# Certificados para o reqwest falar com o LiveKit e com o GitHub (link de download).
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /src/target/release/api /src/target/release/admin /usr/local/bin/
# O banco fica num volume em /data: `DATABASE_URL=sqlite://ashtar.db` é relativo a esta pasta.
WORKDIR /data
USER ashtar
CMD ["api"]
