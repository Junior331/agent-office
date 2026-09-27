// Onde o escritório guarda as coisas. Usado pelo servidor, pelo setup e por todos os hooks.
//
//   ~/.agent-office/
//     config.json                 { officeDir }
//     kit/                        protocolo, templates, hooks (cópia instalada pelo setup)
//     projects/<nome>-<hash>/     dados do time de UM projeto (fora do repositório)
//       project.json              { cwd, name, addedAt, hidden }
//       permissions.json, roster.json, usage.json, efficiency.md, ACTIVE, tasks/…

import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';

export const HOME = process.env.AGENT_OFFICE_HOME || join(homedir(), '.agent-office');
export const KIT_DIR = join(HOME, 'kit');
export const PROJECTS_DIR = join(HOME, 'projects');
export const TEAM_PREFIX = '@TEAM'; // como os arquivos do time aparecem pras regras de permissão

const isWin = process.platform === 'win32';

/** "c:\\Users\\x\\proj\\" → "C:/Users/x/proj" (o Windows aceita / em qualquer API de arquivo) */
export function normCwd(cwd) {
  if (!cwd) return cwd;
  let p = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^[a-z]:\//i.test(p)) p = p[0].toUpperCase() + p.slice(1);
  return p;
}

const slug = (s) =>
  String(s || 'projeto')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'projeto';

export function projectId(cwd) {
  const norm = normCwd(cwd);
  const key = isWin ? norm.toLowerCase() : norm;
  return `${slug(basename(norm))}-${createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
}

export function teamDirFor(cwd) {
  return normCwd(join(PROJECTS_DIR, projectId(cwd)));
}

/** garante a pasta do projeto e o project.json (registra o "andar") */
export function ensureProject(cwd) {
  const norm = normCwd(cwd);
  const dir = teamDirFor(norm);
  mkdirSync(dir, { recursive: true });
  const meta = join(dir, 'project.json');
  if (!existsSync(meta)) {
    writeFileSync(meta, JSON.stringify({ cwd: norm, name: basename(norm), addedAt: new Date().toISOString(), hidden: false }, null, 2) + '\n');
  }
  const perms = join(dir, 'permissions.json');
  const defaults = join(KIT_DIR, 'permissions.default.json');
  if (!existsSync(perms) && existsSync(defaults)) copyFileSync(defaults, perms);
  return dir;
}

export function listProjects() {
  if (!existsSync(PROJECTS_DIR)) return [];
  const out = [];
  for (const id of readdirSync(PROJECTS_DIR)) {
    try {
      const meta = JSON.parse(readFileSync(join(PROJECTS_DIR, id, 'project.json'), 'utf8'));
      out.push({ id, ...meta, cwd: normCwd(meta.cwd), teamDir: normCwd(join(PROJECTS_DIR, id)) });
    } catch {
      /* pasta sem project.json: ignora */
    }
  }
  return out;
}

/**
 * Caminho como as regras de permissão enxergam:
 *   arquivo do time    → "@TEAM/tasks/…"
 *   arquivo do projeto → "src/…"
 *   qualquer outro     → null (fora do projeto)
 */
export function rulepath(file, projectDir) {
  const abs = normCwd(file);
  const team = teamDirFor(projectDir);
  const proj = normCwd(projectDir);
  const cmp = (a) => (isWin ? a.toLowerCase() : a);
  if (cmp(abs) === cmp(team) || cmp(abs).startsWith(cmp(team) + '/')) return TEAM_PREFIX + abs.slice(team.length);
  if (cmp(abs) === cmp(proj)) return '';
  if (cmp(abs).startsWith(cmp(proj) + '/')) return abs.slice(proj.length + 1);
  return null;
}
