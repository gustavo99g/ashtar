# Plano — v0.2.0: base de entrega

Primeira entrega da v0.2 (`docs/roadmap.md`). Monta o caminho para que toda versão seguinte chegue sozinha
ao grupo: atualização automática, pipeline de release, canal beta, versão mínima, "O que há de novo", logs
em arquivo e um código de acesso provisório na API. O plano da fase anterior está arquivado em
[`docs/plans/v0.1-reorganizacao.md`](docs/plans/v0.1-reorganizacao.md).

**Objetivo desta fase:** a v0.2.0 é a **última instalação manual**. Depois dela, uma versão nova publicada
passa pelo canal beta e chega a todos sem ninguém baixar nada.

**Fora do escopo:** UI nova (v0.2.1), identidade, convites e banco (v0.2.2), VPS (v0.2.6), qualquer mudança de mídia ou de UI
além do necessário para atualizar, assinatura de código do instalador (o SmartScreen continua avisando).

## Progresso

| Etapa | Descrição | Status |
|---|---|---|
| 1 | Identidade do app | Pendente |
| 2 | Logs em arquivo | Pendente |
| 3 | CI | Pendente |
| 4 | Updater no app | Pendente |
| 5 | Pipeline de release | Pendente |
| 6 | Versão mínima e código de acesso | Pendente |
| 7 | "O que há de novo" | Pendente |
| 8 | Verificação | Pendente |

---

## Decisões

### 1. Nome e identificador definitivos agora

`productName` passa de `desktop` para **`Ashtar`** e o `identifier` de `gustavo99g` para
**`com.gustavo99g.ashtar`**. O identificador define a pasta de dados e a continuidade do updater; trocá-lo
depois da v0.2.0 quebraria a atualização automática e exigiria outra instalação manual. Como a v0.2.0 já é
manual, a troca sai de graça. O app da v0.1 não guarda nada que precise migrar.

Os nomes internos (crates `desktop`/`desktop_lib`, pasta `desktop/`) não mudam: não aparecem para o usuário.

### 2. Releases num repositório público separado

O repositório do código é privado, e o updater do Tauri precisa baixar o manifesto e o instalador de uma URL
pública, sem token. Os releases vão para um repositório público só de distribuição,
**`gustavo99g/ashtar-releases`**, sem código. O pipeline do repositório privado publica lá com um token
de acesso restrito a esse repositório (segredo do Actions).

Alternativas descartadas: tornar o repositório principal público (decisão do dono, não técnica) e o
Cloudflare R2 (bom, mas acrescenta uma conta e um serviço antes da v0.2.2, quando o R2 entra para o backup; pode substituir depois sem
mudar o app, só o endpoint).

### 3. Canais estável e beta pelos releases do GitHub

- **Beta:** todo release nasce como *pre-release*. Um release fixo de tag `beta` guarda um único
  `latest.json`, sobrescrito a cada publicação, apontando para o instalador da versão nova.
- **Estável:** promover uma versão é desmarcar o *pre-release*. O endpoint
  `releases/latest/download/latest.json` do GitHub já ignora pre-releases, então quem está no estável
  passa a ver a versão promovida sem nenhum arquivo extra.

| Canal | Endpoint |
|---|---|
| Estável | `https://github.com/gustavo99g/ashtar-releases/releases/latest/download/latest.json` |
| Beta | `https://github.com/gustavo99g/ashtar-releases/releases/download/beta/latest.json` |

O app escolhe o endpoint em tempo de execução (updater builder no Rust, não a lista fixa do
`tauri.conf.json`) conforme a opção "receber versões beta", guardada localmente e desligada por padrão.
Como toda versão passa pelo beta antes, o beta nunca fica atrás do estável.

### 4. Uma fonte de versão

O `tauri.conf.json` passa a ler a versão do `desktop/package.json` (`"version": "../package.json"`). O
pipeline só publica se a tag (`v0.2.0`) for igual a essa versão. O `Cargo.toml` do desktop não é usado
para a versão do app.

A numeração segue o roadmap ("Numeração das versões"): o último número é **entrega × 10 + correção**. Esta
entrega sai como `0.2.0`; correções dela, como `0.2.1` a `0.2.9`; a UI nova, como `0.2.10`. O pipeline
recusa versões fora do semver (por exemplo, `0.2.01`).

