// The agents' blind spot across a built gallery: of the works Qloo measured, how many each frozen prediction already
// named, and of the works predicted, how many Qloo measured. Reads only the gallery's published records, so the same
// numbers come out of the release's gallery bundle:
//   node scripts/blind-spot-stats.mjs [gallery folder] [--json]
// The folder defaults to this machine's DATA_DIR/gallery. No network, no model.
import path from 'node:path';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { readGalleryBlindSpots, blindSpotTotals } from '../src/gallery/blind-spot.mjs';

const args = process.argv.slice(2);
loadDotEnv();
const dir = path.resolve(args.find(arg => !arg.startsWith('--')) || path.join(getConfig().dataDir, 'gallery'));
const items = await readGalleryBlindSpots(dir);
const totals = blindSpotTotals(items);
if (args.includes('--json')) {
  console.log(JSON.stringify({ gallery: dir, items, totals }, null, 2));
} else {
  const percent = value => value === null ? 'n/a' : `${(100 * value).toFixed(1)}%`;
  for (const item of items) {
    const spot = item.blindSpot;
    console.log(`${item.id.padEnd(34)} ${item.host.padEnd(12)} ${spot ? `knew ${String(spot.known).padStart(2)} of ${String(spot.works).padStart(3)} measured works; ${spot.confirmed} of ${spot.guessed} guesses measured` : 'no Qloo measurement'}`);
  }
  console.log(`\n${totals.sessions} sessions: ${totals.works - totals.known} of ${totals.works} measured works (${percent(totals.missed)}) were not in the frozen prediction; ${totals.confirmed} of ${totals.guessed} predicted works (${percent(totals.confirmedShare)}) were measured.`);
  for (const [host, row] of Object.entries(totals.byHost)) console.log(`  ${host.padEnd(12)} ${row.sessions} sessions: missed ${percent(row.missed)}, guesses measured ${percent(row.confirmedShare)}`);
}
