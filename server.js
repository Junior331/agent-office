import http from 'node:http';
import { readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { readFileSync, existsSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { computeScores } from './kit/hooks/team-score.mjs';
import { teamDirFor, normCwd, listProjects, ensureProject, HOME, KIT_DIR } from './kit/hooks/paths.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4000;
const STALE_MS = 30 * 60 * 1000; // some com o agente depois de 30 min sem evento

// papéis do time (subagent_type / agent_type) → nome e cor fixos no escritório
const ROLES = {
  frontend: { label: 'Front', color: '#29b6f6' },
  qa: { label: 'QA', color: '#8bc34a' },
  designer: { label: 'Designer', color: '#ec407a' },
  backend: { label: 'Back', color: '#ffb300' },
};

/** cwd do projeto -> estado do time (pasta do time do projeto, fora do repositório) */
const teams = new Map();
const teamJson = new Map();
const teamTimers = new Map();

const PALETTE = ['#e4572e', '#29b6f6', '#8bc34a', '#ffb300', '#ab47bc', '#26a69a', '#ec407a', '#5c6bc0', '#ff7043', '#78909c'];

/** id -> agente (sessão principal ou subagente) */
const agents = new Map();
/** `${session_id}:${agent_id}` -> id do subagente desenhado */
const aliases = new Map();
/** session_id -> [{ subId, toolUseId, bound }] tarefas (Task/Agent) em andamento */
const pendingTasks = new Map();

// ---------------------------------------------------------------- helpers

function colorFor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function short(s, n = 60) {
  if (!s) return '';
  const clean = String(s).replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n - 1) + '…' : clean;
}

const isTaskTool = (name) => name === 'Task' || name === 'Agent';

function stateForTool(name = '') {
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) return 'typing';
  if (/^(Read|Grep|Glob|LS)$/.test(name)) return 'reading';
  if (/^(Bash|BashOutput|KillShell)$/.test(name)) return 'terminal';
  if (/^(WebFetch|WebSearch)$/.test(name) || name.startsWith('mcp__')) return 'web';
  if (isTaskTool(name)) return 'meeting';
  return 'thinking';
}

function detailForTool(name, input = {}) {
  if (input.file_path) return `${name} ${basename(input.file_path)}`;
  if (input.command) return `$ ${short(input.command, 50)}`;
  if (input.pattern) return `${name} "${short(input.pattern, 40)}"`;
  if (input.url) return `${name} ${short(input.url, 50)}`;
  if (input.query) return `${name} "${short(input.query, 40)}"`;
  if (input.description) return `${name}: ${short(input.description, 50)}`;
  return name;
}

// ---------------------------------------------------------------- estado

function upsertSession(ev) {
  let a = agents.get(ev.session_id);
  if (!a) {
    a = {
      id: ev.session_id,
      name: ev.cwd ? basename(ev.cwd) : `sessão ${ev.session_id.slice(0, 4)}`,
      cwd: ev.cwd || null,
      role: null,
      color: colorFor(ev.session_id),
      state: 'idle',
      waiting: false,
      detail: 'chegou no escritório',
      parentId: null,
      isSub: false,
      updatedAt: Date.now(),
    };
    agents.set(a.id, a);
  }
  return a;
}

// "[fe-dados-1] Corrigir cache" → membro fe-dados-1 do roster
const MEMBER_TAG = /^\s*\[([a-z0-9][a-z0-9_-]{0,40})\]\s*/i;
function memberFrom(description) {
  const m = MEMBER_TAG.exec(String(description || ''));
  return m ? m[1].toLowerCase() : null;
}
const stripTag = (d) => String(d || '').replace(MEMBER_TAG, '');

function spawnSub(parent, subId, name, roleKey, detail) {
  const roleName = String(roleKey || '').toLowerCase().replace(/^team-/, '');
  const role = ROLES[roleName];
  agents.set(subId, {
    id: subId,
    memberId: memberFrom(detail),
    name: role ? role.label : short(stripTag(name), 28),
    role: role ? roleName : null,
    color: role ? role.color : parent.color,
    state: 'thinking',
    waiting: false,
    detail: detail ? short(stripTag(detail), 60) : 'recebeu a tarefa',
    parentId: parent.id,
    isSub: true,
    updatedAt: Date.now(),
  });
}

// ---------------------------------------------------------------- histórico de subagentes

const HISTORY_FILE = join(ROOT, 'history.json');
const HISTORY_MAX = 200;
let history = [];
try {
  history = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
} catch {
  history = [];
}
let historyTimer = null;
function saveHistory() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => writeFile(HISTORY_FILE, JSON.stringify(history.slice(0, HISTORY_MAX))).catch(() => {}), 1000);
}

function historyStart(parent, subId, ev) {
  const roleKey = String(ev.tool_input?.subagent_type || '').toLowerCase().replace(/^team-/, '');
  history.unshift({
    id: subId,
    toolUseId: ev.tool_use_id || null,
    session: parent.id,
    project: parent.name,
    role: ROLES[roleKey] ? roleKey : null,
    memberId: memberFrom(ev.tool_input?.description),
    cwd: parent.cwd,
    type: ev.tool_input?.subagent_type || 'subagente',
    name: short(stripTag(ev.tool_input?.description) || ev.tool_input?.subagent_type || 'subagente', 60),
    startedAt: Date.now(),
    endedAt: null,
    result: null,
    tokens: null,
  });
  history.length = Math.min(history.length, HISTORY_MAX);
  saveHistory();
}

// ---------------------------------------------------------------- consumo de tokens por membro

const usageTimers = new Map();
function usageFor(cwd) {
  const out = {};
  for (const h of history) {
    if (h.cwd !== cwd || !h.endedAt) continue;
    const key = h.memberId || h.role || h.type || 'outros';
    const u = (out[key] ??= { dispatches: 0, tokens: 0, with_tokens: 0, duration_ms: 0, done: 0, issues: 0 });
    u.dispatches += 1;
    u.duration_ms += h.endedAt - h.startedAt;
    if (h.tokens) {
      u.tokens += h.tokens;
      u.with_tokens += 1;
    }
    if (h.result?.kind === 'done') u.done += 1;
    if (h.result?.kind === 'issues') u.issues += 1;
  }
  for (const u of Object.values(out)) u.avg_tokens = u.with_tokens ? Math.round(u.tokens / u.with_tokens) : null;
  return out;
}
function scheduleUsageWrite(cwd) {
  if (!cwd) return;
  clearTimeout(usageTimers.get(cwd));
  usageTimers.set(
    cwd,
    setTimeout(() => {
      const file = join(teamDirFor(cwd), 'usage.json');
      writeFile(file, JSON.stringify({ updated: new Date().toISOString(), members: usageFor(cwd) }, null, 2) + '\n').catch(() => {});
    }, 1500),
  );
}

