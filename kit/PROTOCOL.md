# Protocolo do Time de Agentes

> **Caminhos.** `<KIT_DIR>` é a pasta do kit instalada no usuário. `<TEAM_DIR>` é a pasta com os dados do time **deste projeto**, fora do repositório; o contexto da sessão informa o caminho real (linha `TEAM_DIR = …`) e `node "<KIT_DIR>/hooks/team-dir.mjs"` o imprime. Nada do time fica dentro do projeto. O líder sempre passa o `TEAM_DIR` real pros agentes que dispara.

Este documento é a fonte única de verdade de como o time trabalha. Todo agente (líder, front, QA, designer, back) lê este arquivo inteiro antes de qualquer ação em uma task. Em caso de conflito entre este protocolo e qualquer outra instrução de agente, vale este protocolo; em caso de conflito com uma instrução direta do usuário, vale o usuário, e o líder registra a exceção no `spec.md`.

---

## 0. Regra primordial: monitoramento

1. Nenhuma task começa sem o escritório de monitoramento (`claude-office`) rodando.
2. Verificação obrigatória na fase 0, feita pelo líder:
   ```bash
   curl -s -m 2 http://localhost:4000/health
   ```
   Resposta esperada: JSON com `"ok": true`.
3. O escritório sobe sozinho a cada evento do Claude Code. Se mesmo assim não responder, o líder **para tudo** e pede ao usuário pra abrir o app do escritório (ou rodar `npm start` na pasta dele), e espera.
4. Só é permitido seguir sem monitor com autorização explícita do usuário na conversa. O líder registra no `spec.md` (`monitor: waived` + motivo + data).
5. O monitor lê os arquivos da task (`status/`, `issues/`, `requests/`). Por isso **toda comunicação entre agentes passa por arquivo**. Combinado que não está em arquivo não existe.

---

## 1. Papéis

| Papel | Quem | É dono de | Pode editar | Nunca faz |
|---|---|---|---|---|
| **Líder** | sessão principal do Claude Code | spec, orquestração, gates, commits, decisões | tudo, mas só implementa feature com aprovação do usuário | aprovar sozinho pedido sensível (seção 6.5), pular gate |
| **Front** | subagente `frontend` | UI, estados, services de integração, testes unitários do front | código do app, exceto E2E e back-end | editar E2E, editar back-end, commitar |
| **QA** | subagente `qa` | regras de negócio, fluxos, suíte E2E | pastas de E2E e arquivos da task | corrigir código do app, commitar |
| **Designer** | subagente `designer` | fidelidade visual, UX, acessibilidade visual | somente arquivos da task | editar qualquer código, commitar |
| **Back** | subagente `backend` | contrato de API e integração | arquivos da task; código do back-end **só** no modo `same-repo` | editar front, mutar produção, commitar |

Prefixos de ID por papel: `LD` (líder), `FE` (front), `QA`, `DS` (designer), `BE` (back).

### 1.1 Modo do back-end

Definido em `<TEAM_DIR>/permissions.json` (`backend_mode`) e repetido no `spec.md`:

- `external` (padrão): a API é de outro time ou repositório. O Back **valida e reporta**. Não edita back-end.
- `same-repo`: o back-end está neste repositório (caminhos em `paths.backend`). O Back pode corrigir o back-end dentro desses caminhos, com testes, e avisa o Front se o contrato mudar.

---

## 2. Tamanho do time

O líder classifica a task na fase 1 e registra no `spec.md` (`size`, `team`).

| Tamanho | Exemplo | Time |
|---|---|---|
| **S** | texto, cor, ajuste pontual sem regra nova | Front + QA (QA roda só regressão afetada) |
| **M** | tela ou componente novo sem integração nova | Front + Designer + QA |
| **L** | fluxo com integração de API | Front + Designer + Back + QA |
| **XL** | feature nova multi-tela ou regra de negócio complexa | time completo, rodadas obrigatórias de todos |

Regras:
- Mudou algo visível → Designer entra.
- Mudou ou criou chamada de API → Back entra.
- QA **sempre** entra.
- Em dúvida, sobe um tamanho.

---

## 3. Estrutura de arquivos

