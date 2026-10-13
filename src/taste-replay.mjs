// Replays a recorded taste pass through the current buildTasteProfile, answering every request from the pass's own
// evidence records, so no Qloo request is made. A profile Qloo returned earlier can then be read with today's
// derivations, such as the art styles a pair recorded before the art style domain existed. A request the pass did not
// record is reported as missing, and its domain stays empty: nothing is invented.

import { buildTasteProfile } from '../plugin/server/culture/taste.mjs';

/** A Qloo client that answers from recorded evidence; `missing` collects the requests it could not answer. */
export function replayClient(evidence, missing = []) {
  const answer = record => { const { tool, tastePass, id, time, ...result } = record; void tool; void tastePass; void id; void time; return structuredClone(result); };
  const absent = description => { missing.push(description); return Object.assign(new Error(`No recorded response for ${description}.`), { code: 'REPLAY_MISSING', retryable: false }); };
  const lookup = (tool, query) => evidence.find(record => record.tool === tool && record.tastePass?.stage === 'resolve' && record.tastePass.reference === query);
  return {
    async searchEntities({ query }) { const record = lookup('qloo_search_entities', query); if (!record) throw absent(`entity search "${query}"`); return answer(record); },
    async searchTags({ query }) { const record = lookup('qloo_search_tags', query); if (!record) throw absent(`tag search "${query}"`); return answer(record); },
    async getInsights(input) {
      const domain = input.resultType === 'tag' ? (input.tagTypes?.[0] === 'urn:tag:style:qloo' ? 'style' : 'aesthetic') : input.resultType;
      const band = input.popularityMax === undefined ? 'core' : 'deep-cut';
      const candidates = evidence.filter(record => record.tool === 'qloo_get_insights' && record.tastePass?.domain === domain && record.tastePass?.band === band);
      // A request sent with the entity seeds alone answers only its own kind of request.
      const record = candidates.find(item => Boolean(item.query?.seedTagIds?.length) === Boolean(input.seedTagIds?.length)) || candidates[0];
      if (!record) throw absent(`${domain} (${band}) insights`);
      return answer(record);
    },
  };
}

/** The profile a recorded pass gives under the current taste code and these domains, with the requests it lacked. */
export async function replayTasteProfile({ evidence, references, domains, location, age, knownNames = [] }) {
  const missing = [];
  const profile = await buildTasteProfile({ client: replayClient(evidence, missing), references, domains, ...(location ? { location } : {}), ...(age ? { age } : {}),
    knownNames, retryDelayMs: 0, rateLimitRetries: 0 });
  return { profile, missing };
}
