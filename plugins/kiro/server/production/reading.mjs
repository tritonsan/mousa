// The taste reading: the agent's own judgment of the taste input before it specifies a design. It gathers the refs
// that belong together into two to four clusters, each resting on a quality, sets aside refs it judges to be noise
// with a reason, and says how the medium will carry the clusters. The DNA then anchors only to refs the reading kept.

import { TASTE_SCHEMA_VERSION, TASTE_LIMITS, isQualityDomain } from '../culture/taste.mjs';
import { mediumProfile } from './media.mjs';
import { fail, plain, parsed, object, text, list, ident } from './fields.mjs';

export const READING_LIMITS = Object.freeze({ minClusters: 2, maxClusters: 4, minRefs: 2, maxRefs: 8, maxLayers: 4, maxSetAside: 12 });
const listed = entities => entities.slice(0, 6).map(entity => `${entity.name} (${entity.ref})`).join(', ');

/**
 * Validate a taste reading against the taste input the agent received. In a measured run with measured qualities each
 * cluster rests on a measured one, and with measured surprises at least one cluster gathers a surprise. Every required
 * anchor sits in a cluster or is set aside with a reason; at most `maxRequiredSetAside` are set aside. Together the
 * clusters carry the medium's required layers, or `requiredLayers` when the host's run requires others.
 */
export function normalizeTasteReading(raw, { input, medium = 'web', requiredLayers, maxRequiredSetAside = TASTE_LIMITS.maxRequiredRejections } = {}) {
  if (!plain(input) || !Array.isArray(input.entities)) fail('input', 'The taste input for this run is required.');
  const profile = mediumProfile(medium);
  const refs = new Map(input.entities.map(entity => [entity.ref, entity]));
  const measuredRun = input.entities.some(entity => entity.source === 'qloo');
  const qualities = input.entities.filter(entity => isQualityDomain(entity.domain));
  const measuredQualities = qualities.filter(entity => entity.source === 'qloo');
  const pool = measuredRun && measuredQualities.length ? measuredQualities : qualities;
  const source = parsed(raw, 'reading');
  object(source, 'reading', ['schemaVersion', 'clusters', 'setAside', 'approach']);
  if (source.schemaVersion !== TASTE_SCHEMA_VERSION) fail('reading.schemaVersion', "Use schemaVersion '1.0'.");
  const placed = new Map(), ids = new Set();
  const clusters = list(source.clusters, 'reading.clusters', { min: READING_LIMITS.minClusters, max: READING_LIMITS.maxClusters }).map((cluster, index) => {
    const at = `reading.clusters[${index}]`;
    object(cluster, at, ['id', 'name', 'refs', 'layers', 'reading']);
    const id = ident(cluster.id, `${at}.id`, { max: 20 });
    if (ids.has(id)) fail(`${at}.id`, 'Use a unique cluster ID such as c1.');
    ids.add(id);
    const members = [...new Set(list(cluster.refs, `${at}.refs`, { min: READING_LIMITS.minRefs, max: READING_LIMITS.maxRefs }).map((value, refIndex) => {
      const ref = text(value, `${at}.refs[${refIndex}]`, { max: 160 });
      if (!refs.has(ref)) fail(`${at}.refs[${refIndex}]`, 'Use a ref exactly as returned with the taste input.');
      if (placed.has(ref) && placed.get(ref) !== id) fail(`${at}.refs[${refIndex}]`, `${refs.get(ref).name} is already in cluster ${placed.get(ref)}; a ref belongs to one cluster.`);
      placed.set(ref, id);
      return ref;
    }))];
    if (members.length < READING_LIMITS.minRefs) fail(`${at}.refs`, 'A cluster gathers at least two different refs.');
    const entities = members.map(ref => refs.get(ref));
    // A cluster says what the works share; the works are evidence of it, so each rests on a quality.
    if (pool.length && !entities.some(entity => pool.includes(entity))) {
      fail(`${at}.refs`, `Rest each cluster on at least one ${pool === measuredQualities && measuredRun ? 'measured ' : ''}quality ref, a quality, style, aesthetic or art style ref, such as ${listed(pool)}; the works in a cluster are evidence of what they share.`);
    }
    const layers = [...new Set(list(cluster.layers, `${at}.layers`, { min: 1, max: READING_LIMITS.maxLayers }).map((layer, layerIndex) => {
      if (!profile.layers.includes(layer)) fail(`${at}.layers[${layerIndex}]`, `Use layers of the ${profile.label.toLowerCase()} medium: ${profile.layers.join(', ')}.`);
      return layer;
    }))];
    const surprise = entities.some(entity => entity.source === 'qloo' && entity.surprise);
    return { id, name: text(cluster.name, `${at}.name`, { min: 3, max: 80 }), refs: members, layers, reading: text(cluster.reading, `${at}.reading`, { min: 20, max: 600 }), ...(surprise ? { surprise: true } : {}) };
  });
  const aside = new Set();
  const setAside = list(source.setAside, 'reading.setAside', { max: READING_LIMITS.maxSetAside }).map((item, index) => {
    const at = `reading.setAside[${index}]`;
    object(item, at, ['ref', 'reason']);
    const ref = text(item.ref, `${at}.ref`, { max: 160 });
    if (!refs.has(ref)) fail(`${at}.ref`, 'Use a ref exactly as returned with the taste input.');
    if (placed.has(ref)) fail(`${at}.ref`, `${refs.get(ref).name} is in cluster ${placed.get(ref)}; a ref is either gathered or set aside.`);
    if (aside.has(ref)) fail(`${at}.ref`, 'Set each ref aside once.');
    aside.add(ref);
    return { ref, reason: text(item.reason, `${at}.reason`, { min: 10, max: 400 }) };
  });
  const required = (Array.isArray(input.requiredAnchors) ? input.requiredAnchors : []).filter(ref => refs.has(ref));
  const missing = required.filter(ref => !placed.has(ref) && !aside.has(ref));
  if (missing.length) fail('reading.clusters', `Every required anchor belongs to a cluster or is set aside with a reason. Missing: ${missing.map(ref => `${refs.get(ref).name} (${ref})`).join(', ')}.`);
  const requiredAside = required.filter(ref => aside.has(ref));
  if (requiredAside.length > maxRequiredSetAside) fail('reading.setAside', `At most ${maxRequiredSetAside} required anchors may be set aside; a set-aside required anchor counts as rejected in the DNA.`);
  const layersNeeded = Array.isArray(requiredLayers) ? requiredLayers : profile.requiredLayers;
  const carried = new Set(clusters.flatMap(cluster => cluster.layers));
  const uncarried = layersNeeded.filter(layer => !carried.has(layer));
  if (uncarried.length) fail('reading.clusters', `Together the clusters carry the layers this medium requires: ${layersNeeded.join(', ')}. No cluster carries ${uncarried.join(', ')}.`);
  // The DNA must depart from the sketch through surprise-anchored devices, so the reading keeps at least one surprise.
  const surprises = input.entities.filter(entity => entity.source === 'qloo' && entity.surprise);
  if (surprises.length && !clusters.some(cluster => cluster.surprise)) {
    const rank = entity => Number(!aside.has(entity.ref)) * 2 + Number(isQualityDomain(entity.domain));
    fail('reading.clusters', `Measured surprises must shape the reading: gather at least one surprise into a cluster, such as ${listed([...surprises].sort((a, b) => rank(b) - rank(a)))}.`);
  }
  const approach = text(source.approach, 'reading.approach', { min: 40, max: 1200 });
  return { schemaVersion: TASTE_SCHEMA_VERSION, medium: profile.id, clusters, setAside, approach,
    coverage: { required, clustered: required.filter(ref => placed.has(ref)), setAside: requiredAside },
    stats: { clusters: clusters.length, refs: placed.size, surpriseClusters: clusters.filter(cluster => cluster.surprise).length, setAside: setAside.length,
      qualityRefs: [...placed.keys()].filter(ref => isQualityDomain(refs.get(ref).domain)).length },
    sourceType: 'model-interpretation' };
}