```
<KIT_DIR>/PROTOCOL.md          ← este arquivo (instalado uma vez pro usuário)
<KIT_DIR>/templates/           ← modelos de cada arquivo
<TEAM_DIR>/                    ← dados do time DESTE projeto, fora do repositório
  permissions.json            ← matriz de permissões (só o usuário/líder edita)
  roster.json                 ← quadro de funcionários do projeto (só o líder edita; seção 11)
  usage.json                  ← consumo de tokens por membro, escrito pelo escritório (ninguém edita)
  efficiency.md               ← lições de economia de tokens (só o líder edita; seção 13)
  ACTIVE                      ← id da task ativa (uma linha)
  <KIT_DIR>/templates/                 ← modelos de cada arquivo
  tasks/<TASK-ID>/
    spec.md                   ← escopo, critérios, regras, fontes de design, ambiente
    status/<membro>.md        ← estado atual de cada membro da equipe (cada um edita só o seu)
    issues/ISS-<PAPEL>-NNN.md ← um arquivo por issue
    requests/REQ-<PAPEL>-NNN.md ← um arquivo por pedido de permissão
    reports/<papel>-r<N>.md   ← relatório de cada rodada
    evidence/<papel>/         ← prints, diffs visuais, request/response, logs
    design/                   ← prints e referências de design recebidos
    grants.json               ← permissões temporárias concedidas (só o líder edita)
    inbox.jsonl               ← mensagens que o usuário mandou pelo escritório (ninguém edita)
    replies/MSG-<id>.md       ← resposta de quem recebeu a mensagem (aparece no escritório)
    reviews/<avaliador>__<avaliado>__r<N>.json ← avaliações de desempenho (seção 12)
    learnings.md              ← aprendizados da task
    report.md                 ← relatório final do líder
```

- `TASK-ID`: `AAAAMMDD-slug-curto` (ex.: `20260923-checkout-cupom`).
- Numeração `NNN` por **membro** e por task, com 3 dígitos, usando o `prefix` do membro no roster (`ISS-FE1-001`, `REQ-QA2-003`). Como cada membro numera a própria série, nunca há colisão entre agentes em paralelo, mesmo com vários do mesmo papel.
- Em `from`/`to` de issues e REQs, use o **id do membro** (`fe-dados-1`). Use o papel (`frontend`) só quando ainda não há membro definido pra aquilo; o líder atribui depois.
- Um arquivo por issue e por pedido. Isso evita dois agentes editando o mesmo arquivo ao mesmo tempo.
- Todo arquivo começa com frontmatter YAML simples (`chave: valor`, uma por linha). O monitor depende disso, então nunca remova o frontmatter.

---

## 4. Ciclo da task

### Fase 0 — Pré-voo (líder)
1. Checa o monitor (seção 0).
2. Checa `git status`. Se houver alteração não commitada que não é da task, pergunta ao usuário antes de seguir.
3. Cria a branch `feat/<slug>` ou `fix/<slug>` a partir da branch base informada (padrão: a atual).
4. Cria `tasks/<TASK-ID>/` a partir de `<KIT_DIR>/templates/`, grava o id em `<TEAM_DIR>/ACTIVE`.

### Fase 1 — Spec (líder, somente leitura no código) → **GATE 1**
1. Lê `CLAUDE.md`, a estrutura do projeto, os componentes e services parecidos, a suíte E2E existente e o contrato da API (OpenAPI/Swagger, se houver).
2. Escreve o `spec.md` completo: objetivo, fora de escopo, critérios de aceite (`AC-n`), regras de negócio (`RN-n`), fontes de design, contrato de API, ambiente (URL do app, comando de start, ambientes de API e se aceitam mutação), usuários de teste, tamanho e time.
3. Toda ambiguidade vira pergunta ao usuário **antes** do gate. Nada de "assumi que".
4. **GATE 1:** mostra ao usuário um resumo do spec (ACs, RNs, time, riscos) e espera aprovação explícita. Sem aprovação, nada é implementado.

### Fase 2 — Implementação (Front)
1. O líder dispara o `frontend` com o caminho do spec.
2. O Front implementa, roda lint, typecheck, testes unitários e build, e entrega o relatório `reports/frontend-r1.md`.

