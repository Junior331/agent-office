#!/usr/bin/env node
// Imprime (e cria, se preciso) a pasta do time do projeto atual.
//   node "<KIT_DIR>/hooks/team-dir.mjs"            → pasta do time do diretório atual
//   node "<KIT_DIR>/hooks/team-dir.mjs" <projeto>  → de outro projeto
import { resolve } from 'node:path';
import { ensureProject, normCwd } from './paths.mjs';

const projectDir = resolve(process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
process.stdout.write(normCwd(ensureProject(projectDir)) + '\n');
