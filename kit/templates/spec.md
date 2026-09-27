---
task: AAAAMMDD-slug
title: Título curto da task
size: S | M | L | XL
team: frontend, qa
backend_mode: external | same-repo
monitor: on
status: draft | approved
approved_by:
approved_at:
branch: feat/slug
---

# Spec — <título>

## 1. Objetivo
O que o usuário final consegue fazer quando isso estiver pronto (1 a 3 frases).

## 2. Fora de escopo
- O que NÃO será feito nesta task.

## 3. Critérios de aceite
Cada AC é verificável e vira pelo menos um teste E2E.

| ID | Dado que | Quando | Então |
|---|---|---|---|
| AC-1 | | | |
| AC-2 | | | |

## 4. Regras de negócio
| ID | Regra | Exemplo válido | Exemplo inválido | Mensagem ao usuário |
|---|---|---|---|---|
| RN-1 | | | | |

## 5. Fontes de design
- Figma: <link> — nodes: <ids> (um frame por tela e por estado)
- Prints: `design/<arquivo>.png` (descrever o que cada um mostra)
- Tokens / design system: <caminho ou link>
- Breakpoints obrigatórios: 375, 768, 1280, 1440
- Estados obrigatórios: padrão, hover, foco, desabilitado, carregando, vazio, erro, sucesso

## 6. Contrato de API
- Fonte: <OpenAPI/Swagger/link/arquivo>

| Método | Endpoint | Request | Respostas esperadas | Uso na UI |
|---|---|---|---|---|
| | | | 200 / 400 / 401 / 403 / 404 / 422 / 500 | |

## 7. Ambiente
- App: URL `http://localhost:3000` — start: `npm run dev`
- API:

  | Ambiente | URL base | Mutação permitida? | Observação |
  |---|---|---|---|
  | local | | sim/não | |
  | staging | | sim/não | |
  | produção | | **não** | nunca mutar |

- Usuários de teste: papel → onde está a credencial (NUNCA a senha em texto aqui)
- Comando E2E: `npx playwright test`
- Comandos de qualidade: lint `…` · typecheck `…` · unit `…` · build `…`

## 8. Riscos e dúvidas
- 

## 9. Decisões registradas
| Data | Decisão | Quem decidiu |
|---|---|---|