### Fase 3 — Revisão paralela (Designer, Back, QA)
1. O líder dispara os revisores do time **em paralelo** (várias chamadas de subagente na mesma mensagem).
2. Cada revisor abre issues em `issues/` e escreve `reports/<papel>-r<N>.md`.
3. O QA pode começar a escrever os E2E a partir dos ACs já na fase 2, em paralelo ao Front, se o líder decidir.

### Fase 4 — Correção (até 3 rodadas)
1. O líder consolida as issues abertas e dispara o Front com a lista (P0 primeiro, depois P1).
2. O Front corrige e marca cada issue `fixed` com a descrição da correção.
3. O líder dispara de novo **só** os revisores que têm issue `fixed` pra verificar, mais o QA pra regressão.
4. Quem abriu a issue é o único que fecha (`closed`) ou reabre (`reopened`).
5. Limite: 3 rodadas de correção. Na 4ª, o líder escala ao usuário com o resumo do que travou.

### Fase 5 — Fechamento → **GATE 2**
1. Critério de saída: zero P0 e zero P1 abertos, todos os ACs com teste E2E passando, lint/typecheck/build ok.
2. P2 aberto vira backlog listado no `report.md` (não bloqueia).
3. O líder escreve o `report.md` (seção 8) e mostra ao usuário.
4. **GATE 2:** com aprovação explícita, o líder faz commits atômicos no padrão Conventional Commits (um por unidade lógica, nunca "wip"). Push só se o usuário pedir.

### Fase 6 — Aprendizados
1. Cada agente registra no `learnings.md` da task o que surpreendeu, o que deu errado e o que funcionou.
2. O líder promove o que for reutilizável para `.claude/memory/learnings.md` e, se virar regra, para o `CLAUDE.md`.
3. O líder limpa `<TEAM_DIR>/ACTIVE`.

---

## 5. Issues

### 5.1 Severidade

| Nível | Definição | Exemplos |
|---|---|---|
| **P0** | Bloqueia o fluxo principal, perde dado, quebra segurança, crasha, ou contrato de API errado a ponto de não funcionar | botão de salvar não salva; token no console; tela branca; payload com campo errado |
| **P1** | AC ou RN não atendido, divergência visual perceptível, estado faltando, erro mal tratado | falta estado vazio; fonte 14 no lugar de 16; erro 422 mostra "algo deu errado"; teste E2E faltando pra um AC |
| **P2** | Polimento que não afeta o uso nem a regra | 1px de diferença; nome de variável; sugestão de refatoração |

P0 e P1 bloqueiam o fechamento. P2 vira backlog.

### 5.2 Ciclo de vida

```
open → in_progress → fixed → closed
                        └──→ reopened → in_progress → ...
open → wontfix   (só com decisão do líder registrada no arquivo)
open → duplicate (aponta a issue original)
```

- `open`: quem abriu. `in_progress` e `fixed`: o dono (`to`). `closed` e `reopened`: só quem abriu. `wontfix`: só o líder.
- Ao mudar status, a pessoa acrescenta uma linha no **Histórico** do arquivo, com data, papel e o que fez. Nunca apaga histórico.

### 5.3 Regras de uma boa issue
- Uma issue por problema. Nada de "vários ajustes na tela X".
- Sempre com evidência reproduzível: print, diff visual, request/response, log ou teste falhando.
- Sempre com esperado vs atual e a referência da fonte da verdade (AC, RN, Figma, contrato).
- Sugestão de correção é bem-vinda, mas o dono decide como corrigir.
- Se descobrir que o problema é de outro papel, reatribua (`to`) com justificativa no histórico. Não deixe issue órfã.

---

## 6. Pedidos de permissão (REQ)

### 6.1 Quando abrir
Abra um REQ sempre que, para avançar, você precisar de algo que não está no seu escopo ou que não tem. Isso inclui:

