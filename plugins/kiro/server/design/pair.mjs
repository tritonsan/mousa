// The two arms of a comparison as their folders hold them: where each arm's taste came from, its frozen prediction and
// its DNA's anchors, and the heuristic distance between the two designs. design_compare reports it and the comparison
// report draws it, so the tool and the page give the same numbers.

import fs from 'node:fs/promises';
import { designFingerprint, compareDesignFingerprints, normalizeTasteName } from '../culture/taste.mjs';
import { readState, resolveInProject } from '../production/project-files.mjs';
import { collectProjectFiles } from './systems.mjs';
import { dataFingerprint, compareDataFingerprints, differingFiles } from './distance.mjs';

/** What a design folder's own records say: where its taste came from, its frozen prediction and its DNA's anchors. */
export async function armRecord(root, folder) {
  const { file } = await resolveInProject(root, folder);
  const real = await fs.realpath(file).catch(() => null);
  if (!real) return null;
  const [input, prediction, dnaRecord] = await Promise.all(['taste/input', 'taste/prediction', 'design/dna'].map(name => readState(real, name).catch(() => null)));
  if (!input && !dnaRecord) return null;
  const stats = dnaRecord?.dna?.stats;
  const source = input?.source === 'qloo-profile' ? 'qloo' : input?.source === 'model-assumption' ? 'own prediction' : 'unknown';
  return {
    medium: dnaRecord?.medium || null,
    prediction: prediction ? JSON.stringify({ entries: (prediction.entries || []).map(entry => [entry.domain, normalizeTasteName(entry.name)]), sketch: prediction.designSketch || null }) : null,
    summary: { taste: source, ...(stats ? { devices: stats.devices, layers: stats.layers, qualityAnchoredDevices: stats.qualityAnchoredDevices,
      ...(source === 'qloo' ? { surpriseAnchoredDevices: stats.surpriseAnchoredDevices, headline: `${stats.surpriseAnchoredDevices} of ${stats.devices} devices rest on what the prediction did not contain.` } : {}),
      ...(stats.sketchMoves ? { sketchMoves: stats.sketchMoves } : {}) } : {}) },
  };
}

/**
 * The distance between the designs in two folders of the project, with each arm's record. A folder without pages,
 * styles or scripts comes back as `empty`. Two game or source designs keep their look in data, which pages and
 * stylesheets do not show, so they are measured by the files they changed differently.
 */
export async function pairDistance(root, folders) {
  const sets = [];
  for (const folder of folders) {
    const { file } = await resolveInProject(root, folder);
    const files = await collectProjectFiles(file);
    if (!Object.keys(files).length) return { empty: folder };
    sets.push(files);
  }
  const arms = [];
  for (const folder of folders) arms.push(await armRecord(root, folder));
  const both = arms.every(Boolean);
  const same = both && arms[0].prediction && arms[0].prediction === arms[1].prediction;
  const data = both && arms.every(arm => ['game', 'generic'].includes(arm.medium));
  const distance = data ? compareDataFingerprints(...differingFiles(...sets).map(dataFingerprint)) : compareDesignFingerprints(...sets.map(designFingerprint));
  return { arms, both, samePrediction: Boolean(same), measure: data ? 'data' : 'design', distance };
}
