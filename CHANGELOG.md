# O que há de novo no Ashtar

## 0.8.6

- A transmissão acompanha a janela quando ela muda de tamanho, sem ficar em baixa resolução.
- Quando o jogo troca de janela, a transmissão não fica mais parada na última imagem.

## 0.8.5

- Nas placas AMD em que o encoder do Windows trava, como a RX 7600, o Ashtar agora fala direto com o encoder da AMD antes de ir para o processador. A transmissão continua na placa de vídeo e pesa menos no jogo. Quando isso acontece, o Ashtar lembra da placa e, nas próximas transmissões, já começa pelo caminho que funciona.
- A transmissão em tela cheia não mostra mais uma faixa colorida na borda de baixo.

## 0.8.4

- Na RX 7600 e em outras placas em que o encoder não aceita a imagem direto da GPU, o Ashtar tenta entregar a imagem pela memória antes de ir para o processador, e assim a placa continua codificando.

## 0.8.3

- Antes de transmitir, o Ashtar confere se o encoder da placa de vídeo devolve imagem. Se não devolver, como na RX 7600, a transmissão vai pelo processador na hora, em vez de sair preta.

## 0.8.2

- Mais um ajuste no encoder da placa de vídeo para as AMD da série RX 7000, que ainda deixavam a transmissão preta para quem assistia.

## 0.8.1

- Transmitir com o encoder da placa de vídeo nas AMD da série RX 7000: a imagem saía preta ou embaralhada para quem assistia.
- O print do Windows (Win + Shift + S) e o OBS voltam a mostrar o Ashtar. Ele só fica fora das capturas enquanto você transmite uma tela inteira.

## 0.8.0

- Jogando agora: o Ashtar reconhece o jogo aberto e mostra um cartão em cima dos controles do usuário, com o ícone, o nome, há quanto tempo e o Transmitir. Só você vê; ninguém mais fica sabendo o que você joga. O jogo é reconhecido pelos launchers do PC (Steam, Epic, Riot, EA, Ubisoft, Battle.net e GOG) e pela lista de jogos do Discord, e o cartão aparece assim que a janela do jogo está pronta para transmitir, mesmo se o jogo já estava aberto antes do Ashtar.
- Transmitir pelo cartão: numa sala ou numa ligação, transmite a janela do jogo na hora, com as configurações da última transmissão. Fora da voz, escolha a sala na lista e ela já entra transmitindo.
- Jogos com cliente e partida separados, como o League of Legends: a transmissão vai sozinha para a partida quando ela abre e volta para o cliente quando ela fecha, sem você mexer e sem tocar o som de parar. Quem estava assistindo continua assistindo.
- Configurações › Atividade: liga e desliga o reconhecimento, mostra os jogos que já abriram neste PC, esconde um jogo do cartão e o "Adicionar jogo" para o que o Ashtar não reconhece sozinho.
- Na lista de janelas da transmissão, a janela de um jogo aparece com o nome do jogo, no lugar do título que ele põe ("League of Legends" em vez de "League of Legends (TM) Client").
- Moderar voz: uma permissão nova, que o dono dá em Membros. Quem tem pode silenciar, deixar surdo, desligar a câmera e encerrar a transmissão de alguém numa sala de voz, pela seção Moderação do cartão da pessoa. Quem foi silenciado não consegue se desmutar, nem pelo atalho, até ser liberado, e o mute dele fica vermelho com um escudo para todos. Nas ligações privadas nada muda.
- Registro: Painel de controle › Registro mostra ao dono quem fez o quê, como moderação, cargos, permissões e canais, com filtros. As linhas com mais de um ano são apagadas.
- Print da transmissão: Ctrl+Shift+P tira um print da transmissão que você está assistindo, ou da sua, e copia para colar em qualquer lugar. Em Voz e vídeo, "Salvar prints no computador" também guarda em Imagens\Ashtar. O atalho dá para trocar em Configurações › Atalhos.
- "Sua transmissão está saindo preta": um filme com proteção ou um jogo em tela cheia exclusiva sai preto na captura, e agora o Ashtar avisa quem transmite, com o Trocar fonte. A legenda e os controles do player por cima não enganam o aviso.
- Sons novos: começar e parar a sua transmissão, e ligar e desligar a câmera, cada um com a sua chave em Notificações.
- A Câmera do painel "Voz conectada" agora liga e desliga a câmera.
- Transmitindo, o ícone do Ashtar na bandeja e na barra de tarefas ganha uma bolinha dourada, no lugar da vermelha das não lidas.
- Começar a transmitir não minimiza mais o Ashtar: só traz a janela escolhida para a frente.
- Os botões Trocar, Detalhes e Pausar do popover da transmissão ganharam fundo, e a latência aparece em milissegundos inteiros.
- Os avisos no canto contam o tempo com o Ashtar atrás de outra janela, como num segundo monitor, e só param com ele minimizado.