- `path`: editar arquivo fora do seu escopo (o team-guard bloqueou, ou o protocolo proíbe).
- `command`: rodar comando bloqueado (git, instalação, migração, comando destrutivo).
- `tool`: ferramenta que você não tem (ex.: MCP do Figma, navegador, acesso de rede).
- `credential`: login, token, usuário de teste, chave de API.
- `environment`: app ou API fora do ar, ambiente sem dados, porta ocupada, serviço externo necessário.
- `access`: arquivo de design, link privado, documentação interna.
- `dependency`: instalar ou atualizar pacote.
- `decision`: ambiguidade de regra ou de design que o spec não resolve.
- `data`: criar, alterar ou apagar dados em qualquer ambiente de API.

### 6.2 Como abrir
1. Crie `requests/REQ-<PAPEL>-NNN.md` a partir de `<KIT_DIR>/templates/request.md`, preenchendo tudo: o que precisa, por que, o que já tentou, alternativa mais segura, impacto se negado, e se bloqueia (`blocking: true/false`).
2. Atualize seu `status/<papel>.md`: `state: blocked` e `blocked_by: REQ-...` (se bloqueia).
3. Se não bloqueia tudo, continue o que for possível e anote no relatório o que ficou pendente.
4. Encerre retornando ao líder com a primeira linha exatamente assim:
   ```
   ⛔ PERMISSION_REQUEST REQ-<PAPEL>-NNN
   ```

### 6.3 O que é proibido
- Contornar bloqueio. Exemplos: escrever arquivo via `Bash` quando `Edit` foi negado; copiar credencial de outro lugar; usar outra ferramenta pra fazer a mesma coisa; pedir pra outro agente fazer por você sem REQ.
- Seguir "assumindo" uma decisão que é do usuário.
- Abrir REQ vago ("preciso de acesso"). Sem o que, por que e escopo exato, o líder devolve.

### 6.4 Ciclo do REQ
```
open → approved → (líder registra grant) → agente é disparado de novo
open → denied   → agente segue com a alternativa ou encerra com BLOCKED
open → answered → (para type: decision) resposta no arquivo, agente segue
```
A decisão pode vir da conversa ou do escritório (seção 6.7). Do escritório, o arquivo já chega com `decided_by: user` e `user_decision`.

### 6.5 Quem decide
O líder **pode decidir sozinho** apenas:
- `decision` que já esteja respondida no spec ou no histórico da conversa com o usuário;
- leitura de arquivo não sensível fora do escopo;
- comando somente leitura (listar, consultar status, rodar teste existente).

O líder **sempre pergunta ao usuário**, mostrando o REQ resumido, quando envolve:
- escrita fora do escopo do papel;
- credencial, segredo ou `.env`;
- produção, dados reais ou mutação em qualquer ambiente de API não marcado como seguro no spec;
- instalar, remover ou atualizar dependência;
- alterar configuração de build, CI, lint ou TypeScript;
- git (commit, push, merge, rebase, reset) feito por subagente;
- comando destrutivo ou irreversível;
- qualquer custo externo (serviço pago, chamada a terceiros).

Ao aprovar, o líder:
1. Marca o REQ como `approved` com `decided_by` (`user` ou `lead`), data e escopo exato.
2. Se for permissão de arquivo ou comando, adiciona um item em `grants.json` (formato na seção 6.6), restrito ao papel, aos caminhos/padrões e à task.
3. Dispara o agente de novo, citando o REQ aprovado.
4. Remove o grant quando o agente terminar aquele passo.

### 6.6 Formato do grants.json
```json
[
  {
    "req": "REQ-DS-002",
    "role": "designer",
    "write_allow": ["src/styles/tokens.css"],
    "read_allow": [],
    "bash_allow": [],
    "reason": "ajustar token de cor aprovado pelo usuário",
    "approved_by": "user",
    "date": "2026-09-23"
  }
]
```
`bash_allow` são expressões regulares. O team-guard lê esse arquivo a cada chamada; grant removido perde efeito na hora.

### 6.7 Respostas e mensagens pelo escritório

O usuário pode responder e conversar pelo escritório (`http://localhost:4000`), sem digitar no Claude Code:

