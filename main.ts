// Sunscorch Yard entry program. Copies game/ and screenshots/ beside this
// file into the output directory and writes dossier.json with the kit's
// buildDossier. Node 22 standard library only, no network.
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

async function run() {
  const gameDir = join(here, 'game');
  const shotsDir = join(here, 'screenshots');
  await mkdir(outDir, { recursive: true });
  await cp(gameDir, join(outDir, 'game'), { recursive: true, dereference: false });
  await cp(shotsDir, join(outDir, 'screenshots'), { recursive: true, dereference: false });
  const dossier = buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  await writeFile(join(outDir, 'dossier.json'), dossier);
  console.log(`wrote ${join(outDir, 'dossier.json')} (${dossier.length} bytes)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