function historyEnd(match, ev) {
  const h = history.find(match);
  if (!h) return;
  h.endedAt ??= Date.now();
  if (ev?.tool_response !== undefined) {
    const text = typeof ev.tool_response === 'string' ? ev.tool_response : JSON.stringify(ev.tool_response);
    const status = /(✅ DONE[^\n"\\]*|🔁 ISSUES[^\n"\\]*|⛔ PERMISSION_REQUEST [A-Z]+-[A-Z]+-\d+|🚧 BLOCKED[^\n"\\]*)/u.exec(text);
    if (status) {
      const t = status[1].trim();
      h.result = { kind: t.startsWith('✅') ? 'done' : t.startsWith('🔁') ? 'issues' : t.startsWith('⛔') ? 'req' : 'blocked', text: short(t, 80) };
    } else {
      h.result ??= { kind: 'finished', text: '' };
    }
    const tok = /"(?:totalTokens|total_tokens)"\s*:\s*(\d+)/.exec(text);
    if (tok) h.tokens = Number(tok[1]);
  }
  saveHistory();
  scheduleUsageWrite(h.cwd);
}

function removeAgent(id) {
  if (agents.get(id)?.isSub) historyEnd((h) => h.id === id && !h.endedAt);
  agents.delete(id);
  for (const [k, v] of aliases) if (v === id) aliases.delete(k);
  for (const [sid, list] of pendingTasks) {
    const rest = list.filter((t) => t.subId !== id);
    if (rest.length) pendingTasks.set(sid, rest);
    else pendingTasks.delete(sid);
  }
}

/**
 * Descobre quem fez a ação. Versões recentes do Claude Code mandam `agent_id`
 * quando o evento vem de um subagente; se vier, amarramos ao boneco criado
 * no PreToolUse do Task. Se não vier, tudo cai na sessão principal.
 */
function resolveActor(ev) {
  const session = upsertSession(ev);
  if (!ev.agent_id) return session;

  const key = `${ev.session_id}:${ev.agent_id}`;
  let subId = aliases.get(key);
  if (!subId) {
    const free = (pendingTasks.get(ev.session_id) || []).find((t) => !t.bound);
    if (free) {
      free.bound = true;
      subId = free.subId;
    } else {
      subId = key;
      spawnSub(session, subId, ev.agent_type || 'subagente', ev.agent_type);
    }
    aliases.set(key, subId);
  }
  return agents.get(subId) ?? session;
}

function finishTask(sessionId, toolUseId) {
  const list = pendingTasks.get(sessionId) || [];
  const idx = toolUseId ? list.findIndex((t) => t.toolUseId === toolUseId) : 0;
  if (idx >= 0 && list[idx]) removeAgent(list[idx].subId);
}

// "c:\Users\x\proj", "C:/Users/x/proj" e "C:\Users\x\proj\" viram a mesma chave (e o Windows aceita / no fs)
function handle(ev) {
  if (ev?.cwd) ev.cwd = normCwd(ev.cwd);
  if (!ev?.session_id || !ev.hook_event_name) return;
  const a = resolveActor(ev);
  a.updatedAt = Date.now();
  if (ev.cwd) scheduleTeamRead(ev.cwd);

  switch (ev.hook_event_name) {
    case 'SessionStart':
      a.state = 'idle';
      a.detail = 'chegou no escritório';
      break;

    case 'UserPromptSubmit':
      a.state = 'thinking';
      a.waiting = false;
      a.detail = `pedido: ${short(ev.prompt, 50)}`;
      break;

    case 'PreToolUse':
      a.waiting = false;
      a.state = stateForTool(ev.tool_name);
      a.detail = detailForTool(ev.tool_name, ev.tool_input);
      if (isTaskTool(ev.tool_name) && !a.isSub) {
        const subId = `${a.id}:task:${ev.tool_use_id || Date.now()}`;
        spawnSub(
          a,
          subId,
          ev.tool_input?.description || ev.tool_input?.subagent_type || 'subagente',
          ev.tool_input?.subagent_type,
          ev.tool_input?.description,
        );
        historyStart(a, subId, ev);
        const list = pendingTasks.get(a.id) || [];
        list.push({ subId, toolUseId: ev.tool_use_id, bound: false });
        pendingTasks.set(a.id, list);
      }
      break;

    case 'PostToolUse':
      if (isTaskTool(ev.tool_name) && !a.isSub) {
        finishTask(a.id, ev.tool_use_id);
        historyEnd((h) => h.session === a.id && (ev.tool_use_id ? h.toolUseId === ev.tool_use_id : !h.result), ev);
      }
      a.state = 'thinking';
      break;

    case 'Notification':
      if (!a.isSub && Date.now() - tgStarted > 15_000) tgSend(`✋ ${a.name}: ${short(ev.message, 200) || 'o Claude Code precisa de você'}\n(esse tipo de permissão só dá pra responder no PC)`);
      a.waiting = true;
      a.detail = short(ev.message, 60) || 'precisa de você';
      break;

    case 'Stop':
      a.state = 'idle';
      a.waiting = false;
      a.detail = 'terminou, esperando o próximo pedido';
      break;

    case 'SubagentStop':
      if (a.isSub) removeAgent(a.id);
      else finishTask(a.id);
      break;

    case 'SessionEnd':
      for (const [id, x] of agents) if (id === a.id || x.parentId === a.id) removeAgent(id);
      break;
  }

  const who = agents.get(a.id)?.name ?? a.name;
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${who} · ${ev.hook_event_name}${ev.tool_name ? ` · ${ev.tool_name}` : ''}`);
  broadcast();
}

// ---------------------------------------------------------------- http + ws

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

async function handleRequest(req, res) {
  if (req.method === 'POST' && req.url === '/event') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        handle(JSON.parse(body));
      } catch (err) {
        console.warn('evento inválido:', err.message);
      }
      res.writeHead(204).end();
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/floors/scan') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, repos: scanRepos() }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/update') {
    try {
      const r = startUpdate();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, ...r }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/lead/')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const result =
          req.url === '/api/lead/send' ? await leadSend(data)
          : req.url === '/api/lead/stop' ? leadStop(data)
          : req.url === '/api/lead/mode' ? leadMode(data)
          : req.url === '/api/lead/login' ? openLogin()
          : req.url === '/api/lead/retry' ? await leadRetry(data)
          : null;
        if (!result) throw new Error('rota desconhecida');
        broadcast();
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/floors/')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const result = req.url === '/api/floors/add' ? addFloor(data) : req.url === '/api/floors/hide' ? hideFloor(data) : null;
        if (!result) throw new Error('rota desconhecida');
        refreshRegistry();
        broadcast();
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/team/')) {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 100_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const result =
          req.url === '/api/team/answer' ? await answerRequest(data)
          : req.url === '/api/team/message' ? await sendMessage(data)
          : req.url === '/api/team/hire' ? await hireAgent(data)
          : req.url === '/api/team/fire' ? await fireMember(data)
          : null;
        if (!result) throw new Error('rota desconhecida');
        await readTeam(data.cwd);
        broadcast();
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agents: agents.size, teams: teams.size }));
    return;
  }

  if (req.method === 'GET') {
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = join(PUBLIC_DIR, urlPath);
    if (!file.startsWith(PUBLIC_DIR)) return res.writeHead(403).end();
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404).end('não encontrado');
    }
    return;
  }

  res.writeHead(405).end();
}

// Escuta no IPv4 e no IPv6 do localhost: no Windows o Node resolve "localhost" como ::1,
// então só 127.0.0.1 fazia os eventos do Claude Code se perderem.
const servers = [http.createServer(handleRequest), http.createServer(handleRequest)];
const wss = new WebSocketServer({ noServer: true });
for (const srv of servers) {
  srv.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)));
}


function decorate(a) {
  const cwd = a.cwd ?? agents.get(a.parentId)?.cwd;
  const team = cwd && teams.get(cwd);
  if (!team) return a;
  const open = team.requests.filter((r) => r.status === 'open');
  if (a.role) {
    const req = open.find((r) => r.from === a.role);
    if (req) return { ...a, waiting: true, detail: `⛔ ${req.id}: ${req.title}` };
    return a;
  }
  if (!a.isSub && open.some((r) => r.blocking === 'true')) {
    const n = open.length;
    return { ...a, waiting: true, detail: `⛔ ${n} pedido${n > 1 ? 's' : ''} de permissão esperando você` };
  }
  return a;
}

function snapshot() {
  const { members, bound, memberInfo, perfByTeam } = buildTeamAgents();
  const others = [...agents.values()].filter((a) => !bound.has(a.id)).map(decorate);
  const floors = new Map();
  for (const p of registry) floors.set(p.cwd, { cwd: p.cwd, name: p.name, lastActive: 0, online: false });
  for (const a of agents.values()) {
    if (a.isSub || !a.cwd) continue;
    const f = floors.get(a.cwd) || { cwd: a.cwd, name: basename(a.cwd), lastActive: 0 };
    f.lastActive = Math.max(f.lastActive, a.updatedAt);
    f.online = true;
    floors.set(a.cwd, f);
  }
  // andar sem sessão aberta: o líder fica esperando no lounge
  const leaders = [...floors.values()]
    .filter((f) => !f.online)
    .map((f) => {
      const busy = !!runners.get(f.cwd)?.proc;
      return { id: `lead|${f.cwd}`, name: 'Líder', cwd: f.cwd, color: '#b8a9ff', state: busy ? 'thinking' : 'idle', waiting: false, detail: busy ? runners.get(f.cwd).current?.activity || 'trabalhando pelo escritório' : 'esperando você', isSub: false, offline: true, updatedAt: 0 };
    });
  const all = [...others, ...leaders, ...members];
  const cwdOf = (a) => a.cwd || agents.get(a.parentId)?.cwd;
  const projects = [...floors.values()].map((f) => {
    const here = all.filter((a) => cwdOf(a) === f.cwd && (a.isSub || a.member));
    const team = teams.get(f.cwd);
    return {
      ...f,
      team: !!team?.task,
      title: team?.title || null,
      working: here.filter((a) => a.state !== 'idle').length,
      people: here.length + 1,
      waiting: all.filter((a) => cwdOf(a) === f.cwd && a.waiting).length,
    };
  });
  const leadChatsOut = Object.fromEntries(projects.map((p) => [p.cwd, leadState(p.cwd)]));
  for (const p of projects) {
    const st = leadChatsOut[p.cwd];
    p.leadRunning = st.running;
  }
  return JSON.stringify({
    type: 'agents',
    projects,
    leadChats: leadChatsOut,
    update: updateInfo,
    login,
    agents: all.map((a) => (a.cwd ? a : { ...a, cwd: cwdOf(a) || null })),
    teams: [...teams.values()].map(({ reviews, ...t }) => ({ ...t, memberInfo: memberInfo[t.cwd] || {}, performance: perfByTeam[t.cwd] || null })),
    history: history.slice(0, 60),
  });
}

// ---------------------------------------------------------------- time (pasta do time do projeto)

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

async function safeRead(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function readFolder(dir) {
  let names = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) out.push({ file: n, ...frontmatter(await safeRead(join(dir, n))) });
  return out;
}

async function readReplies(dir) {
  let names = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md'));
  } catch {
    return {};
  }
  const out = {};
  for (const n of names) {
    const text = await safeRead(join(dir, n));
    const fm = frontmatter(text);
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim().slice(0, 20000);
    const id = fm.msg || n.replace(/\.md$/, '');
    out[id] = { from: fm.from || '', text: body };
  }
  return out;
}

function parseJsonl(text) {
  return String(text || '')
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

async function readAllReviews(teamDir) {
  const out = [];
  let tasks = [];
  try {
    tasks = await readdir(join(teamDir, 'tasks'));
  } catch {
    return out;
  }
  for (const task of tasks) {
    let files = [];
    try {
      files = (await readdir(join(teamDir, 'tasks', task, 'reviews'))).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        out.push({ task, ...JSON.parse(await safeRead(join(teamDir, 'tasks', task, 'reviews', f))) });
      } catch {
        /* arquivo inválido: ignora */
      }
    }
  }
  return out;
}

async function readTeam(cwd) {
  const teamDir = teamDirFor(cwd);
  const task = (await safeRead(join(teamDir, 'ACTIVE'))).trim();
  let roster = null;
  try {
    roster = JSON.parse(await safeRead(join(teamDir, 'roster.json')));
  } catch {
    roster = null;
  }
  let team = null;

  if (task || roster?.members?.length) {
    const dir = task ? join(teamDir, 'tasks', task) : null;
    const spec = dir ? frontmatter(await safeRead(join(dir, 'spec.md'))) : {};
    const guard = dir ? (await safeRead(join(dir, 'guard.log'))).trim().split(/\r?\n/).filter(Boolean).slice(-3) : [];
    team = {
      cwd,
      project: basename(cwd),
      task: task || null,
      title: spec.title || task || basename(cwd),
      size: spec.size || '',
      spec: spec.status || '',
      roster: roster?.members || [],
      policy: roster?.policy || null,
      status: dir ? await readFolder(join(dir, 'status')) : [],
      issues: dir ? await readFolder(join(dir, 'issues')) : [],
      requests: dir ? await readFolder(join(dir, 'requests')) : [],
      replies: dir ? await readReplies(join(dir, 'replies')) : {},
      messages: dir ? parseJsonl(await safeRead(join(dir, 'inbox.jsonl'))).slice(-300) : [],
      guard: guard.map((l) => l.split(' · ').slice(1, 4).join(' · ')),
      reviews: await readAllReviews(teamDir),
    };
  }

  const json = JSON.stringify(team);
  if (teamJson.get(cwd) === json) return false;
  teamJson.set(cwd, json);
  if (team) teams.set(cwd, team);
  else teams.delete(cwd);
  return true;
}

// ---------------------------------------------------------------- equipe (membros do roster no mapa)

const OPEN_ISSUE = new Set(['open', 'reopened', 'in_progress']);

/** membros ativos da equipe: roster; sem roster, os status/ da task viram membros (um por papel) */
function membersOf(team) {
  const fromRoster = team.roster.filter((m) => m.status !== 'fired');
  if (fromRoster.length || team.roster.length) return fromRoster;
  return team.status
    .filter((s) => s.role)
    .map((s) => {
      const id = (s.member || s.file.replace(/\.md$/, '')).toLowerCase();
      return { id, name: ROLES[s.role]?.label || s.role, role: s.role, level: '', scope: '', status: 'active', synthetic: true };
    });
}

function buildTeamAgents() {
  const out = [];
  const bound = new Set();
  const memberInfo = {};
  const perfByTeam = {};

  for (const team of teams.values()) {
    const leads = [...agents.values()].filter((a) => !a.isSub && a.cwd === team.cwd);
    const lead = leads.sort((x, y) => y.updatedAt - x.updatedAt)[0] || { id: `lead|${team.cwd}` };
    const leadIds = new Set(leads.map((l) => l.id));
    const subs = [...agents.values()].filter((a) => a.isSub && leadIds.has(a.parentId));
    const members = membersOf(team);
    const byRole = (role) => members.filter((m) => m.role === role);
    const openReqs = team.requests.filter((r) => r.status === 'open');
    const info = (memberInfo[team.cwd] = {});
    const soleRole = (m) => byRole(m.role).length === 1;
    const load = Object.fromEntries(
      members.map((m) => [m.id, team.issues.filter((i) => (i.to === m.id || (soleRole(m) && i.to === m.role)) && OPEN_ISSUE.has(i.status)).length]),
    );
    const allForScore = [...team.roster.filter((m) => m.status === 'fired'), ...members];
    const perf = computeScores(allForScore, team.reviews || [], team.policy || {}, load);
    perfByTeam[team.cwd] = { team: perf.team, teamAvg: perf.teamAvg, fired: Object.fromEntries(team.roster.filter((m) => m.status === 'fired').map((m) => [m.id, perf.members[m.id]])) };

    // liga cada subagente rodando a um membro
    const busy = new Map();
    for (const sub of subs) {
      let m = sub.memberId && members.find((x) => x.id === sub.memberId);
      if (!m && sub.role) {
        const same = byRole(sub.role).filter((x) => !busy.has(x.id));
        if (same.length) m = same[0];
      }
      if (m && !busy.has(m.id)) {
        busy.set(m.id, sub);
        bound.add(sub.id);
      }
    }

    members.forEach((m, index) => {
      const sub = busy.get(m.id);
      const soleOfRole = byRole(m.role).length === 1;
      const req = openReqs.find((r) => r.from === m.id || (soleOfRole && r.from === m.role));
      const mine = (i) => i.to === m.id || (soleOfRole && i.to === m.role);
      const hist = history.filter((h) => h.cwd === team.cwd && (h.memberId === m.id || (!h.memberId && soleOfRole && h.role === m.role)));
      info[m.id] = {
        running: !!sub,
        open_issues: team.issues.filter((i) => mine(i) && OPEN_ISSUE.has(i.status)).length,
        fixed_issues: team.issues.filter((i) => mine(i) && (i.status === 'fixed' || i.status === 'closed')).length,
        reopened_now: team.issues.filter((i) => mine(i) && i.status === 'reopened').length,
        dispatches: hist.length,
        done: hist.filter((h) => h.result?.kind === 'done').length,
        last: hist[0] ? { name: hist[0].name, endedAt: hist[0].endedAt, result: hist[0].result } : null,
        tokens: hist.reduce((sum, h) => sum + (h.tokens || 0), 0),
        tokens_known: hist.filter((h) => h.tokens).length,
        perf: perf.members[m.id],
      };
      out.push({
        id: `m|${team.cwd}|${m.id}`,
        memberId: m.id,
        member: true,
        rosterIndex: index,
        name: m.name || m.id,
        role: ROLES[m.role] ? m.role : null,
        level: m.level || '',
        color: ROLES[m.role]?.color || colorFor(m.id),
        cwd: team.cwd,
        parentId: lead.id,
        isSub: false,
        state: sub ? sub.state : 'idle',
        waiting: !!req || !!sub?.waiting,
        detail: req ? `⛔ ${req.id}: ${req.title}` : sub ? sub.detail : 'livre',
        perf: perf.members[m.id]?.class ? { score: perf.members[m.id].score, icon: perf.members[m.id].class.icon, key: perf.members[m.id].class.key } : null,
        updatedAt: Date.now(),
      });
    });
  }
  return { members: out, bound, memberInfo, perfByTeam };
}

// ---------------------------------------------------------------- respostas pelo escritório

const DECISIONS = { approve: 'approved', deny: 'denied', answer: 'answered' };
const DECISION_LABEL = { approve: 'Aprovado', deny: 'Negado', answer: 'Resposta' };
const TO_ROLES = new Set(['lead', 'frontend', 'qa', 'designer', 'backend']);

function taskDirFor({ cwd, task }) {
  const team = teams.get(cwd);
  if (!team || team.task !== task) throw new Error('task não encontrada (ela ainda está ativa?)');
  return join(teamDirFor(cwd), 'tasks', task);
}

function setFrontmatter(text, updates) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) throw new Error('arquivo sem frontmatter');
  const lines = m[1].split(/\r?\n/);
  for (const [k, v] of Object.entries(updates)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}:`));
    if (i >= 0) lines[i] = `${k}: ${v}`;
    else lines.push(`${k}: ${v}`);
  }
  return text.replace(m[0], `---\n${lines.join('\n')}\n---`);
}