## 0.7.1

- Assistir pela lista: passe o mouse em quem está AO VIVO na lista de salas, à esquerda, para ver o que a pessoa transmite (o que está sendo transmitido, a qualidade, há quanto tempo e quantos assistem) e clicar em Assistir. Fora da sala, você entra nela e a transmissão já abre em foco.
- Na transmissão em foco, o AO VIVO, o nome e os botões só aparecem com o mouse em cima: parado, a imagem fica limpa.
- Clique com o botão direito numa imagem do chat para Copiar imagem ou Baixar. O visualizador em tela cheia também ganhou o Copiar.
- As mensagens fixadas mostram as imagens, e clicar numa abre o visualizador.
- Depois de anexar um arquivo, pelo +, arrastando ou colando, o campo fica pronto: é só apertar Enter para enviar.
- Arrastar arquivos para a conversa mostra o "Solte para enviar", com quantos arquivos vêm.
- O seletor de emoji abre mais rápido e, no campo de escrever, fica aberto para escolher vários seguidos, com o foco de volta no campo: é só continuar escrevendo e mandar com Enter.
- Trocar de sala toca o som de sair e o de entrar, mesmo trocando rápido.
- Os avisos no canto ganharam um tipo: certo, erro, aviso ou informação, com o ícone e a barra de tempo na cor dele e o título em negrito. O erro fica 12 s na tela, e as confirmações curtas, como "Imagem copiada", viram uma linha só. O "Salvo em Downloads" tem o "Abrir pasta", que mostra o arquivo no Explorer.
- O menu da sala diz "Editar sala" em vez de "Renomear sala": ali também se muda quem tem acesso e se a sala é restrita.
- A tela cheia da transmissão não deixa mais uma faixa branca na tela ao entrar de novo.
- Na tela cheia, quem está na sala aparece por cima da parte de baixo da imagem. Com o mouse parado, a fileira, os botões e o cursor somem, e fica só a transmissão.
- O número de menções nos canais e a linha Novas mensagens voltaram ao dourado.
- A lista de membros diz "Em Sala" e "Transmitindo em Sala", que funciona com qualquer nome de sala.

## 0.7.0

