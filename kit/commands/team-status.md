---
description: Mostra o estado atual da task do time (agentes, issues, pedidos de permissão, rodada)
argument-hint: [TASK-ID opcional]
---

A pasta do time deste projeto fica fora do repositório: rode `node "<KIT_DIR>/hooks/team-dir.mjs"` pra saber o caminho e use-o como `<TEAM_DIR>`.

Mostre o status da task do time. Somente leitura: não edite nada.

1. Task: use `$ARGUMENTS` se vier preenchido; senão leia `<TEAM_DIR>/ACTIVE`. Se não houver task ativa, diga isso e liste as pastas em `<TEAM_DIR>/tasks/` (mais recentes primeiro).
2. Leia o frontmatter de:
   - `spec.md` (título, tamanho, time, status do spec);
   - cada `status/*.md`;
   - cada `issues/*.md`;
   - cada `requests/*.md`;
   - as últimas 10 linhas de `guard.log`, se existir;
   - `<TEAM_DIR>/roster.json` (membros ativos e desligados).
3. Responda neste formato, curto:

**<TASK-ID> — <título>** · tamanho <S/M/L/XL> · spec <draft/approved> · rodada <maior round entre os status>

| Membro (id) | Papel | Escopo | Estado | Rodada | Rating | Feitas/Reabertas |
|---|---|---|---|---|---|---|

**Pedidos de permissão abertos** (destaque os `blocking: true` primeiro): ID · de · tipo · o que precisa.

**Issues abertas** por severidade: P0 x · P1 y · P2 z, e a lista de P0/P1 (ID · de → para · título).

**Bloqueios recentes do guard** (se houver).

**Próximo passo:** uma linha dizendo o que falta pra fechar a task.

<!-- agent-office: instalado pelo escritório; atualizado pelo setup -->
