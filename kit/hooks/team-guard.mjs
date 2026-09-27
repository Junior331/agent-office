#!/usr/bin/env node
/**
 * team-guard — hook PreToolUse que aplica a matriz de permissões do time.
 *
 * - Só atua em subagentes cujo tipo é um papel conhecido (frontend, qa, designer, backend).
 *   A sessão principal (líder) e outros agentes passam direto.
 * - Bloqueio = exit 2 + mensagem no stderr. O Claude Code devolve essa mensagem
 *   ao agente, que é instruído a abrir um REQ em vez de contornar.
 * - Os dados do time ficam FORA do projeto (~/.agent-office/projects/…); nas regras eles aparecem como "@TEAM/…".
 * - Lê permissions.json e o grants.json da task ativa a cada chamada:
 *   grant adicionado ou removido vale na hora.
 * - Nunca quebra o Claude Code: qualquer erro interno libera a ação e registra em log.
 */

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { teamDirFor, rulepath, normCwd } from './paths.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read']);

// Arquivos que nenhum grant libera (protegem o próprio sistema de permissões)
const HARD_DENY = [
  '@TEAM/permissions.json',
  '@TEAM/roster.json',
  '@TEAM/usage.json',
  '@TEAM/efficiency.md',
  '@TEAM/project.json',
  '@TEAM/ACTIVE',
  '@TEAM/tasks/*/grants.json',
  '@TEAM/tasks/*/inbox.jsonl',
  '.claude/settings*.json',
  '.git/**',
];

const ROLE_PREFIX = { frontend: 'FE', qa: 'QA', designer: 'DS', backend: 'BE' };

// ------------------------------------------------------------------ util

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

function escapeRe(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        continue;
      }
      re += '(?:' + glob.slice(i + 1, end).split(',').map(escapeRe).join('|') + ')';
      i = end;
    } else {
      re += escapeRe(c);
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

function matchesAny(path, globs) {
  return globs.some((g) => globToRe(g).test(path));
}

function expand(list, paths) {
  return (list || []).flatMap((g) => (g.startsWith('@') ? paths[g.slice(1)] || [] : [g]));
}

// "src/x.ts", "@TEAM/tasks/…" ou null (fora do projeto e do time)
function toRel(projectDir, file) {
  const abs = isAbsolute(file) ? file : resolve(projectDir, file);
  return rulepath(abs, projectDir);
}

// ------------------------------------------------------------------ main

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let projectDir = process.cwd();
  try {
    const payload = JSON.parse(raw || '{}');
    projectDir = normCwd(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());
    const teamDir = teamDirFor(projectDir);

    if (process.env.TEAM_GUARD_DEBUG === '1') {
      appendFileSync(
        join(teamDir, 'guard-debug.log'),
        `${new Date().toISOString()} keys=${Object.keys(payload).join(',')} agent_type=${payload.agent_type ?? '-'} tool=${payload.tool_name}\n`,
      );
    }

    const perms = readJson(join(teamDir, 'permissions.json'), null);
    if (!perms) process.exit(0);

    const role = String(payload.agent_type || payload.subagent_type || process.env.CLAUDE_AGENT_TYPE || '').toLowerCase();
    const roleCfg = perms.roles?.[role];
    if (!roleCfg) process.exit(0); // líder ou agente fora do time

    const taskId = readText(join(teamDir, 'ACTIVE'));
    const taskDir = taskId ? join(teamDir, 'tasks', taskId) : null;
    const grants = taskDir ? readJson(join(taskDir, 'grants.json'), []).filter((g) => g.role === role) : [];

    const paths = perms.paths || {};
    const g = perms.global || {};
    const tool = payload.tool_name;
    const input = payload.tool_input || {};

    const block = (reason) => deny({ role, reason, taskId, taskDir, tool, input });

    // ---------------------------------------------- escrita
    if (WRITE_TOOLS.has(tool)) {
      const file = input.file_path || input.notebook_path || input.path;
      if (!file) process.exit(0);
      const rel = toRel(projectDir, file);

      if (rel === null) return block(`escrever fora do projeto (${file})`);
      if (matchesAny(rel, HARD_DENY)) return block(`editar arquivo protegido do sistema de permissões (${rel}) — nenhum agente edita isso`);

      const grantAllow = grants.flatMap((x) => expand(x.write_allow, paths));
      if (matchesAny(rel, grantAllow)) process.exit(0);

      const denyList = [...expand(g.write_deny, paths), ...expand(roleCfg.write_deny, paths)];
      if (matchesAny(rel, denyList)) return block(`editar '${rel}' (fora do escopo do papel ${role})`);

      const allowList = [
        ...expand(roleCfg.write_allow, paths),
        ...(perms.backend_mode === 'same-repo' ? expand(roleCfg.write_allow_same_repo, paths) : []),
      ];
      if (matchesAny(rel, allowList)) process.exit(0);

      return block(`editar '${rel}' (o papel ${role} só edita: ${allowList.join(', ') || 'nada'})`);
    }

    // ---------------------------------------------- leitura
    if (READ_TOOLS.has(tool)) {
      const file = input.file_path;
      if (!file) process.exit(0);
      const rel = toRel(projectDir, file);
      if (rel === null) process.exit(0); // leitura fora do projeto: o próprio Claude Code controla
      const readAllow = [...expand(g.read_allow, paths), ...grants.flatMap((x) => expand(x.read_allow, paths))];
      if (matchesAny(rel, readAllow)) process.exit(0);
      if (matchesAny(rel, expand(g.read_deny, paths))) return block(`ler '${rel}' (arquivo sensível: segredo/credencial)`);
      process.exit(0);
    }

    // ---------------------------------------------- bash
    if (tool === 'Bash') {
      const cmd = String(input.command || '');
      const grantBash = grants.flatMap((x) => x.bash_allow || []);
      if (grantBash.some((re) => new RegExp(re, 'i').test(cmd))) process.exit(0);

      for (const re of [...(g.bash_deny || []), ...(roleCfg.bash_deny || [])]) {
        if (new RegExp(re, 'i').test(cmd)) return block(`rodar o comando \`${cmd.slice(0, 120)}\` (bloqueado pela regra /${re}/)`);
      }

      if (roleCfg.bash_restricted_writes) {
        const target = findBashWriteViolation(cmd, projectDir, expand(roleCfg.bash_write_allow, paths), grants.flatMap((x) => expand(x.write_allow, paths)));
        if (target) return block(`escrever em '${target}' via terminal (o papel ${role} não edita esse caminho; não contorne o Edit/Write pelo Bash)`);
      }
      process.exit(0);
    }

    process.exit(0);
  } catch (err) {
    try {
      appendFileSync(join(teamDirFor(projectDir), 'guard-error.log'), `${new Date().toISOString()} ${err.stack}\n`);
    } catch {
      /* sem onde logar */
    }
    process.exit(0); // guard com defeito nunca trava o trabalho
  }
});