- A 0.7.0 é a primeira versão publicada com o que está na 0.6.0: quem vem da 0.5 ganha as duas de uma vez.
- Foto de perfil: escolha em Configurações › Perfil, com o recorte redondo e o zoom. Ela aparece para todos na hora, no chat, na lista de membros e na sala, e "Remover foto" volta para a letra e a cor. As fotos que você já usou ficam guardadas em "Fotos anteriores", para voltar a uma delas com um clique ou apagar de vez.
- O menu da mensagem: passe o mouse para reagir, responder ou abrir os três pontinhos, ou clique com o botão direito. Dá para responder, reagir, editar, copiar o texto, encaminhar, fixar e excluir, e só aparece o que você pode fazer.
- Editar: só as suas mensagens, sem limite de tempo; elas ganham "(editada)". A seta para cima no campo vazio edita a sua última, e Esc cancela.
- Excluir: o autor exclui as suas, e o dono exclui qualquer uma de um canal. Segure Shift para pular a confirmação.
- Responder: a resposta mostra a mensagem original em cima, e clicar nela leva até lá, mesmo que seja antiga. Por padrão o autor é mencionado; o botão "@ Ligado" no campo desliga.
- Reações com qualquer emoji, até 20 diferentes por mensagem. Clique numa reação para somar a sua ou tirá-la, e passe o mouse para ver quem reagiu. Os seis da barra são os que você mais usa.
- Seletor de emoji, também no botão do campo: em português, com busca, os seus recentes e uma categoria por vez.
- Emojis do grupo: quem tem a nova permissão "Gerenciar emojis" sobe imagens em Painel de controle › Emojis, até 100, GIF animado incluído. Escreva :nome: para usar no texto, ou escolha no seletor e nas reações.
- Formatação no texto: **negrito** entre dois asteriscos, *itálico* entre um, código entre crases (três crases para um bloco) e spoiler entre duas barras verticais, que esconde até o clique.
- Anexos: pelo botão +, arrastando para a conversa ou colando com Ctrl+V. Até 10 arquivos de até 100 MB por mensagem, com a barra de progresso no envio. Imagens aparecem no chat e abrem em tela cheia com Baixar; os outros arquivos viram um cartão com Baixar.
- Vídeos .mp4 e .webm tocam ali mesmo no chat, sem baixar antes.
- Prévia de links: a mensagem com um link ganha o cartão com o site, o título, a descrição e a imagem, YouTube incluído. O autor pode tirar a prévia pelo X, e um link entre < e > não ganha prévia.
- Encaminhar: mande uma mensagem, com os anexos, para outro canal ou conversa, com um comentário se quiser. Ela chega marcada como "Encaminhada", com quem escreveu e de onde veio.
- Mensagens fixadas: quem gerencia os canais fixa no canal, e numa conversa privada os dois podem fixar. A faixa embaixo do cabeçalho abre a lista, com Ir até a mensagem.
- Buscar: o campo no alto procura no canal aberto ou em todo o grupo, sem ligar para acentos, e acha também pelo nome dos arquivos. Os filtros de:, em: e tem:anexo, tem:link ou tem:imagem ajudam a afinar. Clique num resultado para ir até a mensagem.
- Mídia do canal: o botão no cabeçalho mostra as imagens, os vídeos e os arquivos que já passaram pelo canal ou pela conversa.
- Quem está fora da sala agora vê, na lista da sala, quem está mutado, com o áudio desligado, com a câmera ligada ou transmitindo.
- Câmera em foco: passe o mouse numa câmera na grade e clique no botão do canto para deixá-la grande, como uma transmissão. Na fileira de baixo, clicar numa câmera também foca.
- Com o áudio desligado, os sons da sala ficam calados também.
- Logs: ler os logs que chegaram agora dá para fazer no próprio app, sem baixar. Ver logs virou uma permissão, "Ver logs", que o dono pode dar a outras pessoas.
- Configurações › Aplicativo ganhou "Aceleração de hardware", para desligar o uso da placa de vídeo pela janela do Ashtar (pede para reiniciar). Em Voz e vídeo, "Codificar na placa de vídeo" pode ser desligado para a transmissão usar a CPU.
- No painel da transmissão, o atraso aparece em milissegundos inteiros, e Detalhes e Trocar fonte ficaram mais fáceis de ver.

## 0.6.0