const oneLine = (t) => String(t || '').replace(/\r?\n+/g, ' ⏎ ').trim().slice(0, 1500);

async function answerRequest(data) {
  const dir = taskDirFor(data);
  if (!/^REQ-[A-Z0-9]{2,6}-\d{3}$/.test(data.id || '')) throw new Error('id de REQ inválido');
  if (!DECISIONS[data.decision]) throw new Error('decisão inválida');
  if (data.decision === 'answer' && !String(data.text || '').trim()) throw new Error('escreva a resposta');

  const file = join(dir, 'requests', `${data.id}.md`);
  const text = await readFile(file, 'utf8');
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
  const note = oneLine(data.text);
  let out = setFrontmatter(text, {
    status: DECISIONS[data.decision],
    decided_by: 'user',
    decided_at: stamp,
    user_decision: data.decision,
    user_note: note,
    lead_notified: 'false',
  });
  out = out.trimEnd() + `\n\n## Resposta do usuário (escritório, ${stamp})\n- Decisão: ${DECISION_LABEL[data.decision]}\n` + (note ? `- Texto: ${note}\n` : '');
  out += `\n- ${stamp} · usuário (escritório) · ${DECISION_LABEL[data.decision].toLowerCase()}\n`;
  await writeFile(file, out);
  return { id: data.id };
}