### 5. Instalador NSIS por usuário, sem MSI

`bundle.targets` passa a `["nsis"]` e o NSIS instala por usuário (`installMode: "currentUser"`): sem
pedido de administrador, nem na instalação nem nas atualizações. O MSI deixa de ser gerado; o updater do
Windows usa o NSIS. O executável solto da v0.1 não se atualiza; quem o usa instala a v0.2.0 pelo
`-setup.exe`.

### 6. Atualização sem interromper chamada

- O app verifica ao abrir e depois a cada 3 horas.
- Achando versão nova, baixa em segundo plano e mostra um aviso discreto: "Atualização pronta —
  reiniciar".
- **Nunca reinicia sozinho durante uma chamada.** Se a pessoa não clicar, a atualização é instalada ao
  fechar o app.
- Falha de rede ao verificar é silenciosa (só log); falha de assinatura ou de instalação aparece como erro.

### 7. Chave de assinatura do updater

Gerada com `pnpm tauri signer generate`. A chave pública vai no `tauri.conf.json`; a privada e a senha
ficam nos segredos do Actions (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) **e numa
cópia de segurança fora do GitHub** (gerenciador de senhas). Perder a chave privada impede publicar
atualizações para quem já instalou: todos teriam de reinstalar manualmente.

### 8. Versão mínima pela API

- O app manda `X-App-Version: <versão>` em toda chamada à API.
- A API lê `MIN_CLIENT_VERSION` do ambiente. Sem a variável, não confere nada (o padrão até a v0.2.0 estar
  com todos).
- Abaixo da mínima, ou sem o cabeçalho, a API responde **426 Upgrade Required** com um JSON
  `{ kind: "client_outdated", message, min_version }`. O app mostra a mensagem e oferece verificar a
  atualização.
- O app da v0.1 não manda o cabeçalho: quando `MIN_CLIENT_VERSION` for ligada, ele para de entrar na sala
  com o erro genérico de hoje. Por isso ela só é ligada depois que o grupo inteiro estiver na v0.2.0.

### 9. "O que há de novo" a partir de um `CHANGELOG.md`

- `CHANGELOG.md` na raiz, uma seção por versão, escrita para os amigos (não para desenvolvedor).
- O build embute a seção da versão atual. Na primeira abertura depois de mudar de versão, o app mostra uma
  janela curta com ela e guarda a última versão vista.
- O pipeline usa a mesma seção como texto do release e das notas do `latest.json`.

### 10. Logs em arquivo com rotação

- `tracing-appender` com rotação diária, guardando os 7 arquivos mais recentes, na pasta de logs do app
  (`app_log_dir`, em `%LOCALAPPDATA%\com.gustavo99g.ashtar\logs`).
- O terminal continua recebendo o mesmo log em desenvolvimento.
- O hook de panic continua registrado antes de tudo; o arquivo começa a receber logs assim que o caminho é
  conhecido (no `setup` do Tauri).
- Um botão "Abrir pasta de logs" (plugin `opener`, que já existe) para o amigo mandar o arquivo. O envio
  automático ("enviar logs") continua na v0.6.

### 11. Código de acesso provisório

Adiado da v0.1 e substituído pela identidade na v0.2.2.

- O app manda `X-Access-Code` em toda chamada à API, com um valor embutido no build (`VITE_ACCESS_CODE`,
  vindo de um segredo do repositório no pipeline).
- A API lê `ACCESS_CODE` do ambiente. Sem a variável, não confere nada; com ela, código errado ou ausente
  recebe **401** com `{ kind: "access_denied", message }`.
- Protege contra quem descobre a URL do Funnel (que aparece nos logs públicos de certificados), não contra
  quem tem o executável: o código pode ser extraído dele. Para o grupo, basta.
- Como o app da v0.1 não manda o código, `ACCESS_CODE` é ligada junto com a versão mínima, depois que todos
  estiverem na v0.2.0.

### 12. CI enxuto por causa dos minutos

Repositório privado: 2.000 min/mês grátis, com runners Windows contando em dobro.

- **API (Ubuntu), a cada push:** `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`.
- **Desktop (Windows), em pull request e no pipeline de release:** `cargo clippy` e `cargo test` do
  `src-tauri`, `pnpm lint` e `tsc`.
