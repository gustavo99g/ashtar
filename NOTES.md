# NOTES — pendências da v0.6 (confiabilidade e configurações)

Lista de verificação da fase descrita no [`PLAN.md`](PLAN.md).
Cada item deve ser resolvido ou conscientemente adiado (marcar como tal) antes de fechar a entrega em que ele está.

## Antes de começar

- [ ] **A v0.5 na beta.** A `0.5.0` sai pela beta; os `[ ]` do `NOTES.md` da v0.5 são conferidos no teste dela. O que
      sobrar fica marcado como adiado em `docs/plans/v0.5-notes.md`, e o que pede código entra aqui.
- [ ] **O canvas:** os cinco quadros novos da Etapa 0 (fileira "Confiabilidade (0.6)") desenhados; falta o Kid conferir.

## Parte 1 — configurações e atalhos

### Cadeia do microfone

- [ ] **O `AudioWorklet` no WebView2** junto do RNNoise: o custo de CPU dos dois na mesma cadeia.
- [ ] **O portão não corta o começo das palavras** (10 ms para abrir) nem o fim (300 ms para fechar).
- [ ] **A sensibilidade automática** com ventilador e com teclado mecânico: não abre com o teclado.
- [ ] **O volume de entrada acima de 100%** não distorce com o RNNoise depois (o ganho vem antes).
- [ ] **A migração do `noiseStore`**: quem desligou a supressão continua com ela desligada.
- [ ] **Eco e ganho automático** trocados no meio da chamada: a trilha é refeita e a cadeia volta.

### Voz e vídeo

- [ ] **O volume de saída** por cima do volume de cada pessoa e do reforço acima de 100% (`boost.ts`).
- [ ] **Testar microfone** fora da sala devolve o som na saída escolhida; dentro, só o medidor.
- [ ] **Os padrões da transmissão** chegam ao seletor de fontes, e mudar no seletor não muda o padrão.

### Gancho e atalhos

- [ ] **Um jogo em tela cheia exclusiva** recebe a tecla do pressionar para falar e o Ashtar também.
- [ ] **Um jogo como administrador** (UIPI): o atalho não chega. Explicar na aba Atalhos.
- [ ] **Os anti-cheats dos jogos do grupo** não reclamam do gancho.
- [ ] **O gancho não é desligado pelo Windows** depois de uma hora de uso (o tempo do callback).
- [ ] **O teclado ABNT2:** os nomes das teclas (Ç, as acentuadas) aparecem certos.
- [ ] **A tecla segurada** (repetição) dispara o atalho de mutar uma vez só.
- [ ] **Alt+Tab com a tecla do pressionar para falar apertada:** o portão fecha quando ela solta, mesmo em outra
      janela.
- [ ] **Os textos** da aba Atalhos, do aviso de combinação repetida e do "Pressionar para falar: V", revisados.

## Parte 2 — confiabilidade

### Voz e transmissão

- [ ] **Quem foi desconectado, movido ou perdeu o acesso** não reconecta.
- [ ] **A sala arquivada no meio da reconexão:** desiste, com o aviso de arquivada.
- [ ] **A reconexão durante uma ligação privada** volta para a ligação, e só se a outra pessoa ainda está nela.
- [ ] **A câmera não volta ligada** depois da reconexão.
- [ ] **A suspensão do Windows** com a sala aberta: ao voltar, reconecta sem ficar em duas salas.
- [ ] **A transmissão que volta:** quem assistia continua assistindo, com o mesmo volume e a mesma qualidade.
- [ ] **O limite de transmissões** (6) não recusa quem está voltando.

### Dispositivos

- [ ] **Bluetooth** que troca de perfil (o fone vira "mãos livres" ao abrir o microfone): não fica em laço de
      aviso.
- [ ] **O aviso não repete** quando o mesmo dispositivo some e volta várias vezes seguidas.

### Servidor

- [ ] **A faixa não pisca** em quedas menores que 5 segundos.
- [ ] **As consultas recarregadas** ao voltar: nada fica velho (não lidas, membros online, canais).
- [ ] **O `TimeoutLayer`** não corta o WebSocket nem o upload dos logs.

### Qualidade da conexão

- [ ] **O `ConnectionQuality` do LiveKit** chega para todos os participantes, não só para o próprio.
- [ ] **A mensagem `voice.stats`** não pesa (uma a cada 5 s por pessoa).

### Logs

- [ ] **O tamanho do `.zip`** de 2 dias de log, com uma noite de transmissão.
- [ ] **O disco da VPS:** a pasta `data/logs/` entra no backup? Decidir (sugestão: não, são de 30 dias).
- [ ] **O texto do botão** diz que só o dono vê, e que os logs têm nicks.

## Riscos e cuidados

- [ ] **O gancho global vê todas as teclas do computador.** O Rust só compara com a lista de atalhos e não grava nem
      manda nada além do nome do atalho; nenhuma tecla vai para o log.
- [ ] **Os logs saem do computador da pessoa.** Só quando ela clica, nunca sozinhos, e o conteúdo é o mesmo da pasta
      que ela já pode abrir.