async function sendMessage(data) {
  const dir = taskDirFor(data);
  const team = teams.get(data.cwd);
  const text = String(data.text || '').trim().slice(0, 4000);
  if (!text) throw new Error('mensagem vazia');
  const msg = { id: `MSG-${Date.now()}`, text, at: new Date().toISOString(), delivered: false };

  if (data.to === 'lead') {
    msg.to = 'lead';
  } else {
    const members = membersOf(team);
    const m = members.find((x) => x.id === data.to);
    if (!m && !TO_ROLES.has(data.to)) throw new Error('destinatário inválido');
    if (m) {
      msg.member = m.id;
      msg.member_name = m.name || m.id;
      // entrega direta só quando ele é o único do papel rodando agora; senão o líder repassa
      const { members: live } = buildTeamAgents();
      const runningSameRole = live.filter((x) => x.cwd === data.cwd && x.role === m.role && x.state !== 'idle');
      const meRunning = runningSameRole.some((x) => x.memberId === m.id);
      msg.to = ROLES[m.role] && meRunning && runningSameRole.length === 1 ? m.role : 'lead';
    } else {
      msg.to = data.to;
    }
  }
  await appendFile(join(dir, 'inbox.jsonl'), JSON.stringify(msg) + '\n');
  return { id: msg.id };
}

async function fireMember(data) {
  const dir = taskDirFor(data);
  const team = teams.get(data.cwd);
  const m = membersOf(team).find((x) => x.id === data.member);
  if (!m) throw new Error('membro não encontrado');
  const reason = String(data.reason || '').trim().slice(0, 1000);
  const text = [
    `🚪 DESLIGAMENTO pelo escritório: o usuário quer desligar ${m.name || m.id} (${m.id}).`,
    reason ? `Motivo: ${reason}` : 'Motivo: não informado.',
    'Como: seção 11.5 do protocolo. Se ele estiver rodando, espere terminar o disparo atual. Marque status: fired no roster com fire_reason, reatribua as issues abertas dele e registre na seção 9 do spec. Se o escopo dele continuar com trabalho, diga no escritório quem assume (ou contrate um substituto).',
  ].join('\n');
  const msg = { id: `MSG-${Date.now()}`, to: 'lead', kind: 'fire', fire: { member: m.id, name: m.name || m.id, reason }, text, at: new Date().toISOString(), delivered: false };
  await appendFile(join(dir, 'inbox.jsonl'), JSON.stringify(msg) + '\n');
  return { id: msg.id };
}

// contratar: vira uma mensagem estruturada pro líder, entregue pelo mesmo caminho das outras
const HIRE_ROLES = { frontend: 'Front', qa: 'QA', designer: 'Designer', backend: 'Back', specialist: 'Especialista' };
const HIRE_WHEN = {
  now: 'agora, em paralelo ao que já está rodando',
  next: 'assim que terminar a rodada atual',
  later: 'depois de fechar a task atual',
};

async function hireAgent(data) {
  const dir = taskDirFor(data);
  const role = String(data.role || '');
  if (!HIRE_ROLES[role]) throw new Error('papel inválido');
  const task = String(data.task_text || '').trim().slice(0, 3000);
  if (!task) throw new Error('descreva a tarefa');
  const when = HIRE_WHEN[data.when] ? data.when : 'now';
  const title = String(data.title || '').trim().slice(0, 60);
  if (role === 'specialist' && !title) throw new Error('dê um nome pro especialista (ex.: Performance, Acessibilidade)');

  const count = Math.min(5, Math.max(1, Number(data.count) || 1));
  const level = ['junior', 'pleno', 'senior'].includes(data.level) ? data.level : 'senior';
  const scope = String(data.scope || '').trim().slice(0, 500);
  const who =
    (count > 1 ? `${count} membros ` : 'um membro ') +
    (role === 'specialist' ? `especialista "${title}"` : `${HIRE_ROLES[role]} (\`${role}\`)`) +
    ` nível ${level}`;
  const how =
    role === 'specialist'
      ? `Dispare um subagente general-purpose apresentado como "${title}", com o caminho do spec e do PROTOCOL.md. Ele trabalha SOMENTE LEITURA e entrega relatório/issues em arquivo; qualquer edição de código passa por REQ.`
      : `Dispare um subagente \`team-${role}\` com essa tarefa, o caminho do spec e a rodada atual. Se já houver outro ${HIRE_ROLES[role]} rodando, divida arquivos/escopo entre eles pra não haver conflito.`;
  const text = [
    `🧑‍💼 CONTRATAÇÃO pelo escritório: o usuário quer ${who}.`,
    `Tarefa: ${task}`,
    scope ? `Escopo (arquivos/módulos): ${scope}` : 'Escopo: defina você, sem sobrepor o de outros membros.',
    `Quando: ${HIRE_WHEN[when]}.`,
    `Adicione ${count > 1 ? 'cada um' : 'ele'} ao roster (seção 11.1, hired_by: user) com id, prefixo e escopo próprios${count > 1 ? ', dividindo a tarefa entre eles sem colisão de arquivos' : ''}.`,
    `Como: ${how}`,
    'Registre a contratação no spec (seção 9, decisões registradas). Se a tarefa conflitar com o spec aprovado, pergunte antes. Quando o agente terminar, responda a esta mensagem no escritório com o resultado.',
  ].join('\n');

  const msg = {
    id: `MSG-${Date.now()}`,
    to: 'lead',
    kind: 'hire',
    hire: { role, title: title || HIRE_ROLES[role], when, task, count, level, scope },
    text,
    at: new Date().toISOString(),
    delivered: false,
  };
  await appendFile(join(dir, 'inbox.jsonl'), JSON.stringify(msg) + '\n');
  return { id: msg.id };
}

