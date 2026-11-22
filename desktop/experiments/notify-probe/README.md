# notify-probe — Etapa 6 da v0.3

Um app Tauri mínimo que responde, no Windows de quem roda, o que as Etapas 15 (notificações) e 16 (iniciar
com o Windows) precisam saber antes de serem escritas. Fica fora da entrega, como o `encoder-probe`.

**Tem de ser instalado pelo instalador.** A notificação do Windows usa o registro do app (o identificador
`com.gustavo99g.ashtar.notifyprobe`): em `tauri dev` ela sai sem o nome e o ícone, ou nem sai, e o teste não
vale.

## Como gerar e instalar

Nesta pasta:

```powershell
pnpm install
pnpm tauri build
```

O instalador sai em `src-tauri\target\release\bundle\nsis\`. Instale, abra pelo menu Iniciar e deixe o app
aberto. Fechar a janela esconde na bandeja; o "Sair" é pelo botão direito no ícone da bandeja.

Tudo o que acontece vai para a caixa "Registro" da janela e para o arquivo
`%APPDATA%\com.gustavo99g.ashtar.notifyprobe\probe.log`. É pelo arquivo que se vê o que chegou com a janela
escondida.

## O roteiro

Rode no Windows 11 e, se tiver uma máquina, no Windows 10. Os avisos saem 8 segundos depois do clique, para
dar tempo de fechar a janela.

**1. Notificação do plugin.** Clique em "Pedir permissão" e depois em "Notificar em 8 s (plugin)". Feche a
janela (vai para a bandeja) e espere.

- O aviso apareceu com a janela na bandeja?
- Com o nome "Ashtar Notify Probe" e o ícone do Ashtar?
- Clique no aviso. O que o registro mostra? (`janela: foco = true`, `segunda abertura do app`, ou nada.)

**2 e 3. Clique e botões.** "Notificar em 8 s: conversa A", feche a janela, espere, clique no corpo do aviso.
Repita com a conversa B e clique no botão "Responder". Depois deixe um aviso sumir sozinho e clique nele na
central de notificações do Windows.

- O registro mostra `winrt: clique na conversa A, botão None`? E `conversa B, botão Some("reply")`?
- A janela voltou para a frente?
- O clique pela central de notificações, minutos depois, ainda chega?

**4. Ponto de não lido.** "Ligar" e olhe a bandeja e a barra de tarefas.

- O ícone da bandeja ganhou a bolinha vermelha? Dá para ver no tamanho real?
- O ícone da barra de tarefas ganhou o selo? E com a janela escondida na bandeja (aí não há ícone na barra)?
- "Desligar" tira os dois?

**5. Iniciar com o Windows.** "Ligar", saia do app pela bandeja e reinicie o computador (ou saia da conta e
entre de novo).

- O app subiu sozinho? Direto na bandeja, sem a janela piscar?
- O `probe.log` mostra `início: … argumentos ["--autostart"]`?
- Em Configurações › Aplicativos › Inicialização, o app aparece? Desligar por lá e ligar de novo funciona?
- Instale o instalador de novo por cima (é o que um auto-update faz) e reinicie: continua subindo?

**6. Som com a janela escondida.** "Tocar agora" (para ouvir o bipe e criar o áudio). Depois "Tocar em 12
min", feche a janela e não mexa no app.

- O bipe tocou aos 12 minutos?
- O que o registro diz na linha `som (pedido pelo Rust)`: `contexto suspended -> running` ou ficou
  `suspended`? E `document.hidden`?

**7. Modo de foco e tela cheia.** Repita o 1 e o 2 com o "Não incomodar" do Windows ligado, e de novo com um
jogo em tela cheia na frente.

- Em cada caso: o aviso aparece, vai direto para a central, ou some? O som do aviso toca?

**Plano B. Aviso próprio.** "Mostrar em 8 s", e nesses 8 segundos clique em outra janela (um bloco de notas)
e comece a digitar.

- A janelinha apareceu no canto de baixo à direita, por cima de tudo?
- O que você estava digitando continuou indo para o bloco de notas (ela não roubou o foco)?
- Aparece por cima de um jogo em tela cheia sem borda? E em tela cheia exclusiva?
- Clicar nela traz a janela principal?

## Respostas

Preencha e copie a conclusão para a ADR 0022.

| Pergunta | Windows 11 | Windows 10 |
|---|---|---|
| 1. O aviso do plugin aparece com a janela na bandeja | Sim (`show()` devolveu Ok) | não rodado |
| 1. Sai com o nome e o ícone do app | não conferido | não rodado |
| 1. O clique no aviso do plugin chega ao app | Parece que só traz a janela (o registro mostra o foco voltando), sem dizer qual; não confirmado | não rodado |
| 2. O clique no aviso WinRT chega, dizendo a conversa | Sim: `conversa A, botão None` | não rodado |
| 2. O clique pela central de notificações chega | não testado | não rodado |
| 3. Os botões chegam, dizendo qual | Sim: `botão Some("reply")` | não rodado |
| 4. Bolinha na bandeja | Sim | não rodado |
| 4. Selo na barra de tarefas | Sim | não rodado |
| 5. Sobe com o Windows, na bandeja, sem piscar | não testado (falta reiniciar) | não rodado |
| 5. Continua depois de reinstalar por cima | não testado | não rodado |
| 6. Som aos 12 minutos com a janela escondida | não testado ("Tocar agora" funciona) | não rodado |
| 7. Com "Não incomodar" | Os avisos do Windows não aparecem e não ficaram na central | não rodado |
| 7. Com jogo em tela cheia | não testado | não rodado |
| B. Aviso próprio aparece sem roubar o foco | Sim | não rodado |
| B. Aviso próprio com "Não incomodar" | Continua aparecendo (o Windows não sabe que é um aviso) | não rodado |
| B. Aviso próprio por cima de jogo em tela cheia | não testado | não rodado |

**Conclusão (qual caminho a Etapa 15 usa):** o aviso próprio. As duas formas funcionaram, e o grupo preferiu
a janela do Ashtar: tem a cara do app, empilha até três cartões (o mais novo tira o mais antigo) e não rouba
o foco. Como ela não respeita o "Não incomodar" sozinha, o app pergunta ao Windows antes de mostrar
(`SHQueryUserNotificationState`) e segura o aviso em tela cheia, apresentação e tela bloqueada; para o resto,
existe o status Ocupado. O som toca na própria janela dos avisos, que está à vista nessa hora, o que contorna
a dúvida do som com a janela principal escondida. A bandeja e o selo funcionaram como esperado. Ficam para
conferir no roteiro da `0.3.10` (Etapa 17): o reinício com o iniciar com o Windows e o aviso com um jogo em
tela cheia. Detalhes na ADR 0022.

## A ligação recebida (Etapa 18)

A Etapa 18 pedia este mesmo experimento para a ligação. As respostas que ela precisa já estão na tabela acima:

- **A notificação do Windows aceita botões e eles chegam ao app** (pergunta 3), com a janela escondida na
  bandeja. Mas com o "Não incomodar" ela não aparece nem fica na central (pergunta 7): uma ligação perdida sem
  aviso nenhum.
- **A janela própria aparece sem roubar o foco** (plano B) e continua aparecendo com o "Não incomodar".

**Conclusão:** a ligação recebida usa a janela dos avisos da Etapa 15, com um cartão próprio no topo da pilha
(Recusar, Atender e Responder com mensagem), e o toque em repetição sai dessa janela, que está à vista enquanto
toca. Não foi preciso uma segunda janela `incoming-call`. Fica para o roteiro da `0.3.20` (Etapa 23): o cartão
por cima de um jogo em tela cheia sem borda, e o toque com a tela cheia exclusiva. Detalhes na ADR 0023.

## O que eu espero, antes de rodar

Escrito sem ter rodado, só pelo que as bibliotecas dizem. É para comparar com o que der.

- O plugin de notificação, no computador, não avisa o app do clique: os "actions" dele são só do celular.
  Por isso o experimento também usa a API do Windows direto (`tauri-winrt-notification`, a mesma biblioteca
  que o plugin usa por baixo), que tem `on_activated` e botões.
- O `on_activated` só existe enquanto o processo está vivo. O app fica na bandeja, então isso deve bastar; o
  clique pela central de notificações, bem depois, é a parte incerta.
- O selo da barra de tarefas (`set_overlay_icon`) é de janela: com a janela escondida na bandeja não há onde
  pôr. O ícone da bandeja com a bolinha deve ser o que vale nesse caso.
- O som é a maior dúvida: o WebView2 pode suspender o áudio de uma janela escondida há muito tempo.
