# NOTES — pendências da v0.2.1 (identidade na API)

Lista de verificação da fase descrita no [`PLAN.md`](PLAN.md). Cada item deve ser resolvido ou
conscientemente adiado (marcar como tal) antes de fechar a fase. A lista da fase anterior está arquivada em
[`docs/plans/v0.2.0-notes.md`](docs/plans/v0.2.0-notes.md).

## Vindos do BACKLOG

- [ ] **Identidade falsa nova a cada entrada** (`idiot-<uuid>`, nome `Idiota-<uuid>`): sem nome escolhido nem
      id por instalação. A API passa a ter identidade do dispositivo, membros e sessão (Etapas 2 e 3), mas o
      app só passa a usá-las na v0.2.2. Até lá, o id aleatório por entrada evita colisão no LiveKit.
- [ ] **Permissão do beta pela API:** a API devolve o canal de atualização de cada usuário (substitui a
      variável `ASHTAR_UPDATE_CHANNEL`); o dono marca e desmarca pelo `admin` (Etapa 4) e está sempre no
      beta. A tela de usuários vem com a UI nova (v0.2.2).

## Antes de usar

- [ ] **Backup fora do computador** configurado e uma restauração testada **antes** de qualquer membro entrar
      (Etapa 5): a partir daqui há dados reais do grupo.
- [ ] **`DATABASE_URL` no `.env`** da API e no `.env.example`.
- [ ] **Criar o dono pelo `admin`** e, quando a parte visual chegar, gerar uma recuperação para vincular o
      computador do dono (decisão 5 do `PLAN.md`).

## Riscos e cuidados

- [ ] **Rota antiga aberta:** enquanto o app não usar as rotas novas, `/api/voice/join` continua aceitando
      o código de acesso provisório. Só a parte visual desliga isso e sobe o `MIN_CLIENT_VERSION` (ADR 0011).
- [ ] **Limite de tentativas global:** quem errar convites de propósito trava os convites de todos por até
      10 minutos (decisão 3 do `PLAN.md`; ADR 0011).
- [ ] **Convite de grupo que vaza** deixa entrar quem o viu enquanto vale; o limite de usos, a validade
      curta, o `revogar` e o `remover` seguram isso.
- [ ] **Trocar a placa-mãe** exige um convite de recuperação (ADR 0011).
- [ ] **`COLLATE NOCASE` só ignora maiúsculas no ASCII:** "JOÃO" e "joão" contam como nicks diferentes
      (ADR 0010).
- [ ] **Escritas simultâneas do `admin` e da API** esperam até 5 s (`busy_timeout`); o `admin` grava com a
      API no ar (ADR 0010).
- [ ] **Comparação do código de acesso** em `client_policy.rs` não é de tempo constante; aceitável para o
      grupo atual, rever na VPS (v0.2.6).
