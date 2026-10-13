// How the two arms of a comparison chose to make their artifacts, from their production stages: the methods of each
// layer in each arm, the layers they make differently, the pictures each plan asked for and how each arm's last review
// judged its own criteria. Any host that records the reading, the plan and the reviews of both arms can compare them.

/**
 * `baseline` and `qloo` are each {reading, plan, reviews} as the host recorded them for one arm; `labels` names the
 * arms in the headline. Null when an arm saved no plan.
 */
export function compareProduction({ baseline, qloo, labels = { baseline: 'Qloo off', qloo: 'Qloo on' } }) {
  const side = arm => {
    if (!arm?.plan) return null;
    const byLayer = {};
    for (const step of arm.plan.steps) (byLayer[step.layer] ||= new Set()).add(step.method);
    const reviews = arm.reviews || [], last = reviews.at(-1);
    return { methods: arm.plan.uses.methods, byLayer: Object.fromEntries(Object.entries(byLayer).map(([layer, methods]) => [layer, [...methods]])),
      generators: Object.fromEntries(Object.entries(arm.plan.uses.generators).map(([generator, use]) => [generator, use.total])),
      clusters: arm.reading?.clusters.length || 0, setAside: arm.reading?.setAside.length || 0, criteria: arm.plan.review.length,
      review: last ? { rounds: reviews.length, met: last.stats.met, partly: last.stats.partly, missed: last.stats.missed } : null };
  };
  const a = side(baseline), b = side(qloo);
  if (!a || !b) return null;
  const named = (methods = []) => methods.join(' and ') || 'nothing';
  const differing = [...new Set([...Object.keys(a.byLayer), ...Object.keys(b.byLayer)])].filter(layer => named(a.byLayer[layer]) !== named(b.byLayer[layer]));
  return { baseline: a, qloo: b, differingLayers: differing,
    headline: differing.length
      ? `The plans make ${differing.length} layer${differing.length > 1 ? 's' : ''} differently: ${differing.map(layer => `${layer} by ${named(a.byLayer[layer])} in ${labels.baseline} and ${named(b.byLayer[layer])} in ${labels.qloo}`).join('; ')}.`
      : `Both plans make every layer by the same methods: ${a.methods.join(', ')}.` };
}
