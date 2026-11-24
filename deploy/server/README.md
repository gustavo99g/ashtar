# Servidor na VPS

A v0.2.5 tira o servidor do LiveKit Cloud e do computador de casa. Tudo roda numa VPS própria (BorkCloud
VPS 2GB em São Paulo: 2 vCPU, 2 GB de RAM, 28 GB de disco, tráfego sem franquia, Ubuntu, IP `87.254.22.4`)
com Docker Compose:

* **LiveKit**, a mídia (voz e transmissão de tela);
* **Caddy**, o HTTPS dos dois domínios, com certificado automático;
* **API**, com o banco SQLite numa pasta da VPS e backup diário no Cloudflare R2.

O motivo de começar pelo LiveKit foi a cota de tráfego do plano gratuito do Cloud: uns 30 minutos de teste em
2026-11-09 gastaram ~3 GB dos 50 GB do mês.

```text
app ──HTTPS──→ Caddy :443 ── api.ashtar.app.br ──→ API :3000 ── data/ashtar.db
app ──wss://─→ Caddy :443 ── livekit.ashtar.app.br ──→ LiveKit :7880   (sinal)
app ──UDP 7882 / TCP 7881 / TURN 3478──→ LiveKit                      (mídia)
```

## O que tem aqui

| Arquivo | Para quê |
|---|---|
| `compose.yaml` | LiveKit, Caddy e API, todos na rede do host. |
| `setup.sh` | Instala o Docker, abre o firewall, ajusta UDP e fuso, e gera `.env`, `livekit.yaml`, `Caddyfile` e `api.env`. |
| `livekit.yaml.template` | Config do LiveKit; o `setup.sh` preenche domínio, chave e segredo. |
| `Caddyfile.template` | HTTPS dos domínios; o bloco da API só entra quando há domínio da API. |
| `backup.sh` | Backup do banco no R2; o `setup.sh` agenda para as 22:30. |

Gerados pelo `setup.sh`, só na VPS (estão no `.gitignore`): `.env` (domínios, chave do LiveKit, R2),
`api.env` (variáveis da API), `livekit.yaml` e `Caddyfile`. O banco fica em `data/`.

A imagem da API sai do GitHub Actions ([`api-image.yml`](../../.github/workflows/api-image.yml), botão manual)
para `ghcr.io/gustavo99g/ashtar-api`. A VPS só baixa.

## Portas

| Porta | Protocolo | Uso |
|---|---|---|
| 80 | TCP | Let's Encrypt e redirecionamento para HTTPS |
| 443 | TCP | API e sinal do LiveKit (`wss://`), pelo Caddy |
| 7881 | TCP | Mídia por TCP, quando UDP não passa |
| 7882 | UDP | Mídia (todas as conexões numa porta só) |
| 3478 | UDP | TURN, para quem está atrás de NAT restritivo |

A 7880 (LiveKit) e a 3000 (API) ficam fechadas no firewall e só escutam em `127.0.0.1`. Se o provedor tiver
firewall próprio no painel, abra as mesmas portas lá também.

## Levar os arquivos para a VPS

Do seu PC, na raiz do repositório (não dentro de `desktop/`), com o branch certo:

```bash
scp -r deploy/server/. root@87.254.22.4:/root/ashtar/
```

Os arquivos gerados na VPS (`.env`, `api.env`, `livekit.yaml`, `Caddyfile`, `data/`) não são sobrescritos.

**Se a VPS ainda tem a pasta `/root/livekit` da primeira versão**, pare e renomeie antes de copiar. O compose
novo se chama `ashtar`, e o antigo seguraria as portas:

```bash
ssh root@87.254.22.4 "cd /root/livekit && docker compose down && mv /root/livekit /root/ashtar"
```

Depois de copiar, rode o `./setup.sh` de novo (ele mantém a chave e o segredo) e `docker compose up -d`. O
Caddy pede os certificados de novo na primeira subida.

## 1. LiveKit

1. **DNS.** Registro `A` de `livekit.ashtar.app.br` para `87.254.22.4`.
2. **Subir.** Na VPS:

   ```bash
   cd /root/ashtar
   ./setup.sh livekit.ashtar.app.br
   docker compose up -d
   curl https://livekit.ashtar.app.br   # responde OK
   ```

3. **Trocar na API de casa.** No `.env` da API, troque `LIVEKIT_URL`, `LIVEKIT_API_KEY` e
   `LIVEKIT_API_SECRET` (o `setup.sh` imprime a URL e a chave; o segredo está no `.env` da VPS:
   `grep SECRET /root/ashtar/.env`) e reinicie a API. Quem estiver numa sala precisa sair e entrar de novo.

O app não muda: ele recebe a URL do LiveKit da API junto com o token. Para voltar ao Cloud, basta repor as
três variáveis antigas.

## 2. API

A URL da API fica gravada no app instalado, então a troca é em duas fases, sem dois bancos ao mesmo tempo:

* **Fase A:** `api.ashtar.app.br` passa a existir, mas o Caddy repassa tudo para a API de casa, pelo Funnel.
  Sai uma versão do app com a URL nova, e o grupo atualiza sem perceber nada.
* **Fase B:** o banco vai para a VPS, a API sobe lá e o Caddy passa a apontar para ela. O app não muda.

### Fase A: domínio novo, API ainda em casa

1. **DNS.** Registro `A` de `api.ashtar.app.br` para `87.254.22.4`.
2. **Caddy repassando para casa.** Na VPS, ponha a URL do Funnel no `.env` e rode o setup com os dois
   domínios:

   ```bash
   cd /root/ashtar
   echo "API_UPSTREAM=https://<máquina>.<rede>.ts.net" >> .env
   ./setup.sh livekit.ashtar.app.br api.ashtar.app.br
   docker compose up -d
   curl https://api.ashtar.app.br/health   # responde a API de casa
   ```