function scheduleTeamRead(cwd) {
  clearTimeout(teamTimers.get(cwd));
  teamTimers.set(
    cwd,
    setTimeout(async () => {
      if (await readTeam(cwd)) broadcast();
    }, 250),
  );
}


// ---------------------------------------------------------------- líder pela tela (Claude Code sem terminal)
// Falar com o líder num andar sem sessão aberta inicia `claude -p` naquela pasta, em segundo plano,
// sempre continuando a mesma conversa (--resume). A resposta vai chegando no chat.

const HOME_FWD = normCwd(homedir());
const KIT_FWD = normCwd(KIT_DIR);
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'Task', 'TodoWrite', 'WebSearch', 'WebFetch'];
const TEAM_EDIT = [`Edit(//${HOME_FWD.replace(/^\/+/, '')}/.agent-office/projects/**)`, 'Edit(~/.agent-office/projects/**)'];
const SAFE_BASH = [
  'git status', 'git diff', 'git log', 'git show', 'git branch', 'git checkout -b', 'git switch -c', 'git fetch',
  'ls', 'dir', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'mkdir', 'pwd', 'echo', 'type',
  'npm run', 'npm test', 'npm ls', 'pnpm run', 'pnpm test', 'pnpm exec', 'pnpm lint', 'pnpm build', 'pnpm typecheck', 'pnpm ls',
  'yarn run', 'yarn test', 'yarn lint', 'yarn build', 'bun run', 'bun test',
  'npx tsc', 'npx eslint', 'npx vitest', 'npx jest', 'npx playwright test', 'npx prettier --check',
  'curl -s -m 2 http://localhost:4000/health', 'curl -s -m 2 http://127.0.0.1:4000/health',
  // no Windows o comando vai por uma linha do cmd: regra sem aspas (o líder é orientado a chamar assim)
  ...(process.platform === 'win32' ? [] : [`node "${KIT_FWD}/hooks/`]),
  `node ${KIT_FWD}/hooks/`,
].map((c) => `Bash(${c}:*)`);

const LEAD_MODES = {
  cauteloso: { label: 'Cauteloso', permissionMode: 'default', allowed: [...READ_TOOLS, ...TEAM_EDIT, 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', `Bash(node ${KIT_FWD}/hooks/:*)`] },
  equilibrado: { label: 'Equilibrado', permissionMode: 'acceptEdits', allowed: [...READ_TOOLS, 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', ...TEAM_EDIT, ...SAFE_BASH] },
  livre: { label: 'Livre', permissionMode: 'bypassPermissions', allowed: [] },
};

const runners = new Map(); // cwd → { proc, sessionIds:Set, queue:[], current }
const leadChats = new Map(); // cwd → [{ id, from, text, at, status, activity, replyTo, cost, tokens }]
const chatTimers = new Map();
let pushTimer = null;
const pushSoon = () => {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => broadcast(), 300);
};

function runnerOf(cwd) {
  if (!runners.has(cwd)) runners.set(cwd, { proc: null, sessionIds: new Set(), queue: [], current: null });
  return runners.get(cwd);
}

function metaFile(cwd) {
  return join(ensureProject(cwd), 'project.json');
}
function readMeta(cwd) {
  try {
    return JSON.parse(readFileSync(metaFile(cwd), 'utf8'));
  } catch {
    return {};
  }
}
function writeMeta(cwd, patch) {
  const file = metaFile(cwd);
  writeFileSync(file, JSON.stringify({ ...readMeta(cwd), ...patch }, null, 2) + '\n');
}

function chatOf(cwd) {
  if (!leadChats.has(cwd)) {
    let list = [];
    try {
      list = readFileSync(join(teamDirFor(cwd), 'lead-chat.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      list = [];
    }
    // o que ficou "rodando" quando o escritório fechou não está mais rodando
    for (const e of list) if (e.status === 'running' || e.status === 'queued') e.status = 'interrupted';
    leadChats.set(cwd, list);
  }
  return leadChats.get(cwd);
}
function saveChat(cwd) {
  clearTimeout(chatTimers.get(cwd));
  chatTimers.set(
    cwd,
    setTimeout(() => {
      const list = chatOf(cwd).slice(-300);
      writeFile(join(ensureProject(cwd), 'lead-chat.jsonl'), list.map((e) => JSON.stringify(e)).join('\n') + '\n').catch(() => {});
    }, 500),
  );
}

function leadArgs(mode, sessionId, cwd) {
  const m = LEAD_MODES[mode] || LEAD_MODES.equilibrado;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', m.permissionMode];
  if (m.allowed.length) args.push('--allowedTools', m.allowed.join(','));
  if (sessionId) args.push('--resume', sessionId);
  const system = [
    'Você está sendo usado pelo Escritório de agentes, sem terminal: o usuário lê suas respostas num chat que renderiza markdown e responde por lá.',
    `Nível de autonomia deste andar: ${m.label}.`,
    'Se uma ferramenta ou comando for negado por permissão, não tente contornar: diga numa linha o que precisa e por quê, e siga com o que der. O usuário pode trocar o nível no escritório.',
    'Quando precisar de uma decisão do usuário (gates do /team, dúvidas), termine a resposta com a pergunta; a próxima mensagem dele continua esta conversa.',
    `TEAM_DIR = ${normCwd(teamDirFor(cwd))}`,
    `KIT_DIR = ${KIT_FWD}`,
    `Scripts do kit: chame sem aspas, exatamente assim: node ${KIT_FWD}/hooks/team-score.mjs (e team-dir.mjs).`,
  ].join('\n');
  args.push('--append-system-prompt', system);
  return args;
}

// no Windows o `claude` costuma ser um .cmd → precisa de shell; argumentos vão entre aspas
function spawnClaude(args, cwd) {
  const cfg = (() => {
    try {
      return JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8'));
    } catch {
      return {};
    }
  })();
  const bin = cfg.claudePath || 'claude';
  const env = { ...process.env, AGENT_OFFICE_HEADLESS: '1' };
  if (process.platform === 'win32') {
    const q = (a) => `"${String(a).replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
    return spawn([q(bin), ...args.map(q)].join(' '), { cwd, shell: true, windowsHide: true, env });
  }
  return spawn(bin, args, { cwd, env });
}

function pump(cwd) {
  const r = runnerOf(cwd);
  if (r.proc || !r.queue.length) return;
  const userId = r.queue.shift();
  const chat = chatOf(cwd);
  const user = chat.find((e) => e.id === userId);
  if (!user) return pump(cwd);
  user.status = 'sent';

  const meta = readMeta(cwd);
  const reply = { id: `L-${Date.now()}`, from: 'lead', replyTo: user.id, text: '', at: new Date().toISOString(), status: 'running', activity: 'iniciando o Claude Code…' };
  chat.push(reply);
  r.current = reply;

  let proc;
  try {
    proc = spawnClaude(leadArgs(meta.lead_mode, meta.lead_session, cwd), cwd);
  } catch (err) {
    reply.status = 'error';
    reply.text = `Não consegui iniciar o Claude Code: ${err.message}`;
    r.current = null;
    saveChat(cwd);
    pushSoon();
    return pump(cwd);
  }
  r.proc = proc;
  let buf = '';
  let errTail = '';

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      if (j.session_id && !r.sessionIds.has(j.session_id)) {
        r.sessionIds.add(j.session_id);
        if (meta.lead_session !== j.session_id) writeMeta(cwd, { lead_session: j.session_id });
      }
      if (j.type === 'assistant') {
        for (const c of j.message?.content || []) {
          if (c.type === 'text' && c.text?.trim()) reply.text += (reply.text ? '\n\n' : '') + c.text.trim();
          if (c.type === 'tool_use') reply.activity = `usando ${c.name}${c.input?.description ? `: ${String(c.input.description).slice(0, 60)}` : ''}`;
        }
      }
      if (j.type === 'result') {
        if (j.result && !reply.text) reply.text = String(j.result);
        if (j.total_cost_usd != null) reply.cost = j.total_cost_usd;
        const u = j.usage || {};
        const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (tokens) reply.tokens = tokens;
        if (j.is_error) reply.status = 'error';
      }
      pushSoon();
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (c) => (errTail = (errTail + c).slice(-2000)));
  proc.stdin.on('error', () => {});
  proc.stdin.end(user.text);

  const finish = (code, err) => {
    if (r.proc !== proc) return;
    r.proc = null;
    r.current = null;
    reply.activity = '';
    if (/not logged in|please run \/login|invalid api key|oauth token has expired/i.test(`${reply.text}\n${errTail}`)) {
      reply.status = 'error';
      reply.needsLogin = true;
      if (login.status === 'ok') setLogin('idle');
      reply.text =
        '🔑 **O Claude Code deste computador não está logado** (ou o login expirou).\n\n' +
        'Clique em **Entrar na conta do Claude** aqui embaixo: vai abrir uma janela do terminal com o Claude Code. ' +
        'Nela, escolha entrar com a sua conta do Claude, termine o login no navegador e depois digite `/exit`.\n\n' +
        'Pronto: é só mandar a sua mensagem de novo aqui no chat.';
    }
    if (reply.status === 'running') reply.status = code === 0 ? 'done' : reply.stopped ? 'stopped' : 'error';
    if (reply.status === 'error' && !reply.text) {
      const notFound = err?.code === 'ENOENT' || /not recognized|não é reconhecido|command not found/i.test(errTail);
      reply.text = notFound
        ? 'Não encontrei o Claude Code neste computador. Instale e faça login (`claude login`); se ele estiver instalado num caminho diferente, informe em `claudePath` no `~/.agent-office/config.json`.'
        : `O Claude Code terminou com erro.\n\n\`\`\`\n${errTail.trim().slice(-800) || `código ${code}`}\n\`\`\``;
    }
    saveChat(cwd);
    pushSoon();
    pump(cwd);
  };
  proc.on('close', (code) => finish(code));
  proc.on('error', (err) => finish(-1, err));
  saveChat(cwd);
  pushSoon();
}

function interactiveLeadOnline(cwd) {
  const r = runnerOf(cwd);
  return [...agents.values()].some((a) => !a.isSub && a.cwd === cwd && !r.sessionIds.has(a.id) && Date.now() - a.updatedAt < STALE_MS);
}

// ---------------------------------------------------------------- login do Claude Code
// Abre uma janela com o Claude Code, espera ela fechar e confere se o login funcionou de verdade.

const login = { status: 'idle', message: '', at: null }; // idle | open | checking | ok | failed
function setLogin(status, message = '') {
  Object.assign(login, { status, message, at: new Date().toISOString() });
  pushSoon();
}

// chamada mínima ao Claude Code: diz se está logado (e com acesso) ou não
function probeLogin() {
  return new Promise((resolve) => {
    let out = '';
    let proc;
    try {
      proc = spawnClaude(['-p', '--output-format', 'json', '--max-turns', '1'], homedir());
    } catch {
      return resolve({ ok: false, reason: 'Não consegui iniciar o Claude Code.' });
    }
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* já saiu */
      }
      resolve({ ok: false, reason: 'O Claude Code demorou demais pra responder. Tente de novo.' });
    }, 60_000);
    proc.stdout.on('data', (c) => (out += c));
    proc.stderr.on('data', (c) => (out += c));
    proc.stdin.on('error', () => {});
    proc.stdin.end('Responda apenas: ok');
    proc.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: 'Não encontrei o Claude Code neste computador.' });
    });
    proc.on('close', () => {
      clearTimeout(timer);
      if (/not logged in|please run \/login|invalid api key|oauth token has expired/i.test(out)) {
        return resolve({ ok: false, reason: 'O login não foi concluído: a janela foi fechada antes de terminar.' });
      }
      if (/"is_error"\s*:\s*true|subscription|credit balance|not available|upgrade/i.test(out)) {
        const detail = (/"result"\s*:\s*"([^"]{0,200})/.exec(out) || [])[1];
        return resolve({ ok: false, reason: `Entrou, mas a conta não conseguiu usar o Claude Code${detail ? `: ${detail}` : ''}. No plano gratuito ele não funciona; precisa do Pro/Max ou de créditos no Claude Console.` });
      }
      resolve({ ok: /"result"/.test(out) || /\bok\b/i.test(out), reason: 'Não consegui confirmar o login. Tente de novo.' });
    });
  });
}

