// The agent's blind spot, read from published records: of the works Qloo measured for an audience, how many the
// agent's frozen prediction already named, and of the works the agent predicted, how many Qloo measured. Counts come
// from each record's own measurement (the Taste Brief's marks), so the gallery, the site and
// scripts/blind-spot-stats.mjs all read the same numbers from the same files, and anyone can recompute them from the
// gallery bundle of a release.
import fs from 'node:fs/promises';
import path from 'node:path';

/** One record's blind spot, or null when it measured nothing (a design made without Qloo). */
export function blindSpotOf(record) {
  const counts = record?.measured?.counts;
  if (!counts || !(counts.works > 0)) return null;
  return {
    works: counts.works, known: counts.worksPredicted ?? 0, guessed: counts.predictions ?? 0, confirmed: counts.predictionsMeasured ?? 0,
    ...(counts.qualities ? { qualities: counts.qualities, qualitiesKnown: counts.qualitiesPredicted ?? 0 } : {}),
    ...(record.prediction?.frozenAt ? { frozenAt: record.prediction.frozenAt } : {}),
  };
}

const share = (part, whole) => whole ? Math.round(1000 * part / whole) / 1000 : null;

/**
 * Totals over [{id, host, medium, blindSpot}]. Two records of one frozen prediction (a comparison and its Qloo arm)
 * count once. missed is the share of measured works the prediction did not name; confirmed is the share of predicted
 * works Qloo measured.
 */
export function blindSpotTotals(items) {
  const seen = new Set(), counted = [];
  for (const item of items) {
    if (!item?.blindSpot) continue;
    const key = item.blindSpot.frozenAt ? `${item.host}:${item.blindSpot.frozenAt}` : `id:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counted.push(item);
  }
  const sum = list => {
    const works = list.reduce((total, item) => total + item.blindSpot.works, 0), known = list.reduce((total, item) => total + item.blindSpot.known, 0);
    const guessed = list.reduce((total, item) => total + item.blindSpot.guessed, 0), confirmed = list.reduce((total, item) => total + item.blindSpot.confirmed, 0);
    return { sessions: list.length, works, known, missed: share(works - known, works), guessed, confirmed, confirmedShare: share(confirmed, guessed) };
  };
  const hosts = [...new Set(counted.map(item => item.host))].sort();
  return { ...sum(counted), byHost: Object.fromEntries(hosts.map(host => [host, sum(counted.filter(item => item.host === host))])) };
}

/**
 * The benchmark's results (docs/benchmark/results.json) pooled over its agents: runs, audiences, measured works and the
 * works the sealed guesses named, or null without results.
 */
export function benchmarkTotals(benchmark) {
  const hosts = Object.values(benchmark?.hosts || {});
  if (!hosts.length) return null;
  const works = hosts.reduce((total, row) => total + (row.pooled?.known?.whole || 0), 0), known = hosts.reduce((total, row) => total + (row.pooled?.known?.part || 0), 0);
  if (!works) return null;
  return { runs: hosts.reduce((total, row) => total + (row.runs || 0), 0), audiences: benchmark.measurable ?? null, agents: hosts.length, works, known, missed: share(works - known, works) };
}

/** The records of a built gallery folder (gallery.json and each entry's report/record.json), as items for the totals. */
export async function readGalleryBlindSpots(dir) {
  const index = JSON.parse(await fs.readFile(path.join(dir, 'gallery.json'), 'utf8'));
  const items = [];
  for (const entry of index.entries || []) {
    const record = JSON.parse(await fs.readFile(path.join(dir, entry.id, 'report', 'record.json'), 'utf8').catch(() => 'null'));
    items.push({ id: entry.id, title: entry.title, host: entry.host, medium: entry.medium, kind: entry.kind, blindSpot: blindSpotOf(record) });
  }
  return items;
}