- **Responder um REQ** (aprovar, negar ou responder uma dúvida). O escritório grava a decisão no próprio arquivo do REQ (`status`, `decided_by: user`, `user_decision`, `user_note` e a seção "Resposta do usuário").
- **Mandar mensagem** para o líder ou para um papel específico. Fica em `inbox.jsonl`.

Como isso chega:
- **Subagente trabalhando:** a mensagem pra ele entra como contexto `📨 … via escritório` depois da próxima ferramenta que ele usar. Ele trata como instrução direta do usuário, com prioridade, dentro do protocolo. Se pedir algo fora do escopo, abre REQ.
- **Líder trabalhando:** recebe do mesmo jeito as decisões de REQ (`📬`) e as mensagens pra ele.
- **Líder parado esperando você:** quando o líder termina a vez com REQ aberto esperando decisão, o hook segura a parada por até `office.wait_minutes` (em `permissions.json`). Assim que você responde no escritório, o líder continua sozinho.
- **Mensagem pra um agente que não está rodando:** chega ao líder, que redispara o agente com a mensagem.

O que o líder faz ao receber `📬`:
1. Confere o REQ (a decisão já está registrada; não pergunte de novo).
2. Aprovado → cria o grant com o escopo mínimo (seção 6.6). Se o texto do usuário definir o escopo, usa exatamente ele.
3. Negado → orienta o agente a seguir com a alternativa.
4. Respondido (`decision`) → registra no `spec.md` (seção 9) se mudar comportamento.
5. Redispara o agente dono do REQ citando a decisão.

**Responder no escritório.** Toda mensagem `📨 MSG-…` recebida é respondida criando `replies/MSG-<id>.md`:
```
---
msg: MSG-<id>
from: <papel ou lead>
---
Resposta curta e direta (até ~10 linhas): o que você entendeu, o que vai fazer ou o status pedido.
```
A resposta aparece embaixo da mensagem no escritório. Pergunta de status ("como está o andamento?") se responde com números reais: rodada, issues fechadas/abertas, o que falta. Mensagem pra um agente que não está rodando: o líder redispara o agente com a mensagem e o id, e é o agente quem responde; se não for redisparar agora, o próprio líder responde dizendo quando vai repassar.

Mensagem ou decisão vinda do escritório vale como fala do usuário na conversa. Ninguém edita `inbox.jsonl` à mão.

---

## 7. Comunicação com o líder (retorno de cada subagente)

Subagente não conversa com o usuário e não chama outro subagente. Ele trabalha, escreve os arquivos e devolve ao líder uma mensagem neste formato:

```
<LINHA DE STATUS>
Rodada: r<N>
Resumo: (até 10 linhas, direto)
Arquivos alterados: (lista de caminhos, ou "nenhum")
Issues abertas: (IDs) | Issues verificadas: (IDs fechados/reabertos)
Pedidos: (IDs de REQ, ou "nenhum")
Relatório: tasks/<TASK-ID>/reports/<papel>-r<N>.md
Próximo passo sugerido: (uma linha)
```

Linhas de status válidas (a primeira linha é sempre uma destas):
- `✅ DONE <papel> r<N>`: terminou, nada pendente do seu lado.
- `🔁 ISSUES <papel> r<N> P0=<x> P1=<y> P2=<z>`: terminou e abriu issues.
- `⛔ PERMISSION_REQUEST REQ-<PAPEL>-NNN`: parou por falta de permissão (seção 6).
- `🚧 BLOCKED <motivo curto>`: não conseguiu seguir por outro motivo. Descreva e sugira saída.

O líder nunca repassa a mensagem de um agente pro outro "de boca". Ele passa **caminhos de arquivo** (spec, issues, relatórios).

---

## 8. Relatório final (report.md, líder)

- Resumo da entrega em 5 linhas.
- Tabela AC → teste E2E → status.
- Tabela RN → onde foi validada → status.
- Issues: total por severidade, abertas por P2 (backlog), wontfix com justificativa.
- REQs: lista, decisão e quem decidiu.
- Rodadas usadas (máx. 3).
- Resultado de lint, typecheck, unit, build e E2E (comando + resultado).
- Commits propostos (mensagens Conventional Commits, em ordem).
- Riscos e pendências.

---

## 9. Definition of Done global

