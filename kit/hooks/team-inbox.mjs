#!/usr/bin/env node
/**
 * team-inbox — entrega ao Claude Code o que você respondeu/mandou pelo escritório.
 *
 * PostToolUse (líder e subagentes):
 *   a cada ferramenta usada, entrega as mensagens pendentes pra quem está agindo
 *   (subagente pelo papel; sessão principal = líder). O líder também recebe as
 *   decisões de REQ que você deu no escritório.
 *
 * Stop (só o líder):
 *   1. Se há mensagem/decisão pendente → impede a parada e entrega (o líder continua sozinho).
 *   2. Se há REQ aberto esperando você → espera até `office.wait_minutes` pela resposta
 *      no escritório. Chegou → entrega e o líder continua. Não chegou → deixa parar.
 *      Durante a espera, Esc no Claude Code interrompe normalmente.
 *
 * Nunca quebra o Claude Code: qualquer erro → sai com 0 sem fazer nada.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { teamDirFor, normCwd } from './paths.mjs';

let CURRENT_TEAM_DIR = '';
const ROLES = { frontend: 'Front', qa: 'QA', designer: 'Designer', backend: 'Back', lead: 'Líder' };
const DECISION = { approve: 'APROVADO', deny: 'NEGADO', answer: 'RESPONDIDO' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  const data = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  const h1 = /^#\s+(.+)$/m.exec((text || '').slice(m ? m[0].length : 0));
  data.title ??= h1 ? h1[1].trim() : '';
  return data;
}

function setFrontmatter(text, updates) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return text;
  const lines = m[1].split(/\r?\n/);
  for (const [k, v] of Object.entries(updates)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}:`));
    if (i >= 0) lines[i] = `${k}: ${v}`;
    else lines.push(`${k}: ${v}`);
  }
  return text.replace(m[0], `---\n${lines.join('\n')}\n---`);
}

// ------------------------------------------------------------------ caixa de entrada

function readInbox(file) {
  return readText(file)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function takeMessages(file, filter, via) {
  const all = readInbox(file);
  const taken = all.filter((m) => !m.delivered && filter(m));
  if (!taken.length) return [];
  const now = new Date().toISOString();
  for (const m of taken) {
    m.delivered = true;
    m.delivered_at = now;
    m.delivered_via = via;
  }
  writeFileSync(file, all.map((m) => JSON.stringify(m)).join('\n') + '\n');
  return taken;
}

// ------------------------------------------------------------------ pedidos (REQ)

function listRequests(dir) {
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.md'));
  } catch {
    return [];
  }
  return names.map((n) => {
    const file = join(dir, n);
    const text = readText(file);
    return { file, text, ...frontmatter(text) };
  });
}

function takeDecisions(dir) {
  const out = [];
  for (const r of listRequests(dir)) {
    if (r.user_decision && r.lead_notified !== 'true') {
      writeFileSync(r.file, setFrontmatter(r.text, { lead_notified: 'true' }));
      out.push(r);
    }
  }
  return out;
}

const awaitingUser = (dir) => listRequests(dir).filter((r) => r.status === 'open' && !r.user_decision);

// ------------------------------------------------------------------ textos entregues

function formatMessages(msgs, forRole, task) {
  return msgs
    .map((m) => {
      const when = new Date(m.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const target = m.member ? `${m.member_name || m.member} (${m.member})` : ROLES[m.to] || m.to;
      const replyFrom = m.member || forRole;
      const replyHow = `crie ${normCwd(join(CURRENT_TEAM_DIR, 'tasks', task, 'replies', m.id + '.md'))} com o frontmatter (msg: ${m.id}, from: ${replyFrom}) e a resposta curta e direta no corpo`;
      if (m.kind === 'hire' || m.kind === 'fire') {
        return `${m.text}\n   → Ao concluir, responda no escritório: ${replyHow.replace(`from: ${replyFrom}`, 'from: lead')}.`;
      }
      if (forRole === 'lead' && (m.to !== 'lead' || m.member)) {
        return `📨 ${m.id} — mensagem do usuário para ${target} (${when}, via escritório): "${m.text}"\n   → Repasse: redispare ${m.member ? `o membro \`${m.member}\` ([${m.member}] na description)` : `o agente \`${m.to}\``} agora com essa mensagem e o id ${m.id}; ele responde no escritório (${replyHow}). Se não for redisparar agora, responda você mesmo dizendo quando vai repassar (from: lead).`;
      }
      const you = m.member ? ` (${m.member_name || m.member}, ${m.member})` : '';
      return `📨 ${m.id} — mensagem do usuário para você${you} (${when}, via escritório): "${m.text}"\n   → Responda no escritório: ${replyHow}. Depois continue o trabalho.`;
    })
    .join('\n');
}

function formatDecisions(reqs) {
  return reqs
    .map(
      (r) =>
        `📬 ${r.id} (${ROLES[r.from] || r.from}, ${r.type}): ${DECISION[r.user_decision] || r.user_decision}` +
        (r.user_note ? ` — "${r.user_note}"` : ''),
    )
    .join('\n');
}

const LEAD_FOOTER =
  '\nIsso veio do usuário pelo escritório e vale como resposta dele na conversa. Siga a seção 6.7 do protocolo: ' +
  'o REQ já está com a decisão registrada; crie ou remova grants se precisar e redispare o agente dono do pedido. ' +
  'Mensagens: trate como instrução direta do usuário.';

const AGENT_FOOTER =
  '\nTrate como instrução direta do usuário, com prioridade sobre o que você estava fazendo, sempre dentro das regras do protocolo ' +
  '(se pedir algo fora do seu escopo, abra um REQ). Registre no seu status que recebeu.';

// ------------------------------------------------------------------ main

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', async () => {
  try {
    const payload = JSON.parse(raw || '{}');
    const projectDir = normCwd(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());
    const teamDir = teamDirFor(projectDir);
    CURRENT_TEAM_DIR = teamDir;
    const task = readText(join(teamDir, 'ACTIVE')).trim();
    if (!task) process.exit(0);

    const taskDir = join(teamDir, 'tasks', task);
    const inbox = join(taskDir, 'inbox.jsonl');
    const reqDir = join(taskDir, 'requests');
    const perms = JSON.parse(readText(join(teamDir, 'permissions.json')) || '{}');
    const waitMinutes = Number(perms.office?.wait_minutes ?? 20);

    const agent = String(payload.agent_type || '').toLowerCase();
    const role = agent ? (ROLES[agent] ? agent : null) : 'lead';
    if (!role) process.exit(0); // agente fora do time

    const event = payload.hook_event_name;

    // ---------------------------------------------- durante o trabalho
    if (event === 'PostToolUse') {
      const msgs = existsSync(inbox) ? takeMessages(inbox, (m) => m.to === role, role) : [];
      const decs = role === 'lead' ? takeDecisions(reqDir) : [];
      if (!msgs.length && !decs.length) process.exit(0);
      const text = [formatDecisions(decs), formatMessages(msgs, role, task)].filter(Boolean).join('\n') + (role === 'lead' ? LEAD_FOOTER : AGENT_FOOTER);
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }));
      process.exit(0);
    }

    // ---------------------------------------------- líder parando
    if (event === 'Stop' && role === 'lead') {
      const deadline = Date.now() + waitMinutes * 60_000;
      while (true) {
        const msgs = existsSync(inbox) ? takeMessages(inbox, () => true, 'lead') : [];
        const decs = takeDecisions(reqDir);
        if (msgs.length || decs.length) {
          const text = [formatDecisions(decs), formatMessages(msgs, 'lead', task)].filter(Boolean).join('\n') + LEAD_FOOTER;
          process.stdout.write(JSON.stringify({ decision: 'block', reason: text }));
          process.exit(0);
        }
        if (!awaitingUser(reqDir).length || Date.now() > deadline) process.exit(0);
        await sleep(3000);
      }
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