// ------------------------------------------------------------------ bash com escrita

const WRITE_OPS =
  /(^|[^<>&0-9])>{1,2}(?!&)|\btee\b|\bsed\s+-[a-z]*i|\bperl\s+-[a-z]*i|\b(mv|cp|touch|mkdir|ln|rm|truncate|dd|install)\b|Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Copy-Item|Move-Item|writeFile|appendFile|open\([^)]*['"]w/i;

function findBashWriteViolation(cmd, projectDir, allow, grantAllow) {
  const cleaned = cmd
    .replace(/\d?>&\d/g, ' ')
    .replace(/\d?>{1,2}\s*(\/dev\/null|nul|NUL)\b/g, ' ');
  if (!WRITE_OPS.test(cleaned)) return null;

  const tokens = cleaned
    .split(/[\s'"`()=,;|&<>]+/)
    .filter((t) => t && !t.startsWith('-') && !/^[a-z]+:\/\//i.test(t) && !/^[sy]\/.*\/.*$/.test(t))
    .filter((t) => t.includes('/') || t.includes('\\') || /\.[a-z0-9]{1,5}$/i.test(t));

  if (!tokens.length) return 'destino não identificado';
  for (const t of tokens) {
    const rel = toRel(projectDir, t.replace(/[*]+$/, ''));
    if (rel === null) return t;
    if (matchesAny(rel, HARD_DENY)) return rel;
    const ok = matchesAny(rel, allow) || matchesAny(rel, grantAllow) || allow.some((a) => a.replace(/\*.*$/, '').startsWith(rel + '/'));
    if (!ok) return rel;
  }
  return null;
}

// ------------------------------------------------------------------ bloqueio

function deny({ role, reason, taskId, taskDir, tool, input }) {
  const prefix = ROLE_PREFIX[role] || role.toUpperCase();
  const reqDir = taskId ? `${normCwd(taskDir)}/requests/` : '<TEAM_DIR>/tasks/<TASK-ID>/requests/';

  if (taskDir) {
    try {
      mkdirSync(taskDir, { recursive: true });
      appendFileSync(
        join(taskDir, 'guard.log'),
        `${new Date().toISOString()} · ${role} · ${tool} · ${reason} · ${JSON.stringify(input).slice(0, 300)}\n`,
      );
    } catch {
      /* ignora */
    }
  }

  process.stderr.write(
    [
      `⛔ BLOQUEADO pelo team-guard: o papel "${role}" não tem permissão para ${reason}.`,
      '',
      'NÃO tente contornar (outra ferramenta, Bash, outro caminho, pedir pra outro agente).',
      'Se isso for necessário para avançar, siga o protocolo (seção 6 do <KIT_DIR>/PROTOCOL.md):',
      `  1. Crie ${reqDir}REQ-<SEU-PREFIXO>-NNN.md (ex.: REQ-${prefix}1-001) a partir de <KIT_DIR>/templates/request.md,`,
      '     com o escopo exato do que precisa, por quê, alternativa mais segura e impacto se negado.',
      `  2. Atualize seu status (${taskId ? normCwd(taskDir) : '<TEAM_DIR>/tasks/<TASK-ID>'}/status/<seu-id>.md) para state: blocked e blocked_by: <id do REQ>.`,
      '  3. Continue o que for possível sem essa permissão.',
      '  4. Encerre respondendo ao líder com a primeira linha: ⛔ PERMISSION_REQUEST <id do REQ>',
      'Se NÃO for necessário, siga por um caminho dentro do seu escopo.',
    ].join('\n') + '\n',
  );
  process.exit(2);
}