- Todos os ACs atendidos e cobertos por E2E passando.
- Todas as RNs validadas pelo QA.
- Zero P0/P1 abertos.
- Lint, typecheck, testes unitários e build passando, com comando e saída no relatório do Front.
- Designer aprovou (`✅ DONE designer`) quando está no time.
- Back aprovou (`✅ DONE backend`) quando está no time.
- Nenhum REQ `open` com `blocking: true`.
- `report.md` escrito e GATE 2 aprovado pelo usuário.

---

## 10. Regras de ouro

1. Evidência ou não aconteceu. "Testei e funcionou" sem saída de comando, print ou log não vale.
2. Nunca marcar `done` com teste pulado, `skip`, `only`, `// @ts-ignore`, `eslint-disable` ou `any` novo sem REQ `decision` aprovado.
3. Nunca apagar ou enfraquecer teste pra ele passar.
4. Nunca editar o `status/` de outro papel.
5. Nunca contornar o team-guard.
6. Nunca commitar, a não ser o líder no GATE 2.
7. Sempre seguir os padrões que já existem no projeto antes de inventar um novo. Se discordar do padrão, abra REQ `decision`, não mude por conta própria.
8. Na dúvida sobre regra ou design, pergunte via REQ `decision`. Não chute.
9. Mantenha seu `status/<papel>.md` atualizado a cada mudança de estado. É isso que o monitor mostra.
10. Tudo em português do Brasil nos arquivos da task, código e nomes técnicos no padrão do projeto.

---

## 11. Equipe dinâmica (roster)

O time não é fixo em "um de cada papel". O líder monta, cresce e enxuga a equipe conforme a demanda e o desempenho, e registra tudo em `<TEAM_DIR>/roster.json`. O escritório desenha **todos** os membros ativos: quem está trabalhando fica na sala da atividade, quem está livre fica no lounge.

### 11.1 Formato de um membro
```json
{
  "id": "fe-dados-1",
  "name": "Dev Frontend Dados",
  "role": "frontend",
  "prefix": "FE1",
  "level": "senior",
  "scope": "estado e integração de dados: src/services/**, src/hooks/use-*-query.ts",
  "status": "active",
  "hired_at": "2026-09-24 10:30",
  "hired_by": "lead",
  "hire_reason": "13 P1 de cache/estado duplicado; separado do escopo de UI pra não colidir",
  "assigned": ["ISS-BE-003", "ISS-BE-006"],
  "stats": { "dispatches": 0, "done": 0, "issues_fixed": 0, "reopened": 0, "reqs": 0, "blocked": 0 },
  "rating": "novo",
  "notes": "",
  "fired_at": null,
  "fire_reason": null
}
```
- `id`: kebab-case único e estável. `role`: um dos subagentes do time (`frontend`, `qa`, `designer`, `backend`) ou `specialist` (general-purpose, somente leitura).
- `prefix`: 2–5 letras/dígitos únicos, usado nos IDs de issue e REQ (`FE1`, `FE2`, `QA1`).
- `scope`: **arquivos/módulos** que só esse membro toca. Dois membros do mesmo papel nunca têm escopo sobreposto.
- `rating`: `novo`, `bom`, `atenção` ou `ruim`, revisado pelo líder a cada rodada.

### 11.2 Como o líder dispara um membro
- A `description` do subagente começa **sempre** com o id entre colchetes: `[fe-dados-1] Corrigir cache do histórico`. É assim que o escritório liga o boneco ao membro.
- O prompt começa com a identidade: `Você é Dev Frontend Dados (fe-dados-1), frontend sênior. Prefixo de IDs: FE1. Seu escopo: <scope>. Suas tarefas: <lista>.`
- Cada membro recebe no máximo `policy.max_tasks_per_member` tarefas pequenas por disparo.
- Membros com escopos diferentes rodam em paralelo (várias chamadas de subagente na mesma mensagem).

### 11.3 Contratar
O líder contrata (adiciona ao roster, `hired_by: lead`) quando `policy.auto_hire` é `true` e pelo menos um destes vale:
- um perfil acumulou mais tarefas do que `max_tasks_per_member` e o trabalho pode ser dividido por arquivos/módulos sem colisão;
- apareceu uma especialidade que ninguém cobre (ex.: acessibilidade, performance, AppSec);
- um membro foi desligado e o escopo dele continua com trabalho.

