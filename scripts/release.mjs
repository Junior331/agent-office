#!/usr/bin/env node
// Gera dist/agent-office.zip e dist/version.json pra uma release do GitHub.
//   node scripts/release.mjs 0.2.0 "o que mudou"
// Normalmente quem roda isso é o GitHub Actions ao criar a tag v0.2.0 (veja .github/workflows/release.yml).
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] || '').replace(/^v/, '');
const notes = process.argv[3] || '';
const pkgFile = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
if (version) {
  pkg.version = version;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
}

const dist = join(ROOT, 'dist');
const stage = join(dist, 'agent-office');
rmSync(dist, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const skip = new Set(['node_modules', 'dist', '.git', '.github', 'config.json', 'history.json', 'office.log', 'update.log']);
for (const entry of ['server.js', 'setup.mjs', 'install.ps1', 'install.sh', 'package.json', 'package-lock.json', 'README.md', 'kit', 'public', 'scripts']) {
  if (existsSync(join(ROOT, entry)) && !skip.has(entry)) cpSync(join(ROOT, entry), join(stage, entry), { recursive: true });
}
execSync('zip -rq agent-office.zip agent-office', { cwd: dist });
rmSync(stage, { recursive: true, force: true });
writeFileSync(join(dist, 'version.json'), JSON.stringify({ version: pkg.version, notes, date: new Date().toISOString() }, null, 2) + '\n');
console.log(`dist/agent-office.zip e dist/version.json prontos (versão ${pkg.version})`);