async function finishLogin() {
  setLogin('checking', 'Conferindo o login…');
  const r = await probeLogin();
  setLogin(r.ok ? 'ok' : 'failed', r.ok ? 'Login feito! Pode mandar a mensagem de novo.' : r.reason);
}

function openLogin() {
  if (login.status === 'open' || login.status === 'checking') return { status: login.status };
  if (process.platform === 'win32') {
    // processo "detached" no Windows ganha janela própria; o 'exit' avisa quando ela é fechada
    const win = spawn('cmd.exe', ['/c', 'claude'], { detached: true, stdio: 'ignore', windowsHide: false });
    win.on('error', () => setLogin('failed', 'Não consegui abrir a janela do terminal.'));
    win.on('exit', () => finishLogin());
    win.unref();
    setLogin('open', 'Janela do terminal aberta: faça o login lá e depois digite /exit (ou feche a janela).');
    return { status: 'open' };
  }
  if (process.platform === 'darwin') {
    // o Terminal do Mac não avisa quando fecha: confere o login de tempos em tempos (até 6 min)
    spawn('osascript', ['-e', 'tell application "Terminal" to do script "claude"', '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref();
    setLogin('open', 'Terminal aberto: faça o login lá e depois digite /exit.');
    const started = Date.now();
    const tick = async () => {
      if (login.status !== 'open') return;
      const r = await probeLogin();
      if (r.ok) return setLogin('ok', 'Login feito! Pode mandar a mensagem de novo.');
      if (Date.now() - started > 6 * 60_000) return setLogin('failed', 'O login não foi concluído a tempo. Tente de novo.');
      setTimeout(tick, 10_000);
    };
    setTimeout(tick, 15_000);
    return { status: 'open' };
  }
  throw new Error('abra um terminal e rode: claude');
}

// reenvia a mensagem que falhou por falta de login
async function leadRetry({ cwd, id }) {
  const floorCwd = normCwd(cwd);
  const failed = chatOf(floorCwd).find((e) => e.id === id);
  const original = failed && chatOf(floorCwd).find((e) => e.id === failed.replyTo);
  if (!original) throw new Error('não achei a mensagem original');
  failed.retried = true;
  if (login.status === 'ok' || login.status === 'failed') setLogin('idle');
  return leadSend({ cwd: floorCwd, text: original.text });
}

async function leadSend({ cwd, text }) {
  const floorCwd = normCwd(cwd);
  const msg = String(text || '').trim().slice(0, 8000);
  if (!msg) throw new Error('mensagem vazia');
  if (/^\/login\b/i.test(msg)) {
    openLogin();
    // (o bloco abaixo registra a conversa; os botões de acompanhamento aparecem no chat)
    const at = new Date().toISOString();
    chatOf(floorCwd).push(
      { id: `U-${Date.now()}`, from: 'user', text: msg, at, status: 'sent' },
      {
        id: `L-${Date.now() + 1}`,
        from: 'lead',
        text: 'Abri uma janela do terminal com o Claude Code pra você entrar na sua conta. Termine o login no navegador e digite `/exit` nela: eu confiro aqui se deu certo.',
        at,
        status: 'done',
        needsLogin: true,
        replyTo: [...chatOf(floorCwd)].reverse().find((e) => e.from === 'user' && !/^\/login\b/i.test(e.text))?.id,
      },
    );
    saveChat(floorCwd);
    return { route: 'login' };
  }
  const team = teams.get(floorCwd);
  // tem task do time e uma sessão aberta no terminal/VS Code → entrega nela, como antes
  if (team?.task && interactiveLeadOnline(floorCwd)) {
    const r = await sendMessage({ cwd: floorCwd, task: team.task, to: 'lead', text: msg });
    return { route: 'inbox', id: r.id };
  }
  if (!existsSync(floorCwd)) throw new Error('a pasta desse andar não existe mais neste computador');
  const entry = { id: `U-${Date.now()}`, from: 'user', text: msg, at: new Date().toISOString(), status: 'queued' };
  chatOf(floorCwd).push(entry);
  runnerOf(floorCwd).queue.push(entry.id);
  saveChat(floorCwd);
  pump(floorCwd);
  return { route: 'office', id: entry.id };
}

function leadStop({ cwd }) {
  const r = runnerOf(normCwd(cwd));
  if (!r.proc) return { stopped: false };
  if (r.current) r.current.stopped = true;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(r.proc.pid), '/T', '/F'], { windowsHide: true });
  else r.proc.kill('SIGTERM');
  return { stopped: true };
}