Nunca passar de `policy.max_active` membros ativos. O usuário também contrata pelo escritório (`hired_by: user`). Contratação pelo usuário é obrigatória: o líder executa e só questiona se conflitar com o spec aprovado.

### 11.4 Avaliar (ao fim de cada rodada, junto com a seção 12)
Para cada membro que trabalhou na rodada, o líder atualiza `stats` e `rating`:
- `done` sobe quando o retorno é `✅ DONE`; `issues_fixed` conta as issues dele que foram `closed` pelo revisor; `reopened` conta as dele que voltaram a `reopened`; `reqs` e `blocked` contam os pedidos e bloqueios.
- `rating` segue a classe do placar (seção 12.4): `bom` para Destaque/Bom, `atenção` para Atenção, `ruim` para Crítico. Violação grave do protocolo (contornar o guard, apagar teste, sair do escopo de propósito) é `ruim` direto, com a evidência.
- Registre o motivo em `notes` (uma linha por rodada, com a data).

### 11.5 Desligar
O líder desliga (`status: fired`, `fired_at`, `fire_reason`) quando `policy.auto_fire` é `true` e:
- o placar recomenda **Desligar e substituir** (Crítico com pelo menos 2 avaliações do líder ou 3 no total); ou
- o `rating` chegou a `ruim` por violação grave do protocolo; ou
- o escopo do membro acabou e não há trabalho previsto pra ele nesta task.

Ao desligar: reatribua as issues abertas dele (`to`) a outro membro ou a um contratado novo, e nunca desligue alguém no meio de um disparo. O usuário também desliga pelo escritório; o líder executa na próxima oportunidade segura (quando o membro não estiver rodando).

### 11.6 Transparência
Toda contratação, avaliação que muda `rating` e desligamento:
1. vai para o `roster.json` com motivo;
2. vira uma linha na seção 9 (decisões) do `spec.md` da task;
3. é anunciada ao usuário numa frase na conversa (ex.: "Contratei Dev Frontend UI 2 (fe-ui-2) pra dividir as 13 issues de UI; desliguei QA2 por 3 reaberturas na ISS-QA2-004").

---

## 12. Avaliações de desempenho

Toda entrega é avaliada. As avaliações alimentam um placar por membro que o escritório mostra e que o líder usa pra decidir contratar, manter ou desligar.

### 12.1 Quem avalia quem
- **Líder → cada membro que entregou na rodada.** Obrigatório, no fim de toda rodada (passo de avaliação do `/team`).
- **Colega → colega**, quando um revisou ou dependeu do trabalho do outro na rodada: QA avalia quem ele verificou; Designer avalia quem implementou a tela que ele revisou; Back/AppSec avalia quem integrou o que ele validou; Front pode avaliar quem abriu issues pra ele (clareza, evidência, se era mesmo problema).
- Ninguém se autoavalia. Ninguém avalia quem não teve contato com o seu trabalho na rodada.

### 12.2 Como avaliar
Crie `reviews/<seu-id>__<id-avaliado>__r<N>.json` (um arquivo por par e rodada; refazer na mesma rodada sobrescreve), no formato de `<KIT_DIR>/templates/review.json`. Notas de 1 a 5 em cada critério:

| Critério | 1 | 3 | 5 |
|---|---|---|---|
| **Qualidade** | bugs óbvios, reaberturas, teste quebrado | funciona com ajustes pequenos | limpo, testado, nada voltou |
| **Entrega** | não fez o pedido ou fez outra coisa | fez parte, faltou AC | entregou tudo que foi pedido, no tempo da rodada |
| **Escopo e protocolo** | saiu do escopo, pulou regra | pequenos desvios | dentro do escopo, protocolo à risca |
| **Comunicação** | sem relatório/evidência, confuso | relatório ok | claro, com evidência, status sempre atualizado |
| **Colaboração** | travou colegas, ignorou issues | neutro | desbloqueou colegas, respondeu rápido |

