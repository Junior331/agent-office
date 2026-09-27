#!/usr/bin/env node
/**
 * Setup do escritório de agentes. Roda UMA vez por usuário; nenhum projeto é tocado.
 *
 *   npm run setup                         instala/atualiza (kit, agentes, comandos, hooks globais)
 *   npm run setup -- status               mostra o que está instalado e os andares registrados
 *   npm run setup -- migrate <projeto>    traz um projeto do kit antigo (.claude/team) pro modelo novo
 *   npm run setup -- uninstall            remove agentes, comandos e hooks (os dados dos times ficam)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, cpSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = dirname(fileURLToPath(import.meta.url));
const { HOME, KIT_DIR, PROJECTS_DIR, normCwd, ensureProject, listProjects, teamDirFor } = await import('./kit/hooks/paths.mjs');
const CLAUDE = join(homedir(), '.claude');
const SETTINGS = join(CLAUDE, 'settings.json');
const MARK = 'agent-office';
const OLD_MARKS = ['--claude-office', 'claude-office/scripts/hook.mjs', 'claude-office\\scripts\\hook.mjs'];
const fwd = (p) => normCwd(p);

const [cmd = 'install', ...args] = process.argv.slice(2);
const ok = (m) => console.log(`✅ ${m}`);
const warn = (m) => console.log(`⚠️  ${m}`);
const info = (m) => console.log(`   ${m}`);

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
const withKit = (text) => text.replaceAll('<KIT_DIR>', fwd(KIT_DIR));
const isOurs = (file) => existsSync(file) && readFileSync(file, 'utf8').includes(`${MARK}:`);

// ------------------------------------------------------------------ hooks globais

const H = (script) => `node "${fwd(join(KIT_DIR, 'hooks', script))}"`;
function hookPlan(waitMinutes) {
  const ev = { type: 'command', command: H('events.mjs'), timeout: 5 };
  return [
    ['SessionStart', null, [{ type: 'command', command: H('context.mjs'), timeout: 5 }, ev]],
    ['UserPromptSubmit', null, [ev]],
    ['PreToolUse', '*', [ev]],
    ['PreToolUse', 'Write|Edit|MultiEdit|NotebookEdit|Read|Bash', [{ type: 'command', command: H('team-guard.mjs'), timeout: 10 }]],
    ['PostToolUse', '*', [ev, { type: 'command', command: H('team-inbox.mjs'), timeout: 10 }]],
    ['Notification', null, [ev]],
    ['Stop', null, [ev, { type: 'command', command: H('team-inbox.mjs'), timeout: waitMinutes * 60 + 60 }]],
    ['SubagentStop', null, [ev]],
    ['SessionEnd', null, [ev]],
  ];
}

function stripOurHooks(settings) {
  const isOld = (h) => {
    const c = String(h.command ?? '');
    return c.includes(fwd(KIT_DIR)) || c.includes('.agent-office') || OLD_MARKS.some((m) => c.includes(m));
  };
  for (const event of Object.keys(settings.hooks ?? {})) {
    const groups = settings.hooks[event]
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOld(h)) }))
      .filter((g) => g.hooks.length);
    if (groups.length) settings.hooks[event] = groups;
    else delete settings.hooks[event];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  const dirs = settings.permissions?.additionalDirectories;
  if (Array.isArray(dirs)) {
    settings.permissions.additionalDirectories = dirs.filter((d) => fwd(d) !== fwd(PROJECTS_DIR));
    if (!settings.permissions.additionalDirectories.length) delete settings.permissions.additionalDirectories;
  }
}

// ------------------------------------------------------------------ comandos

function install() {
  // 1. app e kit
  writeJson(join(HOME, 'config.json'), { ...readJson(join(HOME, 'config.json'), {}), officeDir: fwd(APP), installedAt: new Date().toISOString() });
  mkdirSync(PROJECTS_DIR, { recursive: true });
  rmSync(KIT_DIR, { recursive: true, force: true });
  cpSync(join(APP, 'kit'), KIT_DIR, { recursive: true });
  for (const f of ['PROTOCOL.md', ...readdirSync(join(KIT_DIR, 'templates')).map((t) => join('templates', t))]) {
    const p = join(KIT_DIR, f);
    writeFileSync(p, withKit(readFileSync(p, 'utf8')));
  }
  ok(`Kit instalado em ${fwd(KIT_DIR)}`);

  // 2. agentes e comandos do usuário (não sobrescreve arquivo que não é nosso)
  for (const kind of ['agents', 'commands']) {
    mkdirSync(join(CLAUDE, kind), { recursive: true });
    for (const f of readdirSync(join(KIT_DIR, kind))) {
      const target = join(CLAUDE, kind, f);
      if (existsSync(target) && !isOurs(target)) {
        warn(`${fwd(target)} já existe e não é do escritório; mantive o seu. Renomeie o seu se quiser o do time.`);
        continue;
      }
      writeFileSync(target, withKit(readFileSync(join(KIT_DIR, kind, f), 'utf8')));
    }
  }
  ok('Agentes (frontend, qa, designer, backend) e comandos (/team, /team-status, /team-grant) instalados pro seu usuário');

  // 3. hooks globais + permissão pra escrever na pasta dos times
  const settings = readJson(SETTINGS, {});
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.bak`);
  stripOurHooks(settings);
  settings.hooks ??= {};
  const wait = Number(readJson(join(KIT_DIR, 'permissions.default.json'), {}).office?.wait_minutes ?? 20);
  for (const [event, matcher, hooks] of hookPlan(wait)) {
    const group = { hooks };
    if (matcher) group.matcher = matcher;
    (settings.hooks[event] ??= []).push(group);
  }
  settings.permissions ??= {};
  settings.permissions.additionalDirectories = [...new Set([...(settings.permissions.additionalDirectories ?? []), fwd(PROJECTS_DIR)])];
  writeJson(SETTINGS, settings);
  ok(`Hooks globais em ${fwd(SETTINGS)} (backup em settings.json.bak)`);

  console.log('\nPronto. Nenhum projeto precisa de comando: abra o Claude Code em qualquer pasta e ela vira um andar.');
  info('Reinicie as sessões do Claude Code que estavam abertas.');
  info('Projeto que usava o kit antigo? npm run setup -- migrate "<caminho do projeto>"');
}

function uninstall() {
  const settings = readJson(SETTINGS, null);
  if (settings) {
    copyFileSync(SETTINGS, `${SETTINGS}.bak`);
    stripOurHooks(settings);
    writeJson(SETTINGS, settings);
    ok('Hooks removidos');
  }
  for (const kind of ['agents', 'commands']) {
    const dir = join(CLAUDE, kind);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (isOurs(join(dir, f))) rmSync(join(dir, f));
  }
  ok('Agentes e comandos do escritório removidos');
  info(`Os dados dos times continuam em ${fwd(PROJECTS_DIR)} (apague a pasta se quiser).`);
}

function status() {
  const cfg = readJson(join(HOME, 'config.json'), null);
  console.log(`App: ${cfg?.officeDir ?? '(não instalado)'}`);
  console.log(`Kit: ${existsSync(join(KIT_DIR, 'PROTOCOL.md')) ? fwd(KIT_DIR) : '(não instalado)'}`);
  const settings = readJson(SETTINGS, {});
  const hooks = JSON.stringify(settings.hooks ?? {});
  console.log(`Hooks globais: ${hooks.includes(fwd(KIT_DIR)) ? 'ok' : 'faltando (rode npm run setup)'}`);
  for (const a of ['frontend', 'qa', 'designer', 'backend']) {
    const f = join(CLAUDE, 'agents', `${a}.md`);
    console.log(`Agente ${a}: ${isOurs(f) ? 'ok' : existsSync(f) ? 'existe um seu com esse nome' : 'faltando'}`);
  }
  const projects = listProjects();
  console.log(`\nAndares (${projects.length}):`);
  for (const p of projects) console.log(`  ${p.name.padEnd(28)} ${p.cwd}${existsSync(join(p.teamDir, 'roster.json')) ? '  · com time' : ''}`);
}

function migrate(target) {
  if (!target) {
    console.error('Uso: npm run setup -- migrate "<caminho do projeto>"');
    process.exit(1);
  }
  const project = fwd(resolve(target));
  const old = join(project, '.claude', 'team');
  if (!existsSync(old)) {
    console.error(`Não achei ${fwd(old)}. Esse projeto não usa o kit antigo.`);
    process.exit(1);
  }
  const teamDir = ensureProject(project);

  // dados do time → fora do repositório
  const skip = new Set(['PROTOCOL.md', '_templates', 'permissions.json', '.guard-debug.log', '.guard-error.log']);
  for (const f of readdirSync(old)) {
    if (skip.has(f)) continue;
    cpSync(join(old, f), join(teamDir, f), { recursive: true });
  }
  // permissões: modelo novo, mantendo o que era específico do projeto (pastas de e2e/back, modo do back)
  const oldPerms = readJson(join(old, 'permissions.json'), {});
  const perms = readJson(join(KIT_DIR, 'permissions.default.json'), {});
  if (oldPerms.backend_mode) perms.backend_mode = oldPerms.backend_mode;
  if (oldPerms.paths?.e2e) perms.paths.e2e = oldPerms.paths.e2e;
  if (oldPerms.paths?.backend) perms.paths.backend = oldPerms.paths.backend;
  if (oldPerms.office) perms.office = oldPerms.office;
  writeJson(join(teamDir, 'permissions.json'), perms);
  ok(`Dados do time copiados pra ${fwd(teamDir)}`);

  // tira o kit antigo do projeto (vai pra um backup, nada é apagado)
  const backup = join(project, '.claude', `_agent-office-backup-${Date.now()}`);
  mkdirSync(backup, { recursive: true });
  const pending = [];
  const move = (rel) => {
    const from = join(project, rel);
    if (!existsSync(from)) return;
    const to = join(backup, rel.replace(/[\\/]/g, '__'));
    try {
      renameSync(from, to);
    } catch {
      // Windows: pasta aberta no VS Code/antivírus não deixa renomear → copia e tenta apagar
      try {
        cpSync(from, to, { recursive: true });
        rmSync(from, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      } catch {
        pending.push(rel);
        warn(`não consegui tirar ${rel} (em uso). Feche o VS Code e rode o migrate de novo.`);
        return;
      }
    }
    info(`movido: ${rel}`);
  };
  move('.claude/team');
  for (const a of ['frontend', 'qa', 'designer', 'backend']) {
    const f = join(project, '.claude', 'agents', `${a}.md`);
    if (existsSync(f) && readFileSync(f, 'utf8').includes('PROTOCOL.md')) move(`.claude/agents/${a}.md`);
  }
  for (const c of ['team.md', 'team-status.md', 'team-grant.md']) move(`.claude/commands/${c}`);
  for (const h of ['team-guard.mjs', 'team-inbox.mjs', 'team-score.mjs', 'install-team.mjs']) move(`.claude/hooks/${h}`);

  const ps = join(project, '.claude', 'settings.json');
  const pset = readJson(ps, null);
  if (pset?.hooks) {
    for (const event of Object.keys(pset.hooks)) {
      pset.hooks[event] = pset.hooks[event]
        .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !/team-guard|team-inbox/.test(String(h.command))) }))
        .filter((g) => g.hooks.length);
      if (!pset.hooks[event].length) delete pset.hooks[event];
    }
    if (!Object.keys(pset.hooks).length) delete pset.hooks;
    writeJson(ps, pset);
    info('hooks do kit antigo removidos de .claude/settings.json do projeto');
  }
  const md = join(project, 'CLAUDE.md');
  if (existsSync(md)) {
    const text = readFileSync(md, 'utf8');
    const cleaned = text.replace(/<!-- team:start -->[\s\S]*?<!-- team:end -->\n?/, '');
    if (cleaned !== text) {
      writeFileSync(md, cleaned);
      info('bloco do time removido do CLAUDE.md');
    }
  }
  if (pending.length) {
    warn(`Migração incompleta: ${pending.length} item(ns) em uso. Os dados do time já estão no lugar novo; feche o VS Code e rode o mesmo comando de novo.`);
    return;
  }
  ok(`Projeto migrado. Backup do kit antigo em ${fwd(backup)}`);
  info('Se o CLAUDE.md tiver regras suas sobre o time (ex.: "sem agente backend"), elas continuam valendo.');
}

if (cmd === 'install') install();
else if (cmd === 'uninstall') uninstall();
else if (cmd === 'status') status();
else if (cmd === 'migrate') migrate(args[0]);
else {
  console.error(`Comando desconhecido: ${cmd}. Use install, status, migrate ou uninstall.`);
  process.exit(1);
}