function leadMode({ cwd, mode }) {
  if (!LEAD_MODES[mode]) throw new Error('nível inválido');
  writeMeta(normCwd(cwd), { lead_mode: mode });
  return { mode };
}

function leadState(cwd) {
  const r = runnerOf(cwd);
  return {
    entries: chatOf(cwd).slice(-80),
    running: !!r.proc,
    queued: r.queue.length,
    mode: readMeta(cwd).lead_mode || 'equilibrado',
    route: teams.get(cwd)?.task && interactiveLeadOnline(cwd) ? 'inbox' : 'office',
  };
}


// ---------------------------------------------------------------- atualização automática

const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const UPDATE_REPO = PKG.agentOffice?.repo || 'Junior331/agent-office';
const updateInfo = { current: PKG.version, latest: null, notes: '', available: false, updating: false, checkedAt: null };

const semver = (v) => String(v || '0').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
function newer(a, b) {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function checkUpdate() {
  try {
    const res = await fetch(`https://github.com/${UPDATE_REPO}/releases/latest/download/version.json`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const info = await res.json();
    updateInfo.latest = info.version;
    updateInfo.notes = info.notes || '';
    updateInfo.available = newer(info.version, PKG.version);
    updateInfo.checkedAt = new Date().toISOString();
    broadcast();
  } catch {
    /* sem internet ou sem release ainda: tenta mais tarde */
  }
}
setTimeout(checkUpdate, 10_000);
setInterval(checkUpdate, 6 * 60 * 60 * 1000);

function startUpdate() {
  if (!updateInfo.available) throw new Error('já está na versão mais nova');
  updateInfo.updating = true;
  broadcast();
  const child =
    process.platform === 'win32'
      ? spawn(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', join(ROOT, 'scripts', 'update.ps1'), '-Repo', UPDATE_REPO, '-App', ROOT],
          { detached: true, stdio: 'ignore', windowsHide: true },
        )
      : spawn('bash', [join(ROOT, 'scripts', 'update.sh'), UPDATE_REPO, ROOT], { detached: true, stdio: 'ignore' });
  child.unref();
  return { updating: true };
}

// ---------------------------------------------------------------- andares: adicionar pela tela

const SCAN_ROOTS = ['Documents', 'Documentos', 'source', 'repos', 'Repos', 'projects', 'Projetos', 'projetos', 'dev', 'Dev', 'code', 'workspace', 'Desktop', 'git', 'www'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'AppData', 'Library', '.cache', 'coverage']);

// procura repositórios git nas pastas comuns do usuário (rápido e com limite)
function scanRepos() {
  const found = [];
  const deadline = Date.now() + 3000;
  const visit = (dir, depth) => {
    if (found.length >= 150 || depth > 4 || Date.now() > deadline) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === '.git')) {
      found.push(normCwd(dir));
      return; // não desce dentro de um repositório
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) visit(join(dir, e.name), depth + 1);
    }
  };
  const home = homedir();
  for (const r of SCAN_ROOTS) if (existsSync(join(home, r))) visit(join(home, r), 0);
  const known = new Set(registry.map((p) => p.cwd.toLowerCase()));
  return [...new Set(found)].sort().map((p) => ({ path: p, name: basename(p), added: known.has(p.toLowerCase()) }));
}

function addFloor({ path }) {
  const dir = normCwd(String(path || '').trim().replace(/^"|"$/g, ''));
  if (!dir) throw new Error('informe a pasta do projeto');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('essa pasta não existe neste computador');
  const teamDir = ensureProject(dir);
  const meta = join(teamDir, 'project.json');
  const data = JSON.parse(readFileSync(meta, 'utf8'));
  if (data.hidden) writeFileSync(meta, JSON.stringify({ ...data, hidden: false }, null, 2) + '\n');
  scheduleTeamRead(dir);
  return { cwd: dir };
}

function hideFloor({ cwd }) {
  const p = registry.find((x) => x.cwd === normCwd(cwd));
  if (!p) throw new Error('andar não encontrado');
  const meta = join(p.teamDir, 'project.json');
  writeFileSync(meta, JSON.stringify({ ...JSON.parse(readFileSync(meta, 'utf8')), hidden: true }, null, 2) + '\n');
  return { cwd: p.cwd };
}

// andares registrados (~/.agent-office/projects): aparecem mesmo sem sessão aberta
let registry = [];
function refreshRegistry() {
  try {
    registry = listProjects().filter((p) => !p.hidden);
  } catch {
    registry = [];
  }
}
refreshRegistry();

// arquivos da task mudam sem passar pelos hooks (ex.: você editando na mão) → relê a cada 4s
setInterval(async () => {
  refreshRegistry();
  const cwds = new Set([...agents.values()].map((a) => a.cwd).filter(Boolean));
  for (const p of registry) cwds.add(p.cwd);
  for (const cwd of teams.keys()) cwds.add(cwd);
  let changed = false;
  for (const cwd of cwds) if (await readTeam(cwd)) changed = true;
  if (changed) broadcast();
}, 4000);

function broadcast() {
  try {
    tgCheck();
  } catch {
    /* notificação nunca derruba o escritório */
  }
  const msg = snapshot();
  for (const client of wss.clients) if (client.readyState === 1) client.send(msg);
}

wss.on('connection', (ws) => ws.send(snapshot()));

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, a] of agents) {
    if (now - a.updatedAt > STALE_MS) {
      removeAgent(id);
      changed = true;
    }
  }
  if (changed) broadcast();
}, 60_000);


// ---------------------------------------------------------------- Telegram (falar com o time pelo celular)
// Configuração em config.json (gerado por: npm run telegram:setup -- <TOKEN_DO_BOT>).
// Só o chat_id configurado é atendido. Usa long polling: não precisa abrir porta nem expor o PC.

let officeConfig = {};
try {
  officeConfig = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
} catch {
  officeConfig = {};
}
const TG_CONF = officeConfig.telegram?.token && officeConfig.telegram?.chat_id ? officeConfig.telegram : null;
const TG_API = TG_CONF ? `https://api.telegram.org/bot${TG_CONF.token}` : null;
const tgStarted = Date.now();
const tg = { floor: null, to: 'lead', awaiting: null, keys: new Map(), seq: 0, floors: [], contacts: [] };
const tgSeen = { reqs: new Set(), replies: new Set(), lead: new Set() };

async function tgCall(method, body) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(40_000),
  });
  return res.json();
}
function tgSend(text, extra = {}) {
  if (!TG_API) return Promise.resolve();
  const body = String(text);
  const chunks = [];
  for (let i = 0; i < body.length; i += 3800) chunks.push(body.slice(i, i + 3800));
  return chunks.reduce(
    (p, chunk, i) => p.then(() => tgCall('sendMessage', { chat_id: TG_CONF.chat_id, text: chunk, disable_web_page_preview: true, ...(i === chunks.length - 1 ? extra : {}) })),
    Promise.resolve(),
  ).catch(() => {});
}
function tgKey(value) {
  const k = `k${++tg.seq}`;
  tg.keys.set(k, value);
  if (tg.keys.size > 500) tg.keys.delete(tg.keys.keys().next().value);
  return k;
}
function tgName(t, id) {
  if (!id) return '?';
  if (id === 'lead') return 'Líder';
  return t?.roster?.find((m) => m.id === id)?.name || ROLES[id]?.label || id;
}
function tgFloors() {
  const map = new Map();
  for (const p of registry) map.set(p.cwd, { cwd: p.cwd, project: p.name, title: p.name, task: null });
  for (const t of teams.values()) map.set(t.cwd, t);
  return [...map.values()].sort((a, b) => a.project.localeCompare(b.project));
}
function tgCurrentTeam() {
  const floors = tgFloors();
  return floors.find((t) => t.cwd === tg.floor) || floors[0] || null;
}