3. **Links dos convites.** No `.env` da API de casa, `PUBLIC_URL=https://api.ashtar.app.br`, e reinicie.
4. **App com a URL nova.** No GitHub, em Settings › Secrets and variables › Actions › Variables, troque
   `VITE_API_URL` para `https://api.ashtar.app.br` e publique uma versão. A versão anterior continua
   funcionando pelo Funnel até todos atualizarem; se quiser forçar, suba o `MIN_CLIENT_VERSION`.

### Fase B: API e banco na VPS

Antes, uma vez:

* **Imagem.** No GitHub, Actions › Imagem da API › Run workflow.
* **Login no GHCR.** Crie um token clássico só com `read:packages` (GitHub › Settings › Developer settings ›
  Personal access tokens) e, na VPS: `docker login ghcr.io -u gustavo99g` (cole o token como senha).

A troca, numa hora em que ninguém está usando (o app fica sem API por alguns minutos):

1. **Parar a API de casa** (e o `admin`, se estiver aberto).
2. **Copiar o banco.** Do seu PC, a partir da pasta onde a API roda (`ashtar.db` e, se existirem, `-wal` e
   `-shm`, que vão juntos):

   ```bash
   scp ashtar.db* root@87.254.22.4:/root/ashtar/data/
   ```

3. **Subir a API na VPS:**

   ```bash
   cd /root/ashtar
   sed -i 's|^API_UPSTREAM=.*|API_UPSTREAM=127.0.0.1:3000|' .env
   ./setup.sh               # também passa data/ para o usuário da API
   docker compose pull api
   docker compose up -d
   curl https://api.ashtar.app.br/health
   docker compose logs api   # "Banco: sqlite://ashtar.db"
   ```

4. **Conferir no app:** entrar, ver os membros e o histórico do chat, falar e transmitir.
5. **Desligar a casa:** `tailscale funnel --bg off` (ou `tailscale funnel reset`) e o início automático da API.
   Guarde o `ashtar.db` de casa por umas semanas, sem abrir a API com ele.

Para voltar atrás antes do passo 5: `API_UPSTREAM` de novo para a URL do Funnel, `./setup.sh`,
`docker compose up -d` e `docker compose stop api`, e a API de casa sobe com o banco de lá. O que foi escrito
na VPS nesse meio tempo fica só na VPS.

### Backup

O mesmo bucket do R2 que o PC usa. No `.env` da VPS:

```bash
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
R2_PREFIX=vps        # opcional: uma pasta no bucket
```

Depois `./setup.sh` (ele agenda as 22:30) e um teste na hora: `./backup.sh`. Na VPS ficam as 14 cópias mais
recentes, em `data/backups/`. Desligue a tarefa do Agendador do Windows quando o banco de casa parar de ser
usado.

**Restauração, testada uma vez:** baixe um backup do R2, ponha no lugar do `data/ashtar.db` (com a API parada,
`docker compose stop api`, e sem os `-wal`/`-shm` antigos), `docker compose up -d api` e confira no app.

### Arquivos (v0.7)

As fotos de perfil, os anexos do chat, as imagens das prévias de link e os emojis do grupo ficam em
`data/files/` (a variável `FILES_DIR` troca a pasta). **Eles não entram no backup**: se o disco da VPS se perder,
os arquivos vão junto, e as mensagens ficam (ADR 0031). A cópia no R2 está no BACKLOG.

A API apaga sozinha, de hora em hora, o que foi enviado e não usado em 24 horas. Com menos de 1 GB livre ela
recusa envios, e o dono recebe um aviso no app quando o disco passa de 80% (no máximo um por dia). O Painel ›
Servidor mostra quanto os arquivos ocupam. O Caddy não limita o tamanho do corpo: os anexos de até 100 MB passam
direto para a API, que corta no limite.

### Alerta

No UptimeRobot, um monitor HTTP(S) para `https://api.ashtar.app.br/health` a cada 5 minutos, com aviso pelo app
do celular. Teste uma vez com `docker compose stop api`.

## Manutenção

* **Atualizar a API:** rode o workflow e, na VPS, `docker compose pull api && docker compose up -d api`. Quem
  está numa sala continua falando; o chat e a lista reconectam em segundos.
* **Voltar a uma versão:** `API_TAG=sha-<commit>` no `.env` e o mesmo comando. Tire a linha para voltar ao
  `latest`.
* **Comandos do `admin`:** `docker compose exec api admin <comando>`.
* **Logs:** `docker compose logs -f api` (ou `livekit`, `caddy`). Backup: `/var/log/ashtar-backup.log`.
* **Atualizar o LiveKit:** troque a tag no `compose.yaml`, `docker compose pull livekit` e
  `docker compose up -d`. Fixe sempre uma versão exata.
* **Trocar a chave do LiveKit:** apague `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` do `.env`, rode o `./setup.sh`
  (ele atualiza o `api.env` junto) e `docker compose up -d`.
* **Consumo:** o plano não tem franquia de tráfego; o que aperta primeiro é o disco (28 GB), por causa dos
  anexos em `data/files/`. CPU, memória e disco aparecem no painel da BorkCloud.

## O que falta

* TURN por TLS na 443, para redes que só deixam passar HTTPS (precisa dividir a 443 com o Caddy);
* atualização da API pelo próprio Actions (hoje é manual, por escolha).
