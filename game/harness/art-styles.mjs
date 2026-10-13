// Render styles from art styles. The taste pass derives the audience's art styles from the art_style tags Qloo returns
// on the measured works; the game reads each one's name with the render vocabulary in scene.js, so Pixel Art stands for
// the pixel style and Cel-shaded visuals for cel. Both steps are deterministic: a render device anchored to an art style
// draws in that style's preset, so the frame's style follows the data rather than the designer's guess.

import { presetForArtStyle } from '../src/scene.js';
import { ART_STYLE_DOMAIN, isQualityDomain } from '../../plugin/server/culture/taste.mjs';

const round = value => Number(value.toFixed(3));

/** The preset a taste ref's name stands for, or null: art styles and other qualities alike. */
export const refPreset = entity => (entity && isQualityDomain(entity.domain) ? presetForArtStyle(entity.name) : null);

/**
 * The render styles a run can draw from, strongest first: in a measured run each preset's measured art styles, scored by
 * the summed affinity of the distinct works carrying any of them times the domains those works span, so Cel-Shaded and
 * Anime-inspired on different games add up while two cel tags on one game count once; without Qloo, the model's own
 * predicted art styles in the order it gave them.
 */
export function renderStyles(input, { measured }) {
  const byRef = new Map(input.entities.map(entity => [entity.ref, entity]));
  const styles = input.entities.filter(entity => entity.domain === ART_STYLE_DOMAIN && entity.source === (measured ? 'qloo' : 'model-assumption'))
    .map(entity => ({ entity, preset: presetForArtStyle(entity.name) })).filter(item => item.preset);
  if (!measured) {
    const seen = new Set();
    return styles.filter(item => !seen.has(item.preset) && seen.add(item.preset)).map(({ entity, preset }, rank) => ({ preset, ref: entity.ref, name: entity.name, rank, refs: [entity.ref] }));
  }
  const groups = new Map();
  for (const item of styles) {
    if (!groups.has(item.preset)) groups.set(item.preset, []);
    groups.get(item.preset).push(item.entity);
  }
  return [...groups.entries()].map(([preset, entities]) => {
    const works = [...new Set(entities.flatMap(entity => entity.refs || []))].map(ref => byRef.get(ref)).filter(Boolean);
    const weight = works.reduce((sum, work) => sum + (work.affinity ?? 0.5), 0), domains = new Set(works.map(work => work.domain));
    const lead = [...entities].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.count ?? 0) - (a.count ?? 0))[0];
    return { preset, ref: lead.ref, name: lead.name, score: round(weight * Math.max(1, domains.size)), works: works.length, refs: entities.map(entity => entity.ref),
      examples: works.slice(0, 3).map(work => work.name) };
  }).sort((a, b) => b.score - a.score || b.works - a.works || a.preset.localeCompare(b.preset));
}

/**
 * The game's reading of a taste input. Every art style carries the preset it stands for; a measured art style counts as
 * predicted when the model predicted any quality naming the same preset, which only lowers surprise claims; and the
 * strongest render style joins the required anchors, so the frame's style rests on the audience's data or is rejected
 * with a reason.
 */
export function withRenderStyles(input, { measured }) {
  const predicted = new Map(input.entities.filter(entity => entity.source === 'model-assumption').map(entity => [refPreset(entity), entity]).filter(([preset]) => preset));
  const entities = input.entities.map(entity => {
    if (entity.domain !== ART_STYLE_DOMAIN) return entity;
    const preset = presetForArtStyle(entity.name);
    const view = { ...entity, preset };
    if (entity.source === 'qloo' && preset && predicted.has(preset) && !entity.predictedByModel) {
      Object.assign(view, { predictedByModel: true, matchedPrediction: predicted.get(preset).ref, surprise: false, matchedBy: 'render style' });
    }
    return view;
  });
  const next = { ...input, entities };
  const styles = renderStyles(next, { measured });
  const lead = styles[0] || null;
  const requiredAnchors = lead && !input.requiredAnchors.includes(lead.ref) ? [...input.requiredAnchors, lead.ref] : [...input.requiredAnchors];
  const own = entities.filter(entity => entity.domain === ART_STYLE_DOMAIN && entity.source === 'model-assumption');
  const measuredStyles = entities.filter(entity => entity.domain === ART_STYLE_DOMAIN && entity.source === 'qloo');
  const metrics = { ...input.metrics };
  if (measuredStyles.length || own.length) {
    Object.assign(metrics, measured
      ? { measuredArtStyles: measuredStyles.length, artStylesPredicted: measuredStyles.filter(entity => entity.predictedByModel).length, artStyleSurprises: measuredStyles.filter(entity => entity.surprise).length, artStylePredictions: own.length }
      : { artStylePredictions: own.length });
  }
  return { ...next, requiredAnchors, metrics, renderStyles: styles.map(({ preset, ref, name, score, works, examples }) => ({ preset, ref, name, ...(score !== undefined ? { score, works, examples } : {}) })) };
}
