# LiveKit na VPS

O LiveKit sai do LiveKit Cloud e passa a rodar numa VPS própria, antes do resto da v0.2.4: a cota de
tráfego (GB) do plano gratuito está acabando antes do previsto. A API e o banco continuam no computador de casa, pelo
Tailscale Funnel; só a mídia muda de lugar.

O app não precisa de versão nova: ele recebe a URL do LiveKit da API junto com o token. A troca é só no
`.env` da API.

```text
app ──HTTPS──→ API (casa, Funnel) ── token assinado com a chave da VPS
app ──wss://──→ Caddy :443 ──→ LiveKit :7880   (sinal)
app ──UDP 7882 / TCP 7881 / TURN 3478──→ LiveKit   (mídia)
```

## O que tem aqui

| Arquivo | Para quê |
|---|---|
| `compose.yaml` | LiveKit e Caddy, os dois na rede do host. |
| `Caddyfile` | Certificado automático (Let's Encrypt) e proxy do `wss://` para o LiveKit. |
| `livekit.yaml.template` | Config do LiveKit; o `setup.sh` preenche domínio, chave e segredo. |
| `setup.sh` | Instala o Docker, abre o firewall, ajusta os buffers de UDP e gera `.env` e `livekit.yaml`. |

O `.env` e o `livekit.yaml` gerados têm o segredo e só existem na VPS (estão no `.gitignore`).

## Portas

| Porta | Protocolo | Uso |
|---|---|---|
| 80 | TCP | Let's Encrypt e redirecionamento para HTTPS |
| 443 | TCP | Sinal do LiveKit (`wss://`), pelo Caddy |
| 7881 | TCP | Mídia por TCP, quando UDP não passa |
| 7882 | UDP | Mídia (todas as conexões numa porta só) |
| 3478 | UDP | TURN, para quem está atrás de NAT restritivo |

A 7880 fica fechada no firewall e só escuta em `127.0.0.1`. Se o provedor tiver um firewall próprio no
painel (o da Hostinger tem), abra as mesmas portas lá também.

## Passo a passo

1. **VPS.** Ubuntu 24.04, no Brasil (Hostinger KVM 2, ver o [README](../../README.md#infraestrutura)).
   Anote o IP público.
2. **Endereço.** Crie um registro DNS `A` de `livekit.<seu domínio>` para o IP da VPS. Sem domínio, dá para
   usar `livekit.<ip-com-hífens>.sslip.io` (ex.: `livekit.203-0-113-10.sslip.io`), que já aponta para o IP.
3. **Arquivos.** Na VPS, como root:

   ```bash
   git clone https://github.com/gustavo99g/discord.git ashtar
   cd ashtar/deploy/livekit
   ./setup.sh livekit.seudominio.com
   docker compose up -d
   ```

   O `setup.sh` imprime no fim as três linhas para o `.env` da API.
4. **Conferir.** `curl https://livekit.seudominio.com` deve responder `OK` (o primeiro acesso pode
   demorar alguns segundos enquanto o Caddy pega o certificado). Logs: `docker compose logs -f livekit`.
5. **Trocar na API.** No `.env` da API, em casa, troque as três variáveis pelas impressas no passo 3 e
   reinicie a API:

   ```bash
   LIVEKIT_URL=wss://livekit.seudominio.com
   LIVEKIT_API_KEY=API...
   LIVEKIT_API_SECRET=...
   ```

   Quem estiver numa sala na hora da troca precisa sair e entrar de novo.
6. **Testar.** Duas pessoas em redes diferentes entram na sala, falam e compartilham a tela. Em
   `docker compose logs livekit` aparecem as conexões.

Para voltar ao LiveKit Cloud, basta repor as três variáveis antigas no `.env` da API.

## Manutenção

* **Atualizar o LiveKit:** troque a tag da imagem no `compose.yaml`, depois `docker compose pull` e
  `docker compose up -d`. Fixe sempre uma versão exata.
* **Trocar a chave:** apague as linhas `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` do `.env`, rode o
  `setup.sh` de novo, `docker compose up -d` e atualize o `.env` da API.
* **Consumo:** o tráfego de saída aparece no painel da Hostinger; o plano KVM 2 inclui 8 TB por mês.

## O que fica para a v0.2.4

* TURN por TLS na 443, para redes que só deixam passar HTTPS (precisa dividir a 443 com o Caddy);
* API e banco na mesma VPS, com HTTPS no domínio próprio;
* backup fora da VPS e alerta de servidor fora do ar.