- Configurações › Voz e vídeo ficou completa: o volume do microfone e o volume geral de saída (de 0 a 200%, por cima do volume de cada pessoa), Testar microfone, com o medidor, e as chaves de Supressão de ruído, Cancelamento de eco e Controle automático de ganho. Tudo vale no meio da chamada, sem sair da sala.
- Detecção de voz: abaixo da sensibilidade, o microfone manda silêncio, sem aparecer cortado para os outros. A sensibilidade automática acompanha o barulho de fundo; desligue o automático para arrastar a marca dourada.
- Pressionar para falar: escolha o modo em Voz e vídeo e o atalho em Configurações › Atalhos. Vale tecla do teclado ou botão lateral e do meio do mouse, e funciona com o jogo em foco, sem roubar a tecla dele. Em Notificações, dá para ligar um clique curto ao apertar e ao soltar.
- Atalhos globais em Configurações › Atalhos: Desativar microfone, Desativar áudio, Pressionar para falar, Atender ligação e Recusar ou desligar. Clique em Trocar e aperte a combinação; Esc cancela.
- Falou com o microfone mutado? O painel de voz avisa "Você está mutado". Dá para desligar em Voz e vídeo.
- A régua no alto de Configurações › Notificações ajusta o volume de todos os sons do Ashtar, sem mexer nas vozes.
- A voz volta sozinha: se a conexão cair, ou o computador voltar da suspensão, o painel mostra "Reconectando…" e o Ashtar entra de novo na mesma sala, com o mesmo mute.
- A transmissão também volta sozinha depois de uma queda, sem parar a captura. Quem transmite vê o aviso "Conexão perdida", e quem assiste vê "Reconectando a transmissão…" no lugar da imagem.
- Tirou o fone ou o microfone no meio da sala? O Ashtar passa para o padrão do Windows e avisa; quando ele volta, troca de volta. Sem nenhum microfone, você entra mutado, e quando um é conectado aparece "Ativar microfone".
- Sem conexão com o servidor por mais de 5 segundos, uma faixa no alto da janela mostra quando é a próxima tentativa, com Tentar agora. A sala de voz continua funcionando enquanto isso.
- Quem está com a conexão ruim ganha um ícone de sinal laranja (instável) ou vermelho (ruim) na sala. Clique na pessoa para ver o ping e a perda de pacotes dela.
- Testar conexão, em Voz e vídeo: mostra o ping até o servidor e se a voz vai pelo caminho direto ou pelo reserva, mais lento.
- Enviar logs, em Configurações › Aplicativo: manda os registros dos últimos 2 dias para o dono do servidor, com um campo para contar o que aconteceu. Só o dono vê.
- Para o dono, o Painel de controle ganhou Logs, para ver e baixar o que chegou (com aviso quando chega um), e Servidor, que mostra se a API e a voz estão no ar, o disco livre e o último backup.

## 0.5.0

- Várias salas de voz: quem gerencia os canais cria uma sala pelo mesmo "Criar canal", escolhendo Voz, e pode renomear e arquivar. A Sala de sempre continua lá e não pode ser arquivada.
- Para trocar de sala, é só clicar em outra. Se você estiver transmitindo ou com a câmera ligada, o Ashtar pergunta antes.
- Quem tem a nova permissão "Mover membros" (o dono sempre tem) pode levar alguém para outra sala, pelo "Mover para" no cartão da pessoa ou arrastando o nome dela de uma sala para outra. No mesmo cartão, "Desconectar da voz" tira a pessoa da sala. Quem foi movido ou desconectado vê um aviso dizendo quem fez.
- Canais e salas restritos: ao criar ou editar um canal ou uma sala, ligue Restrito e marque quem tem acesso. Quem está fora da lista nem vê o canal, e não recebe mensagens, menções nem avisos dele. O dono e quem gerencia os canais veem todos. Os restritos mostram um cadeado na lista.
- Quem perde o acesso a um canal aberto volta para o primeiro canal, com um aviso, e quem perde o acesso a uma sala sai dela.
- Status Ausente, com a lua amarela: escolha no seu avatar, no pé da coluna. Ele também liga sozinho depois de 10 minutos sem mexer no computador, e desliga quando você volta. Numa sala ou numa ligação, ninguém fica ausente sozinho.
- "Digitando…": aparece embaixo do campo de mensagem quando alguém está escrevendo no canal ou na conversa, e na aba Conversas. Em Invisível, ninguém vê que você está digitando.
- Sons da sala: tocam quando alguém entra ou sai da sua sala, quando você muta, desmuta, fica surdo ou volta, e quando alguém começa ou para de transmitir. Cada um tem a sua chave em Configurações › Notificações, com um botão para ouvir.

## 0.4.0