- Cache do `cargo` e do `pnpm` nos dois.

---

## Etapa 1: identidade do app — pendente

- `productName`, `identifier`, título da janela e ícones (ícones definitivos podem esperar a UI nova).
- Versão lida do `package.json` (decisão 4) e `package.json` em `0.2.0`.
- `bundle.targets: ["nsis"]`, `installMode: "currentUser"` (decisão 5).

**Pronto quando:** `pnpm tauri build` gera `Ashtar_0.2.0_x64-setup.exe`, que instala sem pedir
administrador, e o app abre com o nome novo.

## Etapa 2: logs em arquivo — pendente

Decisão 10. Mover a inicialização do arquivo para o `setup`, manter o hook de panic no início do `main`.

**Pronto quando:** num build de release, abrir e entrar numa sala gera o arquivo do dia na pasta de logs, e
o botão abre a pasta.

## Etapa 3: CI — pendente

Workflow `ci.yml` (decisão 12).

**Pronto quando:** um pull request com um teste quebrado fica vermelho.

## Etapa 4: updater no app — pendente

- `tauri-plugin-updater` e `tauri-plugin-process` (reiniciar), com as permissões nas `capabilities`.
- Chave pública no `tauri.conf.json` (decisão 7).
- Comandos Rust `check_update(channel)` / `install_update()`, com o endpoint escolhido em tempo de
  execução (decisão 3).
- Opção "receber versões beta", guardada localmente.
- Fluxo da decisão 6, com o estado da chamada consultado antes de reiniciar.

**Pronto quando:** apontando para um manifesto de teste, o app encontra a versão, baixa, confere a
assinatura e instala ao reiniciar; durante uma chamada, não reinicia sozinho.

## Etapa 5: pipeline de release — pendente

Workflow `release.yml`, disparado por tag `v*`:

1. Confere tag = versão do `package.json` (decisão 4).
2. Roda as checagens do CI.
3. Compila e assina com o `tauri-action`, com `VITE_API_URL` vindo de uma variável do repositório.
4. Publica no `ashtar-releases` como pre-release, com o texto da seção do `CHANGELOG.md`.
5. Sobrescreve o `latest.json` do release `beta`.

Promoção para o estável: desmarcar o pre-release no GitHub (manual, de propósito).

**Pronto quando:** `git tag v0.2.0 && git push --tags` termina com o instalador e o `latest.json`
publicados, sem nenhum passo manual.

## Etapa 6: versão mínima e código de acesso — pendente

Decisões 8 e 11: os dois cabeçalhos (`X-App-Version` e `X-Access-Code`) num só ponto do app (o `fetch` da
API), a conferência na API e as mensagens no app.

**Pronto quando:** com `MIN_CLIENT_VERSION=0.2.1`, um app 0.2.0 recebe a mensagem de atualização em vez do
erro genérico; com `ACCESS_CODE` definido, uma chamada sem o código recebe 401 e o app recebe o token
normalmente; sem as variáveis, nada muda.

## Etapa 7: "O que há de novo" — pendente

Decisão 9.

**Pronto quando:** depois de atualizar de uma versão para outra, a primeira abertura mostra a seção nova do
`CHANGELOG.md` uma única vez.

## Etapa 8: verificação — pendente

1. Instalar a v0.2.0 do zero numa máquina sem o app (e numa com o executável da v0.1).
2. Publicar uma v0.2.1 de teste: chega primeiro a quem está no beta; depois de promovida, a quem está no
   estável.
3. Atualização durante uma chamada: o aviso aparece, mas o app não reinicia sozinho.
4. Uma versão com teste quebrado não é publicada.
5. Cliente abaixo da versão mínima recebe a mensagem; chamada sem o código de acesso é recusada.
6. "O que há de novo" aparece uma vez depois de atualizar.
7. Logs do dia existem na pasta e o botão abre a pasta.
8. Cópia de segurança da chave privada conferida (consegue assinar a partir dela).

**Critério de pronto da fase:** os critérios da v0.2.0 no `docs/roadmap.md` (versão nova chega sozinha
passando pelo beta, teste falhando bloqueia o release, cliente antigo recusado com pedido de atualização), a
lista acima passando, e todos os itens do `NOTES.md` resolvidos ou conscientemente adiados.
