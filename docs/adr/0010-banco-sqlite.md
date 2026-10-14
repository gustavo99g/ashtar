# 0010 — Banco: SQLite com sqlx

- **Status:** aceita
- **Data:** 2026-10

## Contexto

A identidade (v0.2.1) é o primeiro dado do Ashtar que precisa durar: membros, computadores vinculados,
convites e permissões. A API roda no computador de casa até a VPS (v0.2.6), para um grupo de 5 a 10
pessoas, com poucas escritas por dia. O banco precisa de migrações, de backup simples e de uma mudança
fácil para a VPS.

## Decisão

O banco é um arquivo **SQLite**, acessado pelo **sqlx** (assíncrono, no mesmo tokio da API), em modo
**WAL**. As migrações ficam em `api/migrations/`, vão embutidas no binário (`sqlx::migrate!`) e rodam
sozinhas quando a API ou o `admin` abrem o banco. O caminho vem de `DATABASE_URL`.

As consultas usam `sqlx::query`/`query_as`, sem as macros `query!` (que exigiriam um banco ou a pasta
`.sqlx` no CI). Os testes de integração rodam todo o SQL num banco em memória.

O backup é o `VACUUM INTO` (uma cópia consistente mesmo com a API gravando), agendado no Windows e enviado
para fora do computador.

## Alternativas consideradas

- **PostgreSQL:** mais recursos, mas um serviço a mais para instalar e manter no computador de casa, e a
  migração para a VPS vira dump e restore. Nada na identidade precisa do que ele tem a mais.
- **sqlx com as macros `query!`:** SQL checado na compilação, ao custo de manter a pasta `.sqlx`
  sincronizada a cada mudança de consulta. Com poucas consultas e todas cobertas por teste, não compensa.
- **Diesel / SeaORM:** mais abstração do que o tamanho do problema pede.

## Consequências

- Migrar para a VPS é copiar um arquivo (o backup mais recente).
- O `admin` grava com a API no ar (WAL); escritas simultâneas esperam até 5 s (`busy_timeout`).
- `COLLATE NOCASE` do SQLite só ignora maiúsculas no ASCII: "JOÃO" e "joão" contam como nicks diferentes.
- Rever se o banco passar a ter muitas escritas concorrentes (chat com histórico grande, na v0.2.4) ou
  precisar de acesso de mais de uma máquina.
