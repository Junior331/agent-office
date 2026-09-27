#!/usr/bin/env node
// SessionStart (global): registra o projeto como um andar do prédio e, se ele tiver time,
// diz ao Claude onde ficam os dados do time e o protocolo. Sem time → não imprime nada.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureProject, normCwd, KIT_DIR } from './paths.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(raw || '{}');
    const projectDir = normCwd(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());
    const teamDir = normCwd(ensureProject(projectDir));
    const hasTeam = existsSync(join(teamDir, 'roster.json')) || existsSync(join(teamDir, 'ACTIVE'));
    if (!hasTeam) process.exit(0);
    let task = '';
    try {
      task = readFileSync(join(teamDir, 'ACTIVE'), 'utf8').trim();
    } catch {
      task = '';
    }
    const text = [
      'Este projeto tem um time no escritório de agentes (dados fora do repositório).',
      `TEAM_DIR = ${teamDir}`,
      `KIT_DIR = ${normCwd(KIT_DIR)}`,
      `Protocolo: ${normCwd(join(KIT_DIR, 'PROTOCOL.md'))}`,
      task ? `Task ativa: ${task}. Antes de agir como líder nela, leia o protocolo.` : 'Nenhuma task ativa: /team começa uma.',
    ].join('\n');
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
  } catch {
    /* nunca atrapalha a sessão */
  }
  process.exit(0);
});