/**
 * The DNA as the reading binds it. A device may not anchor a ref the reading set aside, and each device anchors at
 * least one clustered ref, so every device realizes part of the reading. Required anchors the reading set aside are
 * added to the DNA's rejections with the reading's reason, so the DNA validator counts them against its limit.
 * Returns the DNA source to validate; its other faults are left for the DNA validator to report.
 */
export function applyReadingToDna(raw, reading) {
  const source = parsed(raw, 'dna');
  if (!plain(reading) || !plain(source) || !Array.isArray(source.devices)) return source;
  const aside = new Map(reading.setAside.map(item => [item.ref, item.reason]));
  const clustered = new Set(reading.clusters.flatMap(cluster => cluster.refs));
  source.devices.forEach((device, index) => {
    const anchors = Array.isArray(device?.anchors) ? device.anchors.filter(ref => typeof ref === 'string').map(ref => ref.trim()) : [];
    anchors.forEach((ref, anchorIndex) => {
      if (aside.has(ref)) fail(`dna.devices[${index}].anchors[${anchorIndex}]`, `Your taste reading set ${ref} aside (${aside.get(ref)}), so no device anchors to it. Anchor to a ref a cluster gathers.`);
    });
    if (anchors.length && !anchors.some(ref => clustered.has(ref))) {
      fail(`dna.devices[${index}].anchors`, `Anchor each device to at least one ref of a reading cluster, so it realizes part of your reading: ${reading.clusters.map(cluster => `${cluster.id} (${cluster.refs.slice(0, 4).join(', ')})`).join('; ')}.`);
    }
  });
  if (source.rejected !== undefined && !Array.isArray(source.rejected)) return source;
  const rejected = [...(source.rejected || [])];
  const named = new Set(rejected.map(item => typeof item?.ref === 'string' ? item.ref.trim() : null));
  for (const ref of reading.coverage.setAside) if (!named.has(ref)) rejected.push({ ref, reason: `Set aside in the taste reading: ${aside.get(ref)}`.slice(0, 400) });
  return { ...source, rejected };
}
