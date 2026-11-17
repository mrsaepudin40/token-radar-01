// A token-radar-01 entry (Node 22, standard library only), model radar-2.
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the model in lib/model.ts, writes the ranked board to /output/board.json, and
// copies this repository's dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board.
//
// radar-2, the model this program runs: each category's multiple is the median mcap/TVL of the
// snapshot's own live protocols in that category, shrunk toward the global median and capped when the
// category has few comps, so the market itself prices the launch. The board carries the whole watchlist
// plus every rankable protocol below the floor, each with a chain-aware farm plan.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, chainBreakdown, dataScript, dataScriptExtended, parseSnapshot, topMovers } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const movers = topMovers(board);
const chains = chainBreakdown(board);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));
// The dashboard's Top Movers and Chain Breakdown panels read the same board from data.js:
// rewrite it with the movers and the chain table merged in, so one file still carries the page.
writeFileSync(join(out, 'data.js'), dataScriptExtended(radar, movers, chains));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
// The dashboard's text must fit the gate's cap: check before the dossier is built,
// so an over-size dashboard fails here with the file named, not inside the dossier.
let dashboardBytes = 0;
for (const name of readdirSync(join(here, 'dashboard'))) {
  const path = join(here, 'dashboard', name);
  if (statSync(path).isFile()) dashboardBytes += statSync(path).size;
}
if (dashboardBytes > TEXT_MAX_BYTES) {
  process.stderr.write(`token radar: dashboard/ holds ${dashboardBytes} bytes of text: keep it at most ${TEXT_MAX_BYTES} bytes\n`);
  process.exit(1);
}
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
if (shots.length > SCREENSHOT_CAPS.max) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in at most ${SCREENSHOT_CAPS.max}\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  if (!/\.(png|jpe?g)$/i.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: hand in PNG or JPEG images only\n`);
    process.exit(1);
  }
  const bytes = statSync(join(here, 'screenshots', name)).size;
  if (bytes > SCREENSHOT_CAPS.max_bytes) {
    process.stderr.write(`token radar: screenshots/${name} is ${bytes} bytes: keep each image at most ${SCREENSHOT_CAPS.max_bytes} bytes\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);

// The movers and the chain table, for the console as well as the dashboard: the week's momentum
// and where the board's implied value sits, without opening the page.
const topGainer = movers.gainers[0];
const topLoser = movers.losers[0];
const topChain = chains.chains[0];
process.stdout.write(
  `token radar: movers ${movers.recorded} recorded (${movers.risers} up, ${movers.fallers} down, ${movers.flat} flat, ${movers.unrecorded} unrecorded) — top gainer ${topGainer ? `${topGainer.name} ${topGainer.growth_pct}%` : 'none'}, steepest faller ${topLoser ? `${topLoser.name} ${topLoser.growth_pct}%` : 'none'}\n` +
    `token radar: chains ${chains.chains.length} — top ${topChain ? `${topChain.chain}: ${topChain.protocols} protocols, $${topChain.total_implied_value_usd.toLocaleString('en-US')} implied (${topChain.share_pct}% of board)` : 'none'}; top 3 chains hold ${chains.top3_share_pct}%\n`,
);
