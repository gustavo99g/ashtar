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
| 1. O aviso do plugin aparece com a janela na bandeja | | |
| 1. Sai com o nome e o ícone do app | | |
| 1. O clique no aviso do plugin chega ao app | | |
| 2. O clique no aviso WinRT chega, dizendo a conversa | | |
| 2. O clique pela central de notificações chega | | |
| 3. Os botões chegam, dizendo qual | | |
| 4. Bolinha na bandeja | | |
| 4. Selo na barra de tarefas | | |
| 5. Sobe com o Windows, na bandeja, sem piscar | | |
| 5. Continua depois de reinstalar por cima | | |
| 6. Som aos 12 minutos com a janela escondida | | |
| 7. Com "Não incomodar" | | |
| 7. Com jogo em tela cheia | | |
| B. Aviso próprio aparece sem roubar o foco | | |
| B. Aviso próprio por cima de jogo em tela cheia | | |

**Conclusão (qual caminho a Etapa 15 usa):**

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
