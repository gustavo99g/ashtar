# Roteiro de testes do RC (v0.9)

O roteiro manual da `0.9.0` (decisão 16 do [`PLAN.md`](../PLAN.md)). Cada caso tem o passo a passo, o que tem de
acontecer e uma linha para quem testou, em qual versão e com qual resultado. Os casos vêm do roadmap, renumerados, e
ganham os que vieram depois, inclusive os itens das notas antigas que o uso do grupo não exercita (a triagem marcou
cada um com "roteiro do RC" e o número do caso).

**Como usar.** Teste na versão beta, com pelo menos dois computadores (três nos casos marcados). Anote em
**Testado** quem, a versão e ✅ (passou), ⚠️ (passou com ressalva, anotada) ou ❌ (falhou, com o que aconteceu). Uma
falha vira correção na própria `0.9.x`; um pedido novo vai para o `BACKLOG.md` (decisão 17).

**Combinados.** "A" e "B" são dois membros em computadores diferentes; "Dono" é o Kid. "Sala" é uma sala de voz do
grupo; "ligação" é a ligação privada.

## Mídia

### M01 — Dois participantes

1. A entra numa sala; B entra na mesma sala.
2. Os dois falam por um minuto.

**Tem de acontecer:** os dois se ouvem sem corte, o anel de quem fala acende, a lista da sala mostra os dois, e o ping
do painel de voz fica verde ou amarelo.

**Testado:**

### M02 — Microfone, mute e deafen

1. A muta e desmuta pelo painel, pela barra da sala e pelo atalho (Ctrl+Shift+M).
2. A desliga o áudio (Ctrl+Shift+D) e liga de novo.
3. Se alguém usa fone Bluetooth: abrir o microfone com ele (o fone troca para "mãos livres").

**Tem de acontecer:** B vê o microfone cortado e o fone cortado na lista; o som de mutar e de desligar o áudio toca
para A; com o áudio desligado, A não ouve ninguém nem os sons do soundboard. O Bluetooth não entra em laço de trocar
de dispositivo, e o aviso de dispositivo não repete.

**Testado:**

### M03 — Transmissão (Movimento e Nitidez)

1. A transmite um jogo com Movimento; B assiste por um minuto.
2. A troca para Nitidez pelo popover do Tela.
3. Se alguém tem monitor HDR ou notebook com duas placas: transmitir de lá também.

**Tem de acontecer:** a imagem chega fluida no Movimento e nítida na Nitidez; o painel de detalhes mostra o encoder
certo (o da placa, ou "Software"). No HDR a cor não sai lavada; no notebook, captura e encoder ficam na mesma placa.

**Testado:**

### M04 — Transmissão com áudio

1. A transmite um jogo com o áudio ligado, falando ao mesmo tempo.
2. Liga e desliga o áudio da transmissão no meio.

**Tem de acontecer:** B ouve o jogo e a voz de A separados, sem eco e sem o jogo encobrir a voz; desligar o áudio
corta só o jogo.

**Testado:**

### M05 — Terceiro participante (três computadores)

1. A, B e C na mesma sala; A transmite.

**Tem de acontecer:** os três se ouvem; B e C assistem ao mesmo tempo; quem assiste aparece no popover de A.

**Testado:**

### M06 — Reentrada

1. B sai da sala e entra de novo, três vezes seguidas, rápido.
2. B troca para outra sala e volta.

**Tem de acontecer:** B nunca fica em duas salas nem em nenhuma; a lista se ajusta em segundos; a transmissão de A
continua para quem ficou.

**Testado:**

### M07 — Reconexão (queda curta e suspensão)

1. Com A transmitindo e B assistindo, B desliga a internet por 10 segundos e liga de novo.
2. B suspende o Windows com a sala aberta e volta depois de um minuto.
3. O Dono desconecta B pela moderação; depois arquiva a sala com alguém reconectando (se der).

**Tem de acontecer:** B volta sozinho para a mesma sala, sem ficar em duas, e continua assistindo com o mesmo volume e
a mesma qualidade; a câmera não volta ligada; quem foi desconectado, movido ou perdeu o acesso não reconecta; a sala
arquivada no meio desiste com o aviso.

**Testado:**

### M08 — Duas transmissões, foco e miniaturas

1. A e B transmitem; C assiste às duas.
2. C põe uma em foco, amplia, usa a tela cheia e a roda do mouse no palco.
3. A encerra a dele; C clica em Assistir pela tela do servidor, fora da sala, com outra já aberta.

**Tem de acontecer:** o palco divide e se rearruma sem piscar quando uma acaba; a própria transmissão não aparece no
palco de quem transmite; Assistir de fora acrescenta, não troca.

**Testado:**

### M09 — Ligação privada, com tela