- Várias pessoas podem transmitir a tela ao mesmo tempo na sala, até 6. Clique em Assistir em cada transmissão que quiser ver: duas ficam lado a lado, três ou quatro dividem a tela, e com mais elas vão para uma fileira embaixo.
- Focar deixa uma transmissão grande e as outras pequenas embaixo; clique numa pequena para trocar. Clicar de novo em Focar volta a dividir.
- Cada transmissão tem o seu volume, de 0 a 200%, e a sua qualidade: Automática ou Leve, para quando a internet aperta. As duas ficam guardadas para a próxima vez que a mesma pessoa transmitir.
- Passe o mouse numa transmissão para ver quem está assistindo.
- Quando alguém começa a transmitir com você na sala, aparece um aviso no canto, com Assistir.
- Na transmissão em foco: gire a roda do mouse para ampliar até 4× e arraste para andar pela imagem (duplo clique volta). O ícone de sinal mostra como ela está chegando para você, e o botão de copiar põe a imagem daquele instante na área de transferência, para colar onde quiser.
- Saindo da sala com várias abertas, a miniatura mostra uma de cada vez, com setas para trocar.
- Câmera: o botão novo na barra da sala, entre Áudio e Tela. A setinha abre a prévia, que só você vê, com a câmera, a qualidade (480p, 720p ou 1080p) e Espelhar. Os mesmos ajustes estão em Configurações › Voz e vídeo.
- A câmera aparece no lugar do seu avatar, na sala e na ligação. Transmitindo com ela ligada, ela aparece no canto da sua transmissão. Ela sempre começa desligada.
- O "O que há de novo" agora mostra todas as versões que você pulou, não só a última.
- A lista de quem está na sala volta a atualizar na hora para quem está fora dela.

## 0.3.21

- Ligações privadas: abra uma conversa e clique no telefone, no alto da janela, ou em Ligar, no cartão da pessoa. A ligação é só entre vocês dois, e ninguém mais no servidor fica sabendo. Para quem está offline, o botão fica apagado.
- Quando alguém liga, um cartão aparece no canto da tela, mesmo com o Ashtar na bandeja, com um toque que se repete até você responder. Dá para Recusar, Atender ou Responder com mensagem. Sem resposta em 30 segundos, vira chamada perdida.
- Estando numa sala, o toque é mais baixo e o botão vira "Sair e atender": você sai da sala e entra na ligação. Quando ela acaba, a conversa mostra "Voltar para a sala", e um clique leva de volta. Antes de você ligar, o Ashtar avisa que você vai sair da sala, e dá para desligar esse aviso em Configurações › Voz e vídeo.
- A ligação usa a mesma tela da sala: a grade, o Foco, o volume da outra pessoa e a tela compartilhada, de qualquer um dos dois. O alto mostra "Ligação com fulano" e o tempo, e o painel de voz diz "Em ligação", com Desligar.
- Entrar numa sala durante a ligação pergunta antes, porque a ligação acaba.
- A lateral mostra a ligação no topo: o avatar com o anel dourado enquanto toca ou durante a ligação, e o telefone vermelho numa chamada perdida, com "Ligar de volta".
- O histórico da conversa guarda cada ligação: "Ligação encerrada" com a duração, "Chamada perdida", "Ligação recusada" ou "Ligação cancelada", com o botão para ligar de novo. A chamada perdida conta como não lida.
- Em Ocupado, a ligação não toca nem mostra o cartão: aparece só o avatar na lateral e, na conversa, Recusar e Atender.
- Conversas privadas: clique em alguém e em Mensagem, ou abra a aba Conversas na lateral direita. A conversa abre numa janela embaixo, e dá para deixar várias abertas como abas. Só vocês dois leem, mas as mensagens não são criptografadas de ponta a ponta: quem administra o servidor consegue ler.
- A lateral direita ganhou as abas Membros e Conversas, e pode ser minimizada.
- Não lidas: as conversas mostram quantas mensagens novas chegaram, os canais ficam em destaque, e a linha "Novas mensagens" marca onde você parou. O menu do canal tem "Marcar como lido", e o nome do servidor, "Marcar tudo como lido".
- Menções: escreva @ e o começo do nick para escolher a pessoa. Quem foi mencionado vê a mensagem em dourado e um número separado.
- Silenciar: no menu de um canal ou de uma conversa. Silenciado, nada avisa nem conta, a não ser uma menção.
- Notificações: com o Ashtar atrás de outra janela ou na bandeja, uma mensagem privada ou menção aparece num aviso no canto da tela, com um som curto. Clique para abrir. Também avisa quando alguém começa a transmitir. Ajuste em Configurações › Notificações, onde dá para testar.
- O ícone da bandeja e o da barra de tarefas ganham uma bolinha vermelha enquanto houver mensagem privada ou menção não lida.
- Status: clique no seu avatar, no pé da coluna, e escolha Disponível, Ocupado ou Invisível. Ocupado aparece com a bolinha vermelha e cala todos os avisos. Invisível faz você aparecer offline, mas usar tudo normalmente.
- Iniciar com o Windows: em Configurações › Aplicativo. O Ashtar abre junto com o computador, direto na bandeja, e já recebe as mensagens.
- A lista de canais ficou mais limpa. As ferramentas só aparecem quando você passa o mouse: a engrenagem no canal e o + na categoria. O botão direito abre o mesmo menu.
- O nome do servidor, no alto da coluna, virou o menu de quem gerencia os canais: criar canal, criar categoria, organizar e ver os arquivados. Para o dono, também Convidar pessoas.
- Organizar canais: arrastar agora é num modo próprio. Arrume tudo com calma, e só o Concluir grava, de uma vez. Desfazer volta a lista como estava. Fora do modo, nada se arrasta sem querer.
- "Mover para", no menu do canal, leva o canal para outra categoria sem arrastar.
- Clique em qualquer pessoa, na lista de membros ou na lista da sala, para abrir o cartão dela.
- Volume por pessoa: na sala, clique no bloco de alguém (ou abra o cartão) e ajuste a voz dela de 0 a 200%, ou silencie só para você. Só você ouve a diferença, e o ajuste fica guardado neste computador.
- O tempo da ligação, na lateral e na conversa, começa do zero ao atender.