// avisa no celular: pedidos de permissão novos e respostas novas dos agentes
function tgCheck() {
  if (!TG_API) return;
  const quiet = Date.now() - tgStarted < 15_000; // o que já existia quando o escritório subiu não vira notificação
  for (const [cwd, list] of leadChats) {
    for (const e of list) {
      if (e.from !== 'lead' || e.status === 'running' || tgSeen.lead.has(e.id)) continue;
      tgSeen.lead.add(e.id);
      if (quiet || !e.text) continue;
      tgSend(`💬 Líder · ${basename(cwd)}\n\n${e.text}`);
    }
  }
  for (const t of teams.values()) {
    for (const r of t.requests.filter((x) => x.status === 'open')) {
      const k = `${t.cwd}|${r.id}`;
      if (tgSeen.reqs.has(k)) continue;
      tgSeen.reqs.add(k);
      if (quiet) continue;
      const key = tgKey({ cwd: t.cwd, task: t.task, id: r.id });
      tgSend(`⛔ ${t.project} · ${r.id}\n${tgName(t, r.from)} precisa de você (${r.type}${r.blocking === 'true' ? ', bloqueando' : ''}):\n\n${r.title}`, {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Aprovar', callback_data: `a|${key}` },
            { text: '❌ Negar', callback_data: `d|${key}` },
            { text: '💬 Responder', callback_data: `r|${key}` },
          ]],
        },
      });
    }
    for (const [id, rep] of Object.entries(t.replies || {})) {
      const k = `${t.cwd}|${id}`;
      if (tgSeen.replies.has(k)) continue;
      tgSeen.replies.add(k);
      if (quiet) continue;
      tgSend(`💬 ${tgName(t, rep.from)} · ${t.project}\n\n${rep.text}`);
    }
  }
}

function tgStatus(t) {
  const { members } = buildTeamAgents();
  const mine = members.filter((m) => m.cwd === t.cwd);
  const open = t.issues.filter((i) => OPEN_ISSUE.has(i.status));
  const sev = (s) => open.filter((i) => i.severity === s).length;
  const reqs = t.requests.filter((r) => r.status === 'open');
  const lines = [
    `🏢 ${t.project} · ${t.title}`,
    `Equipe: ${mine.length} · trabalhando: ${mine.filter((m) => m.state !== 'idle').length}`,
    `Issues abertas: P0 ${sev('P0')} · P1 ${sev('P1')} · P2 ${sev('P2')}`,
    reqs.length ? `⛔ ${reqs.length} pedido(s) esperando você: ${reqs.map((r) => r.id).join(', ')}` : 'Nenhum pedido esperando você.',
    '',
    ...mine.filter((m) => m.state !== 'idle' || m.waiting).slice(0, 10).map((m) => `${m.waiting ? '✋' : '●'} ${m.name}: ${m.detail}`),
  ];
  return lines.join('\n');
}

async function tgHandle(u) {
  const chatId = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
  if (String(chatId) !== String(TG_CONF.chat_id)) return; // só o dono

  if (u.callback_query) {
    const [kind, key] = String(u.callback_query.data || '').split('|');
    const v = tg.keys.get(key);
    await tgCall('answerCallbackQuery', { callback_query_id: u.callback_query.id }).catch(() => {});
    if (!v) return tgSend('Esse botão expirou. Use /status pra ver o que está aberto.');
    if (kind === 'a' || kind === 'd') {
      try {
        await answerRequest({ cwd: v.cwd, task: v.task, id: v.id, decision: kind === 'a' ? 'approve' : 'deny', text: 'via Telegram' });
        await readTeam(v.cwd);
        broadcast();
        return tgSend(`${kind === 'a' ? '✅ Aprovado' : '❌ Negado'}: ${v.id}. O líder recebe na próxima ação.`);
      } catch (err) {
        return tgSend(`Não deu: ${err.message}`);
      }
    }
    if (kind === 'r') {
      tg.awaiting = v;
      return tgSend(`Escreva a resposta pro ${v.id} (a próxima mensagem vai como resposta).`);
    }
    if (kind === 'f') {
      tg.floor = v.cwd;
      tg.to = 'lead';
      return tgSend(`🏢 Agora no andar ${basename(v.cwd)}. Falando com o Líder. /equipe pra escolher outra pessoa.`);
    }
    if (kind === 't') {
      tg.floor = v.cwd;
      tg.to = v.to;
      return tgSend(`💬 Agora falando com ${v.name}. É só escrever.`);
    }
    return;
  }

  const text = String(u.message?.text || '').trim();
  if (!text) return;

  if (tg.awaiting && !text.startsWith('/')) {
    const v = tg.awaiting;
    tg.awaiting = null;
    try {
      await answerRequest({ cwd: v.cwd, task: v.task, id: v.id, decision: 'answer', text });
      await readTeam(v.cwd);
      broadcast();
      return tgSend(`💬 Resposta registrada no ${v.id}.`);
    } catch (err) {
      return tgSend(`Não deu: ${err.message}`);
    }
  }

  const [cmd] = text.split(/\s+/);
  if (cmd === '/start' || cmd === '/ajuda' || cmd === '/help') {
    return tgSend(
      'Escritório do time conectado.\n\n' +
        'Escreva normalmente: vai pra pessoa selecionada (começa no Líder).\n' +
        '/andares escolher o projeto\n/equipe escolher com quem falar\n/status resumo do andar atual\n\n' +
        'Pedidos de permissão chegam aqui com botões, e as respostas dos agentes também.',
    );
  }
  if (cmd === '/andares') {
    const floors = tgFloors();
    if (!floors.length) return tgSend('Nenhum projeto com time ativo (/team) agora.');
    return tgSend('Escolha o andar:', {
      reply_markup: { inline_keyboard: floors.map((t) => [{ text: `${t.cwd === tgCurrentTeam()?.cwd ? '📍 ' : ''}${t.project} · ${t.title}`.slice(0, 60), callback_data: `f|${tgKey({ cwd: t.cwd })}` }]) },
    });
  }
  const t = tgCurrentTeam();
  if (!t) return tgSend('Nenhum andar ainda. Abra o Claude Code num projeto ou adicione um andar no escritório.');
  if (cmd === '/status') return tgSend(t.task ? tgStatus(t) : `🏢 ${t.project} · sem time ativo. Escreva pro Líder pra começar.`);
  if (cmd === '/equipe' || cmd === '/para') {
    const { members } = buildTeamAgents();
    const mine = members.filter((m) => m.cwd === t.cwd);
    const rows = [[{ text: `${tg.to === 'lead' ? '📍 ' : ''}Líder`, callback_data: `t|${tgKey({ cwd: t.cwd, to: 'lead', name: 'Líder' })}` }]];
    for (const m of mine) rows.push([{ text: `${tg.to === m.memberId ? '📍 ' : ''}${m.state !== 'idle' ? '● ' : '○ '}${m.name}`.slice(0, 60), callback_data: `t|${tgKey({ cwd: t.cwd, to: m.memberId, name: m.name })}` }]);
    return tgSend(`Com quem falar em ${t.project}?`, { reply_markup: { inline_keyboard: rows.slice(0, 40) } });
  }
  if (cmd.startsWith('/')) return tgSend('Comando desconhecido. /ajuda');

  try {
    if (tg.to === 'lead') {
      const r = await leadSend({ cwd: t.cwd, text });
      broadcast();
      return tgSend(r.route === 'office' ? `📨 O Líder de ${t.project} está trabalhando nisso. A resposta chega aqui.` : `📨 Entregue ao Líder na sessão aberta de ${t.project}. A resposta chega aqui.`);
    }
    if (!t.task) return tgSend('Esse andar ainda não tem time: fale com o Líder.');
    await sendMessage({ cwd: t.cwd, task: t.task, to: tg.to, text });
    await readTeam(t.cwd);
    broadcast();
    return tgSend(`📨 Enviado pra ${tgName(t, tg.to)} (${t.project}). A resposta chega aqui.`);
  } catch (err) {
    return tgSend(`Não enviado: ${err.message}`);
  }
}

async function tgLoop() {
  let offset = 0;
  for (;;) {
    try {
      const r = await tgCall('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      for (const u of r.result || []) {
        offset = u.update_id + 1;
        await tgHandle(u).catch(() => {});
      }
    } catch {
      await sleep(5000);
    }
  }
}
if (TG_API) {
  tgLoop();
  console.log('📱 Telegram conectado.');
}

servers[0].on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`O escritório já está rodando na porta ${PORT}.`);
    process.exit(0);
  }
  throw err;
});
servers[0].listen(PORT, '127.0.0.1', () => {
  console.log(`🏢 Escritório rodando em http://localhost:${PORT}`);
  console.log('   Esperando eventos do Claude Code em POST /event');
});
servers[1].on('error', () => {}); // máquina sem IPv6: segue só no IPv4
servers[1].listen(PORT, '::1');