1. A liga para B; B atende; A compartilha a tela.
2. A perde a internet por 10 segundos.

**Tem de acontecer:** a ligação toca, conecta e mostra a tela; na volta, A reconecta na ligação (só se B ainda está
nela). Desligar encerra para os dois.

**Testado:**

### M10 — Supressão de ruído, eco e pressionar para falar com um jogo em foco

1. A liga a supressão de ruído, com um ventilador ou teclado mecânico perto, e fala.
2. A troca o cancelamento de eco e o ganho automático no meio da chamada.
3. A ativa o Pressionar para falar e joga um jogo em tela cheia; aperta a tecla, faz Alt+Tab com ela apertada.
4. Num jogo aberto como administrador, tenta o atalho. Anotar se algum anti-cheat reclamou.

**Tem de acontecer:** o portão não corta o começo nem o fim das palavras; o teclado não abre o microfone; o volume
acima de 100% não distorce; trocar o eco refaz a trilha sem cair. A tecla funciona com o jogo em foco e o portão fecha
quando ela solta, mesmo depois do Alt+Tab. Com o jogo como administrador o atalho não chega, e a aba Atalhos explica.

**Testado:**

### M11 — Câmera na sala e na ligação

1. A liga a câmera na sala, troca de câmera com ela ligada e desconecta a câmera USB no meio.
2. A transmite com a câmera ligada; depois atende uma ligação com a câmera ligada.
3. A fica Invisível na sala com a câmera.

**Tem de acontecer:** a câmera nunca começa ligada (nem ao reconectar, nem ao voltar da ligação); trocar e desconectar
não travam; atender desliga a câmera; o espelho vale só para A; a miniatura e a tela do servidor não baixam câmera;
o Invisível na sala aparece com a câmera para quem está nela.

**Testado:**

### M12 — Transmitir o jogo pelo cartão

1. A abre um jogo e usa o cartão "Jogando" no painel para transmitir, dentro e fora da sala.
2. Se alguém joga em tela cheia exclusiva (não janela sem borda): transmitir esse jogo.

**Tem de acontecer:** o cartão acha o jogo e começa a transmissão dele; fora da sala, pergunta antes. Na tela cheia
exclusiva, a captura funciona como janela, ou o aviso sugere compartilhar a tela.

**Testado:**

### M13 — Moderação na voz

1. O Dono silencia, deixa surdo, desliga a câmera e encerra a transmissão de B, um de cada vez.
2. B troca de sala; o Dono libera tudo.

**Tem de acontecer:** B vê o escudo e não consegue desmutar nem ligar o áudio; o silenciado continua silenciado em
outra sala até alguém liberar; nada disso vale numa ligação privada; o Registro guarda cada ação.

**Testado:**

### M14 — Print da transmissão

1. B assiste à transmissão de A e aperta Ctrl+Shift+P.
2. A aperta o mesmo atalho na própria transmissão.

**Tem de acontecer:** o print vai para a área de transferência (e para Imagens\Ashtar, com a opção ligada), com o som
de câmera; a transmissão certa é a em foco, a assistida ou a própria.

**Testado:**

### M15 — Placa AMD com o encoder falhando (AMF e plano B)

1. Numa placa AMD, transmitir; depois, se der, numa placa sem encoder de hardware.
2. Anotar as placas do grupo que já transmitiram (NVIDIA, Intel, AMD).

**Tem de acontecer:** a AMD transmite pelo AMF; se o encoder falha, o plano B entra sozinho e o painel mostra
"Software"; nenhuma marca de placa trava a transmissão.

**Testado:**

### M16 — Janela que muda de tamanho e jogo que troca de janela

1. A transmite uma janela e muda o tamanho dela, minimiza e fecha no meio.
2. A transmite o LoL do cliente até a partida (o jogo troca de janela).

**Tem de acontecer:** a imagem se ajusta ao tamanho novo; minimizar pausa sem cair; fechar encerra com aviso; o LoL
segue para a janela da partida.

**Testado:**

### M17 — Soundboard na sala e na ligação

1. A abre Sons no painel de voz, toca um som; B ouve.
2. A põe um som no lugar 1 e aperta Ctrl+Alt+1 com um jogo em foco.
3. B baixa o volume do soundboard em Configurações › Notificações; depois desliga a chave geral.
4. A e B numa ligação: A toca um som.

**Tem de acontecer:** o som toca para os dois, na saída escolhida, e a onda dourada aparece em A na lista e no bloco,
sem o nome do som; o atalho funciona com o jogo em foco; o volume muda só para B; com a chave desligada B não ouve
nada, mas ainda vê a onda. Na ligação funciona igual.

**Testado:**

### M18 — Bloquear sons e o limite