Regras:
- `comment` obrigatório, 1 a 3 frases, falando do trabalho, não da pessoa.
- Nota 1, 2 ou 5 em qualquer critério exige `evidence` (IDs de issue, relatório, print, teste).
- Seja honesto. Inflar nota de colega esconde problema e prejudica o time; derrubar sem evidência é violação do protocolo.

### 12.3 Como o placar é calculado
`node <KIT_DIR>/hooks/team-score.mjs` (o escritório usa exatamente o mesmo cálculo):
- cada avaliação vira 0–100 (média dos critérios);
- **Líder 50%** (últimas 5, as recentes pesam mais) + **Colegas 30%** (últimas 8) + **Objetivo 20%** (`issues_fixed` e `reopened` do roster; reabertura pesa em dobro). Parte sem dado sai da conta.
- Tendência: compara as 2 últimas avaliações com as 2 anteriores (↑ ↓ →).

### 12.4 Classes e recomendações
| Score | Classe | Recomendação |
|---|---|---|
| 85–100 | 🟢 Destaque | Manter (candidato a pegar escopo maior) |
| 70–84 | 🔵 Bom | Manter |
| 50–69 | 🟡 Atenção | Plano de melhoria na próxima rodada (focar nos 2 piores critérios) |
| 0–49 | 🔴 Crítico | Alerta; com 2 avaliações do líder ou 3 no total → **Desligar e substituir** |

O placar também recomenda **contratar** quando membros passam de `max_tasks_per_member` issues abertas.

### 12.5 O que o líder faz com isso
No passo de avaliação de cada rodada:
1. Escreve a avaliação dele de cada membro que entregou.
2. Roda `node <KIT_DIR>/hooks/team-score.mjs` e lê o placar.
3. Atualiza `rating`/`notes` no roster conforme a classe.
4. Segue as recomendações (seções 11.3 e 11.5): plano de melhoria em quem está em Atenção (diga isso no próximo disparo dele), desligar e substituir quem está Crítico, contratar se houver sobrecarga.
5. Anuncia numa frase as mudanças de classe e as decisões.

---

## 13. Economia de tokens

Cada disparo tem custo. O objetivo é entregar o que foi pedido com o menor consumo possível, e aprender com isso a cada rodada.

### 13.1 Medição
- O escritório grava em `<TEAM_DIR>/usage.json` o consumo de cada membro: disparos, tokens totais e média por disparo.
- `node <KIT_DIR>/hooks/team-score.mjs` mostra tokens por disparo ao lado do placar.

### 13.2 Regras pra todo agente
- Leia só o necessário: `Grep`/`Glob` pra achar, `Read` com trecho, nada de ler pasta inteira "pra entender".
- Não repita trabalho: se o relatório anterior ou o spec já respondem, use-os.
- Testes: rode só o que é afetado pela sua mudança; a suíte inteira fica pro fechamento da task.
- Saída curta: relatório de até ~40 linhas; logs grandes vão pra `evidence/`, não pro texto.
- Não "explore" fora do escopo. Dúvida que custa muita leitura vira REQ `decision`.

### 13.3 O que o líder faz a cada rodada
1. Lê `usage.json` e compara a média de tokens/disparo de cada membro com a mediana da equipe.
2. Quem passou de **1,5× a mediana** sem entregar mais (mais issues resolvidas ou tarefa maior): descubra a causa no relatório dele (leu demais? rodou tudo? tarefa grande demais?) e registre uma linha no "Histórico" de `<TEAM_DIR>/efficiency.md`.
3. Se a lição vale pra todos, promova pra "Regras ativas" (máximo de 8 regras; troque a menos útil).
4. **Todo disparo começa com as 5 primeiras regras ativas** do `efficiency.md`, logo depois da identidade do membro.
5. Ao contratar, dê ao membro um orçamento de referência (`token_budget` no roster, ex.: a mediana da equipe pra tarefas parecidas) e mencione no prompt: "tente fechar em até ~X tokens".
6. Consumo alto e recorrente sem ganho de qualidade pesa na avaliação do líder (critério Entrega) e entra nas notas do roster.
