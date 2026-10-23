// The seal on a frozen prediction: the SHA-256 of the prediction as it was frozen, its frozenAt time included, written
// beside it at the freeze. Anyone holding the record can recompute it, so a record shows that the prediction it compares
// with the measurement was not rewritten after Qloo answered.
import { createHash } from 'node:crypto';

/** The SHA-256 of a prediction's JSON without its own seal field, in the order the freeze wrote it. */
export function predictionSeal(prediction) {
  const { sha256, ...frozen } = prediction || {};
  return createHash('sha256').update(JSON.stringify(frozen)).digest('hex');
}

/** True when the prediction carries a seal that still matches it, false when the seal no longer matches, null without one. */
export function sealHolds(prediction) {
  if (typeof prediction?.sha256 !== 'string') return null;
  return predictionSeal(prediction) === prediction.sha256;
}