1. A toca seis sons seguidos, rápido.
2. O Dono abre o cartão de A na sala e liga "Bloquear sons"; A troca de sala; o Dono libera.
3. A e B numa ligação com os sons de A bloqueados.

**Tem de acontecer:** um som a cada 3 s e no máximo 5 em 30 s, com o aviso "Calma"; bloqueado, o botão Sons de A fica
apagado com "Um moderador bloqueou seus sons", em todas as salas, até liberar; na ligação o bloqueio não vale. O
Registro guarda "bloqueou os sons de" e "liberou os sons de".

**Testado:**

## Aplicação

### A01 — Convite válido

1. O Dono cria um convite e manda o link pelo WhatsApp.
2. Alguém novo abre o link, instala e entra.

**Tem de acontecer:** a prévia do WhatsApp mostra o cartão do convite; o link abre o app (ou a página de baixar); a
pessoa entra com o nick que escolheu e ganha "Enviar sons".

**Testado:**

### A02 — Código errado

1. Abrir um link de convite com o código trocado.

**Tem de acontecer:** "Convite não encontrado", com o que fazer.

**Testado:**

### A03 — Convite vencido

1. Criar um convite de 5 minutos, esperar vencer e abrir.

**Tem de acontecer:** "Esse convite venceu" no app e na página do link.

**Testado:**

### A04 — Convite já usado e convite cancelado

1. Usar um convite de um uso e abrir de novo.
2. Cancelar um convite no Painel e abrir.

**Tem de acontecer:** "Esse convite já foi usado" e "Esse convite foi cancelado", cada um com o seu texto.

**Testado:**

### A05 — Convite de recuperação

1. O Dono cria uma recuperação para B; B abre num computador novo.

**Tem de acontecer:** B entra como ele mesmo, com o histórico, e o computador antigo deixa de entrar.

**Testado:**

### A06 — Formatar o PC e entrar direto, sem desvincular

1. Alguém formata o PC (ou reinstala o Windows) **sem** o Dono desvincular antes.
2. Instala o app pelo link de baixar.

**Tem de acontecer:** entra direto, sem convite, porque a chave do computador não muda.

**Testado:**

### A07 — Hardware com UUID inválido

1. Num computador cujo UUID da placa é genérico (o log diz "chave aleatória"), entrar.

**Tem de acontecer:** entra com uma chave aleatória guardada; formatar esse computador exige recuperação (anotado na
ajuda).

**Testado:**

### A08 — Dispositivo desvinculado

1. O Dono desvincula o computador de B no Painel.

**Tem de acontecer:** B cai para a tela de entrada com o aviso, e só volta com recuperação.

**Testado:**

### A09 — API indisponível

1. Parar a API (`docker compose stop api`) com o app aberto; tentar entrar numa sala e trocar de sala.
2. Subir de novo.

**Tem de acontecer:** a faixa "Sem conexão com o servidor" aparece (não pisca em quedas de menos de 5 s); entrar numa
sala para no tempo limite com erro, sem ficar em "conectando"; trocar de sala com o token falhando deixa a pessoa na
sala antiga. Na volta, tudo recarrega sozinho. Nenhum texto técnico na tela (nada de "Erro interno", código HTTP
ou inglês): cada erro diz o que fazer. Repetir com a rede lenta (limitar a banda do Wi-Fi ou usar o celular
roteando com sinal fraco): os carregamentos aparecem e nenhum fica girando para sempre.

**Testado:**

### A10 — LiveKit indisponível

1. Parar o LiveKit; tentar entrar numa sala e trocar de sala.

**Tem de acontecer:** o erro de voz aparece em português, com "Tentar de novo"; o chat continua funcionando; o Painel › Servidor
mostra o LiveKit fora.

**Testado:**

### A11 — Navegação texto e voz

1. Na sala, abrir canais de texto, conversas, configurações e voltar.

**Tem de acontecer:** a voz não cai; a miniatura da transmissão segue em todas as telas, inclusive nas configurações.

**Testado:**

### A12 — Atualização automática

1. Com uma versão nova no beta, abrir o app antigo.
2. Depois de atualizar, abrir um link de convite (`ashtar://`).

**Tem de acontecer:** baixa, instala e reabre sozinho; o volume de cada pessoa e os lugares do soundboard continuam;
o link `ashtar://` continua abrindo o app.

**Testado:**

### A13 — Cliente abaixo da versão mínima

1. Subir o `MIN_CLIENT_VERSION` acima da versão instalada.

**Tem de acontecer:** a tela "Atualize o Ashtar", com o botão que atualiza.

**Testado:**

### A14 — Mensagem privada

1. A manda mensagem para B, com B na bandeja e com B jogando.