## 0.2.41

- O Ashtar ganhou servidor próprio: a voz e as transmissões passam por ele, e o app fala com o novo endereço. Nada muda no uso, e acaba o limite mensal que fazia a chamada parar de conectar.
- Quem assiste uma transmissão passa a ver a qualidade nova assim que quem transmite troca.

## 0.2.40

- A transmissão de tela ficou muito mais leve: a imagem agora é capturada e codificada pela placa de vídeo, e o app a envia direto, sem passar pela interface. Dá para transmitir 1080p a 60 fps sem pesar no computador, mesmo com um monitor grande. Sem encoder na placa, o processador entra sozinho, e o painel avisa.
- Monitores de 144 Hz transmitem a 60 fps, e não mais a 48.
- O seletor de fontes mostra todas as janelas, inclusive as minimizadas, e cada uma aparece ao vivo, em miniatura. Ao escolher, a janela vem para a frente, e o Ashtar sai da frente. A janela do Ashtar não aparece na transmissão.
- Ajuste a transmissão sem parar: com ela no ar, o botão Tela abre a qualidade (Leve, Movimento ou Nitidez), o áudio, o cursor, trocar de fonte e pausar. "Detalhes" abre o painel completo, com a saúde da transmissão, os números, o envio do último minuto, quem está assistindo e há quanto tempo.
- A bandeja do Windows ganhou "Abrir o painel", "Pausar" ou "Continuar" e "Parar de transmitir" durante a transmissão.
- O som da transmissão chega mais perto da voz: o app nivela o volume do jogo antes de enviar (chave "Nivelar o volume", ligada por padrão), e quem assiste pode subir o volume até 200%.
- A miniatura de quem assiste tem seis encaixes (os cantos e o meio de cada lado), mostra onde vai encaixar enquanto você arrasta e pode ser recolhida numa aba na lateral, com o som seguindo.

## 0.2.30

