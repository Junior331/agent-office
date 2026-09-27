---
description: Decide um pedido de permissão (REQ) de um agente do time — aprova, nega ou responde
argument-hint: <REQ-ID> <aprovar|negar|responder> [escopo ou resposta]
---

A pasta do time deste projeto fica fora do repositório: rode `node "<KIT_DIR>/hooks/team-dir.mjs"` pra saber o caminho e use-o como `<TEAM_DIR>`.

O usuário está decidindo um pedido de permissão do time. Você é o líder.

Entrada: `$ARGUMENTS`

1. Descubra a task por `<TEAM_DIR>/ACTIVE` e abra `requests/<REQ-ID>.md`. Se não existir, diga isso e liste os REQs abertos.
2. Mostre em 4 linhas o que o REQ pede (quem, o quê, por quê, impacto) pra confirmar que é esse mesmo.
3. Conforme a decisão:
   - **aprovar**: defina o escopo mínimo. Se o usuário passou escopo, use exatamente ele; se não passou, proponha o mínimo que atende o REQ e confirme com o usuário antes de gravar.
     - Atualize o REQ: `status: approved`, `decided_by: user`, `decided_at`, seção **Decisão** com o escopo exato, e uma linha no **Histórico**.
     - Se envolve arquivo ou comando, adicione em `grants.json`:
       `{ "req", "role", "write_allow": [...], "read_allow": [...], "bash_allow": [regex específica], "reason", "approved_by": "user", "date" }`.
       Nunca use `**` sozinho nem `.*` como regex.
   - **negar**: `status: denied`, motivo na seção **Decisão**, linha no histórico.
   - **responder** (para `type: decision`): `status: answered`, resposta na seção **Decisão**; se mudar comportamento, registre também na seção 9 do `spec.md`.
4. Se o agente dono do REQ estava `blocked` por ele, redispare esse agente citando o REQ decidido e o que ele deve fazer agora.
5. Quando o agente terminar o passo que dependia do grant, remova o item de `grants.json`.

<!-- agent-office: instalado pelo escritório; atualizado pelo setup -->