**Tem de acontecer:** o aviso aparece no canto (no Ocupado, não), com o som; o número de não lidas aparece na bandeja;
abrir marca como lido.

**Testado:**

### A15 — Troca de nome e foto

1. A troca o nome visível e a foto (com uma foto de celular de 12 MP).

**Tem de acontecer:** o recorte não trava; todo mundo vê o nome e a foto novos, inclusive quem está numa ligação.

**Testado:**

### A16 — Menção em canal silenciado

1. B silencia um canal; A menciona B lá e manda uma mensagem comum.

**Tem de acontecer:** a menção avisa; a mensagem comum não.

**Testado:**

### A17 — Ligação recebida estando numa sala

1. B está numa sala, jogando em tela cheia; A liga para B.

**Tem de acontecer:** toca, sem roubar o foco do jogo; atender sai da sala; desligar oferece "Voltar para a sala".

**Testado:**

### A18 — Versão no canal beta antes de todos

1. O Dono liga o beta para B; publica uma versão beta.

**Tem de acontecer:** só B recebe; desligar o beta deixa B na versão até o estável passar dela.

**Testado:**

### A19 — Cartão do convite no chat

1. O Dono cola um link de convite num canal; depois cancela o convite.

**Tem de acontecer:** o cartão aparece com quem convidou e até quando vale; "Copiar link" funciona; depois de cancelar,
o cartão diz que foi cancelado. Nenhuma prévia da VPS aparece.

**Testado:**

### A20 — Anexos, prévia de link e busca

1. Enviar um vídeo de 100 MB, baixar de volta e tocar do meio.
2. Colar um link do YouTube; buscar uma mensagem antiga e pular para ela.
3. Na sala, abrir as configurações assistindo a uma transmissão.

**Tem de acontecer:** o envio passa pelo Caddy sem cortar; a capa do vídeo sai sem travar; baixar mostra o progresso
e não sobrescreve um arquivo com o mesmo nome; o vídeo toca do meio sem baixar tudo. A prévia aparece; a busca abre a
mensagem certa. A miniatura da transmissão continua por cima das configurações.

**Testado:**

### A21 — Enviar som

1. B abre Configurações › Servidor › Sons, clica em Carregar som e escolhe um MP3 de 10 s.
2. Corta 4 s com as alças, ouve o trecho, baixa o volume, liga Igualar e Suavizar, dá nome e emoji, envia.
3. Arrasta outro arquivo para a tela; tenta mandar um quarto som com três aguardando.

**Tem de acontecer:** a onda aparece com as alças; o play toca só o trecho; o som vai para "Aguardando"; arrastar abre
o editor; o quarto é recusado com o texto do limite.

**Testado:**

### A22 — Aprovar e recusar som

1. O Dono abre a aba Aprovação (o contador dourado mostra a fila), ouve e aprova um som de B.
2. Recusa outro com motivo; B edita e reenvia.
3. Com 50 sons no grupo, tenta aprovar mais um.

**Tem de acontecer:** B recebe o aviso de aprovado e de recusado, com o motivo; o aprovado aparece na grade de todo
mundo; o reenvio substitui o recusado; o 51º é recusado com "O grupo já tem 50 sons".

**Testado:**

### A23 — Lugares do soundboard

1. A arrasta um som para o lugar 2; usa "Pôr no lugar 3" pelo botão direito em outro.
2. Põe no lugar 3 o som que já está no 2; esvazia um lugar.
3. O Dono exclui um som que está num lugar de A.

**Tem de acontecer:** o som que está num lugar ganha o número dourado; um som ocupa um lugar só; o excluído deixa o
lugar com "Som removido" e o atalho dele não toca nada.

**Testado:**

## Servidor

### S01 — Backup do banco, das fotos, dos emojis e dos sons

1. Na VPS, `./backup.sh`.
2. Conferir no R2 a cópia do banco e a pasta `files/`.
3. Rodar de novo.

**Tem de acontecer:** o banco sobe; os arquivos sobem na primeira vez e, na segunda, nenhum sobe de novo; o Painel ›
Servidor mostra o último backup e a última cópia dos arquivos.

**Testado:**

### S02 — Restauração completa numa cópia

1. Seguir a "Restauração completa" do `deploy/server/README.md` numa API de casa ou num contêiner local.
2. Apontar o app de desenvolvimento para ela (`VITE_API_URL`).

**Tem de acontecer:** membros, histórico, fotos, emojis e sons voltam; um anexo aparece como "Arquivo indisponível",
sem quebrar a mensagem nem a conversa.

**Testado:**

### S03 — Servidor fora do ar avisa no celular

1. `docker compose stop api` na VPS e esperar 5 minutos.

**Tem de acontecer:** o UptimeRobot avisa no celular; ao subir, avisa que voltou.

**Testado:**
