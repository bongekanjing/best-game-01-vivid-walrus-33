// The entry's program (Node 22, standard library only): Wickfall is this directory's game/ folder,
// plain static files a desktop browser loads offline (game/index.html and the ES modules beside it,
// no library and no network request). This script hands it in: it copies game/ and screenshots/
// from beside this file to /output and writes /output/dossier.json, the summary the judge reads,
// with the vendored make.fun library.
//
// Wickfall is a top-down arena survival game. A moth carries the last flame through ten waves of the
// dark: it throws sparks, dashes through danger and blooms light once its meter fills with motes,
// and between waves it drafts one of three boons that change the numbers it fights with. A run
// lasts around two minutes and ends in a win (all ten waves held) or a loss, with a score either way.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others
// refuse an entry the scorer would refuse (more than 4 screenshots or one over 256 KiB; more than
// 993 files in game/ or 48 MiB of game files, in all, or a path under game/ over 1000 bytes: game/
// counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

// Say what was written, so a local run is checkable at a glance.
console.log(`Wickfall: wrote ${out}/game, ${out}/screenshots and ${out}/dossier.json`);