- Chat de texto: converse nos canais do servidor, com o histórico guardado. As mensagens chegam na hora, os links abrem no navegador, o que você começou a escrever fica guardado em cada canal, e uma mensagem que não saiu tem "Tentar de novo".
- A lista de membros mostra quem está online, com o dono em cima, e a lista da sala e os avisos de quem entrou chegam sem demora.
- Canais e categorias: quem tem a permissão "Gerenciar canais" cria, edita (nome e tópico), arrasta e arquiva canais e categorias, e desarquiva em Configurações › Servidor › Arquivados. O dono liga essa permissão em Membros, no Painel.
- O app abre no último canal que você estava lendo, e cada um recolhe as categorias que quiser.
- Quem assiste a uma transmissão e sai da sala continua vendo numa miniatura, que você arrasta para o canto que preferir. Ela some nas configurações.
- Supressão de ruído no microfone (teclado, ventilador, o jogo ao fundo), ligada por padrão. Dá para desligar em Configurações › Voz e vídeo, na hora, mesmo no meio da chamada.
- Painel de controle (só para o dono): em Convites, crie convites para uma pessoa, para o grupo ou do seu jeito, copie o link e veja o histórico, com Revogar. Em Membros, veja quem está no grupo, ligue o beta de cada um, crie um convite de recuperação, desvincule o computador ou remova alguém.
- O dono recebe um aviso quando alguém entra no grupo.
- Quem é removido do grupo ou tem o computador desvinculado sai da sala na hora.

## 0.2.21

- Em Configurações › Voz e vídeo, escolha o microfone e a saída de áudio. A troca vale na hora, mesmo no meio da chamada, e um aparelho desconectado cai no padrão do Windows até voltar.
- Ficar sem áudio (ensurdecer) agora cala só as vozes: o som de uma transmissão que você está assistindo segue no volume que você escolheu.
- Clicar na sala, na coluna da esquerda, entra na chamada.
- Configurações novas: em Perfil você troca o nome que o grupo vê, e o nick continua o mesmo.
- Em Aplicativo: a versão, o canal (beta ou estável), Procurar atualização, "O que há de novo" e o botão que abre a pasta de logs.
- O aviso de atualização ganhou a cara nova. Numa chamada, ele pergunta antes de reiniciar.
- O beta agora é por pessoa: o dono escolhe quem recebe as versões beta antes do grupo.

## 0.2.20

- Visual novo do começo ao fim, com barra de título própria e avisos no canto da tela.
- Agora cada um tem a sua conta, ligada ao computador. Você entra uma vez pelo link de convite, escolhe o seu nick e, daí em diante, o app abre já conectado.
- O link do convite abre o Ashtar direto, e abrir o app de novo traz a janela que já está aberta. Também dá para colar o link ou o código.
- Trocou de computador? Com um link de recuperação, a sua conta volta com o mesmo nick.
- Se este computador sair do grupo, o app explica o que houve em vez de dar erro.
- A tela do servidor mostra quem está na sala antes de você entrar.
- Na sala, cada um aparece com o seu nome, e dá para ver quem está falando, quem está sem microfone e quem desligou o áudio. "Assistir transmissão" põe a tela de quem transmite em destaque.
- Assistindo uma transmissão, o som dela tem um controle de volume próprio, de 0 a 100%, e o app lembra o volume escolhido.
- Uma transmissão por vez: com alguém transmitindo, o botão Tela mostra quem é e leva até a transmissão. Se duas pessoas começarem juntas, continua quem começou antes.
- O seletor de tela separa janelas e telas e desenha os monitores na posição do Windows.
- Se a janela compartilhada fechar ou o som dela parar, um aviso conta o que houve e oferece o próximo passo.
- O microfone liga sozinho ao entrar na sala, sem pedir permissão.

## 0.2.0

- O app agora se atualiza sozinho. Esta é a última vez que você precisa baixar um instalador.
- Novo nome: Ashtar. Pode apagar o executável antigo.
- Quando algo der errado, o app guarda um registro que ajuda a descobrir o motivo.
