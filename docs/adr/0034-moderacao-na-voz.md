# 0034 — Moderação na voz e registro

- **Status:** proposta (passa a aceita com o teste de três computadores da Etapa 10 da v0.8)
- **Data:** 2026-11

## Contexto

O cartão do usuário tem "Mover para outra sala" e "Desconectar da voz" desde a v0.5 (ADR 0026). Silenciar e deixar
surdo para todos ficaram para a v0.8 (BACKLOG), e o roadmap pedia encerrar a transmissão de alguém. A tela de
administração do roadmap já existe no Painel de controle (convites, membros, permissões); faltava um histórico do que
foi feito. Decidido com o Kid em 22/11 (quadros "Moderação — na voz" e "Painel de controle — registro").

## Decisão

**Uma permissão nova, "Moderar voz"** (`voz.moderar`), que o dono dá em Membros. Cobre silenciar o microfone, deixar
surdo, desligar a câmera e encerrar a transmissão. Vale só nas salas de voz do grupo; nas ligações privadas a API
recusa. Ninguém modera o dono, nem a si mesmo.

**Silenciar e deixar surdo são estados**, numa tabela `voice_moderation`, que valem em todas as salas até alguém
liberar. **O LiveKit garante**: silenciado, a API tira `MICROPHONE` das fontes que a pessoa pode publicar
(`update_participant`); surdo, `can_subscribe` passa a falso; o token de voz já sai com essas restrições.
**Desligar a câmera** (`mute_published_track`) e **encerrar a transmissão** (`remove_participant` da identidade
`{id}:screen`) são de uma vez só; o evento `voice.moderated` avisa o app da pessoa para desligar a câmera e para não
reconectar a transmissão.

**No app**, o mute fica vermelho em todo lugar, e o da moderação ganha um escudo. Quem foi silenciado não recebe aviso:
o botão de microfone fica vermelho com o escudo e não responde ao clique, ao atalho nem ao Pressionar para falar. Quem
teve a câmera desligada ou a transmissão encerrada recebe um aviso.

**O registro** (`audit_log`) guarda toda ação de moderação e de administração (voz, membros, convites, canais), com
quem fez, o quê, em quem e onde, gravado na mesma transação da ação, inclusive as do dono. Só o dono vê, em Painel de
controle › Registro, com filtros por tipo. Guarda 1 ano.

## Consequências

- O app antigo não entende o `voice.moderated` nem o escudo, mas o LiveKit trava o microfone dele mesmo assim. O
  `MIN_CLIENT_VERSION` sobe para `0.8.0` quando ela chegar ao estável.
- Se o LiveKit recusar a mudança de permissão, a API devolve erro e não grava o estado.
- A volta automática da transmissão (ADR 0030) passa a distinguir a queda da rede do encerramento pelo moderador.
