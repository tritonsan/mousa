const MAX_RESULTS = 20;
const MAX_SEEDS = 20;
const MAX_TAG_SEEDS = 10;
const MAX_CANDIDATES = 50;
const MAX_EXCLUDED = 50;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TAG_ID = /^urn:tag:[a-z0-9:_.-]{1,160}$/iu;

export const QLOO_RESULT_TYPES = Object.freeze([
  'artist', 'book', 'brand', 'destination', 'movie', 'person', 'place',
  'podcast', 'tv_show', 'videogame', 'tag',
]);
export const QLOO_SEARCH_TYPES = Object.freeze([
  ...QLOO_RESULT_TYPES.filter(type => type !== 'tag'), 'actor', 'album', 'author', 'director', 'locality',
]);
// The age bands signal.demographics.age accepts, in the Insights API's OpenAPI definition: three broad, five narrow.
export const QLOO_AGE_BANDS = Object.freeze(['35_and_younger', '36_to_55', '55_and_older', '24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54']);

export class QlooError extends Error {
  constructor(code, message, { status, retryable = false } = {}) {
    super(message);
    this.name = 'QlooError';
    this.code = code;
    this.retryable = retryable;
    if (status !== undefined) this.status = status;
  }
}

function inputError(message) {
  return new QlooError('QLOO_INPUT_INVALID', message);
}

function textInput(value, label, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/u.test(value)) {
    throw inputError(`${label} must be a nonempty string of at most ${maximum} characters.`);
  }
  return value.trim();
}

function limitInput(value = 6) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw inputError(`limit must be an integer from 1 to ${MAX_RESULTS}.`);
  }
  return value;
}

function idsInput(value, label, maximum, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw inputError(`${label} must contain between 1 and ${maximum} Qloo IDs.`);
  }
  const ids = value.map(id => {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/u.test(id)) {
      throw inputError(`${label} must contain resolved Qloo IDs, not names or freeform text.`);
    }
    return id;
  });
  return [...new Set(ids)];
}

function tagIdsInput(value, label, maximum, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw inputError(`${label} must contain between 1 and ${maximum} Qloo tag IDs.`);
  }
  return [...new Set(value.map(id => {
    if (typeof id !== 'string' || !TAG_ID.test(id)) throw inputError(`${label} must contain resolved Qloo tag IDs such as urn:tag:genre:media:drama.`);
    return id;
  }))];
}

function fractionInput(value, label) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw inputError(`${label} must be a number from 0 to 1.`);
  return value;
}

function resultTypeInput(value) {
  const type = typeof value === 'string' ? value.replace(/^urn:entity:/u, '').replace(/^urn:/u, '') : value;
  if (!QLOO_RESULT_TYPES.includes(type)) throw inputError('resultType must be a supported Qloo category.');
  return type === 'tag' ? 'urn:tag' : `urn:entity:${type}`;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resultRows(payload) {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.results?.entities)) return payload.results.entities;
  if (Array.isArray(payload?.results?.tags)) return payload.results.tags;
  if (Array.isArray(payload?.entities)) return payload.entities;
  throw new QlooError('QLOO_RESPONSE_INVALID', 'Qloo returned an unrecognized response shape.');
}

/** A bounded, read-only client. Affinity values are preserved, never percentages. */
export class QlooClient {
  #apiKey;
  #baseUrl;
  #fetch;
  #timeoutMs;

  constructor({ apiKey, baseUrl = 'https://hackathon.api.qloo.com', fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    let endpoint;
    try { endpoint = new URL(baseUrl); } catch { throw inputError('Qloo baseUrl must be a valid URL.'); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw inputError('Qloo baseUrl must use HTTPS and contain no credentials, query or fragment.');
    }
    if (typeof fetchImpl !== 'function') throw inputError('A fetch implementation is required.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw inputError('timeoutMs must be from 1 to 60000.');
    this.#apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.#baseUrl = endpoint.href.replace(/\/$/u, '');
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  #text(value, maxLength = 1000) {
    if (typeof value !== 'string') return undefined;
    const redacted = this.#apiKey ? value.replaceAll(this.#apiKey, '[redacted]') : value;
    return redacted.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').slice(0, maxLength);
  }

  #publicQuery(value) {
    if (typeof value === 'string') return this.#text(value, 1000);
    if (Array.isArray(value)) return value.map(item => this.#publicQuery(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.#publicQuery(item)]));
    return value;
  }

  #explainability(value) {
    let remaining = 300;
    const copy = (item, depth = 0) => {
      if (remaining-- <= 0 || depth > 6) return undefined;
      if (item === null || typeof item === 'boolean') return item;
      if (typeof item === 'number') return finite(item);
      if (typeof item === 'string') return this.#text(item, 1000);
      if (Array.isArray(item)) return item.slice(0, 50).map(child => copy(child, depth + 1)).filter(child => child !== undefined);
      if (!item || typeof item !== 'object') return undefined;
      const result = {};
      for (const [key, child] of Object.entries(item).slice(0, 40)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)
          || /^(?:api[_-]?key|authorization|password|secret|token|credentials?)$/iu.test(key)) continue;
        const safe = copy(child, depth + 1);
        if (safe !== undefined) result[this.#text(key, 160)] = safe;
      }
      return result;
    };
    return copy(value);
  }

  #entity(row) {
    if (!row || typeof row !== 'object') return null;
    const entityId = this.#text(row.entity_id ?? row.tag_id ?? row.id, 160);
    const name = this.#text(row.name ?? row.title, 240);
    if (!entityId || !name) return null;
    const properties = row.properties && typeof row.properties === 'object' ? row.properties : row;
    const types = (Array.isArray(row.types) ? row.types : []).slice(0, 12).map(type => this.#text(type, 120)).filter(Boolean);
    const result = {
      entityId,
      name,
      type: this.#text(row.subtype ?? row.type, 120) ?? types.find(type => type.startsWith('urn:entity:')) ?? types[0] ?? 'unknown',
      ...(types.length ? { types } : {}),
      tags: (Array.isArray(row.tags) ? row.tags : []).slice(0, 16).map(tag => ({
        id: this.#text(tag.id ?? tag.tag_id, 160),
        name: this.#text(tag.name, 180),
      })).filter(tag => tag.id && tag.name),
    };
    const description = this.#text(properties.description ?? properties.short_description);
    if (description) result.description = description;
    const affinity = finite(row.query?.affinity) ?? finite(row.affinity);
    const popularity = finite(row.popularity);
    if (affinity !== undefined) result.affinity = affinity;
    if (popularity !== undefined) result.popularity = popularity;
    if (Object.hasOwn(row.query ?? {}, 'explainability')) {
      const explainability = this.#explainability(row.query.explainability);
      if (explainability !== undefined) result.explainability = explainability;
    }
    const website = this.#text(properties.official_site ?? properties.website, 500);
    if (website && /^https?:\/\//u.test(website)) result.website = website;
    const geocode = properties.geocode;
    if (geocode && typeof geocode === 'object') {
      const location = {
        city: this.#text(geocode.city ?? geocode.name, 120),
        countryCode: this.#text(geocode.country_code, 12),
        address: this.#text(properties.address, 300),
      };
      if (Object.values(location).some(Boolean)) result.location = location;
    }
    return result;
  }

  async #request(path, parameters, query) {
    if (!this.#apiKey) {
      throw new QlooError('QLOO_KEY_MISSING', 'Qloo is not configured. Add QLOO_API_KEY on the server to retrieve cultural evidence.');
    }
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(parameters)) if (value !== undefined) url.searchParams.set(key, value);
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new QlooError('QLOO_TIMEOUT', 'The Qloo request timed out.', { retryable: true }));
      }, this.#timeoutMs);
    });
    try {
      const work = async () => {
        const response = await this.#fetch(url, {
          method: 'GET',
          headers: { 'X-Api-Key': this.#apiKey, Accept: 'application/json' },
          signal: controller.signal,
          redirect: 'error',
        });
        if (!response.ok) {
          const status = response.status;
          const details = status === 401 ? ['QLOO_AUTH', 'Qloo rejected the server credential. Check the configured endpoint and key.']
            : status === 403 ? ['QLOO_FORBIDDEN', 'This Qloo category is unavailable for the configured account.']
            : status === 429 ? ['QLOO_RATE_LIMIT', 'Qloo rate limit reached. Try again later.']
            : ['QLOO_UPSTREAM', 'Qloo could not complete this request.'];
          throw new QlooError(...details, { status, retryable: status === 429 || status >= 500 });
        }
        const declaredLength = Number(response.headers?.get?.('content-length'));
        if (declaredLength > MAX_RESPONSE_BYTES) throw new QlooError('QLOO_RESPONSE_INVALID', 'The Qloo response exceeded the size limit.');
        const body = await response.text();
        if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw new QlooError('QLOO_RESPONSE_INVALID', 'The Qloo response exceeded the size limit.');
        let payload;
        try { payload = JSON.parse(body); } catch { throw new QlooError('QLOO_RESPONSE_INVALID', 'Qloo returned invalid JSON.'); }
        if (payload?.success === false) throw new QlooError('QLOO_UPSTREAM', 'Qloo reported that the request did not succeed.');
        const rows = resultRows(payload);
        const results = rows.slice(0, query.limit).map(row => this.#entity(row)).filter(Boolean);
        if (rows.length && !results.length) throw new QlooError('QLOO_RESPONSE_INVALID', 'Qloo results did not contain identifiable entities.');
        const explainability = Object.hasOwn(payload.query ?? {}, 'explainability')
          ? this.#explainability(payload.query.explainability) : undefined;
        return {
          status: results.length ? 'ok' : 'empty',
          query: this.#publicQuery(query),
          results,
          ...(Object.hasOwn(payload, 'query') ? { responseQuery: this.#explainability(payload.query) } : {}),
          ...(Object.hasOwn(payload, 'warnings') ? { warnings: this.#explainability(payload.warnings) } : {}),
          ...(explainability !== undefined ? { explainability } : {}),
          evidence: {
            provider: 'Qloo',
            endpoint: this.#text(`${this.#baseUrl}${path}`, 1000),
            retrievedAt: new Date().toISOString(),
            resultCount: results.length,
            interpretation: 'Aggregate cultural affinity. This is neither individual enjoyment probability nor a design quality score.',
          },
        };
      };
      return await Promise.race([work(), timeout]);
    } catch (error) {
      if (error instanceof QlooError) throw error;
      throw new QlooError('QLOO_NETWORK', 'Qloo could not be reached.', { retryable: true });
    } finally { clearTimeout(timer); }
  }

  async searchEntities({ query, types, limit } = {}) {
    const searchQuery = textInput(query, 'query');
    const take = limitInput(limit);
    let searchTypes;
    if (types !== undefined) {
      if (!Array.isArray(types) || types.length < 1 || types.length > 10) throw inputError('types must contain from 1 to 10 Qloo categories.');
      searchTypes = [...new Set(types.map(value => {
        const type = typeof value === 'string' ? value.replace(/^urn:entity:/u, '').replace(/^urn:/u, '') : value;
        if (!QLOO_SEARCH_TYPES.includes(type)) throw inputError('types must contain supported Search categories, not Insights-only categories.');
        return `urn:entity:${type}`;
      }))];
    }
    return this.#request('/search', { query: searchQuery, types: searchTypes?.join(','), take }, {
      text: searchQuery, ...(searchTypes ? { types: searchTypes } : {}), limit: take,
    });
  }

  /** Resolve genre and interest names to tag IDs for signal.interests.tags. */
  async searchTags({ query, tagTypes, limit } = {}) {
    const searchQuery = textInput(query, 'query');
    const take = limitInput(limit);
    let types;
    if (tagTypes !== undefined) {
      if (!Array.isArray(tagTypes) || tagTypes.length < 1 || tagTypes.length > 4 || tagTypes.some(type => typeof type !== 'string' || !/^urn:tag:[a-zA-Z0-9:_-]{1,140}$/u.test(type))) throw inputError('tagTypes must contain 1–4 documented tag type URNs.');
      types = [...new Set(tagTypes)];
    }
    return this.#request('/v2/tags', { 'filter.query': searchQuery, 'filter.tag.types': types?.join(','), take }, {
      text: searchQuery, ...(types ? { tagTypes: types } : {}), limit: take,
    });
  }

  async getInsights({ seedEntityIds, seedTagIds, resultType, location, age, candidateEntityIds, excludeEntityIds, popularityMin, popularityMax, limit, explainability, tagTypes, parentTypes } = {}) {
    const seeds = seedEntityIds === undefined && seedTagIds !== undefined ? undefined : idsInput(seedEntityIds, 'seedEntityIds', MAX_SEEDS);
    const tagSeeds = tagIdsInput(seedTagIds, 'seedTagIds', MAX_TAG_SEEDS, { optional: true });
    const category = resultTypeInput(resultType);
    const candidates = idsInput(candidateEntityIds, 'candidateEntityIds', MAX_CANDIDATES, { optional: true });
    const excluded = idsInput(excludeEntityIds, 'excludeEntityIds', MAX_EXCLUDED, { optional: true });
    const minimumPopularity = fractionInput(popularityMin, 'popularityMin');
    const maximumPopularity = fractionInput(popularityMax, 'popularityMax');
    if (minimumPopularity !== undefined && maximumPopularity !== undefined && minimumPopularity > maximumPopularity) throw inputError('popularityMin cannot exceed popularityMax.');
    const take = limitInput(limit);
    if (explainability !== undefined && typeof explainability !== 'boolean') throw inputError('explainability must be a boolean.');
    if ((tagTypes !== undefined || parentTypes !== undefined) && category !== 'urn:tag') throw inputError('Tag and parent filters require resultType tag.');
    let tagFilters, parentFilters;
    if (tagTypes !== undefined) {
      if (!Array.isArray(tagTypes) || tagTypes.length < 1 || tagTypes.length > 4 || tagTypes.some(type => typeof type !== 'string' || !/^urn:tag:[a-zA-Z0-9:_-]{1,140}$/u.test(type))) throw inputError('tagTypes must contain 1–4 documented tag type URNs.');
      tagFilters = [...new Set(tagTypes)];
    }
    if (parentTypes !== undefined) {
      if (!Array.isArray(parentTypes) || parentTypes.length < 1 || parentTypes.length > 4) throw inputError('parentTypes must contain 1–4 entity categories.');
      parentFilters = [...new Set(parentTypes.map(resultTypeInput))];
      if (parentFilters.includes('urn:tag')) throw inputError('parentTypes must be entity categories.');
    }
    const parameters = {
      'filter.type': category,
      'signal.interests.entities': seeds?.join(','),
      'signal.interests.tags': tagSeeds?.join(','),
      'filter.results.entities': candidates?.join(','),
      'filter.exclude.entities': excluded?.join(','),
      'filter.popularity.min': minimumPopularity,
      'filter.popularity.max': maximumPopularity,
      'feature.explainability': explainability,
      'filter.tag.types': tagFilters?.join(','),
      'filter.parents.types': parentFilters?.join(','),
      take,
    };
    const local = location === undefined ? undefined : textInput(location, 'location', 300);
    if (local) {
      const geometryOrLocalityId = /^(POINT|POLYGON|MULTIPOLYGON)\s*\(/iu.test(local)
        || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(local);
      // Geographic taste context, not the physical Place/Destination result filter.
      parameters[geometryOrLocalityId ? 'signal.location' : 'signal.location.query'] = local;
    }
    // Age bands weight the audience toward those ages; Qloo takes them comma-separated.
    let ages;
    if (age !== undefined) {
      const list = Array.isArray(age) ? age : [age];
      if (!list.length || list.length > 3 || list.some(value => !QLOO_AGE_BANDS.includes(value))) throw inputError(`age must be 1–3 of: ${QLOO_AGE_BANDS.join(', ')}.`);
      ages = [...new Set(list)];
      parameters['signal.demographics.age'] = ages.join(',');
    }
    return this.#request('/v2/insights', parameters, {
      ...(seeds ? { seedEntityIds: seeds } : {}), ...(tagSeeds ? { seedTagIds: tagSeeds } : {}), resultType: category,
      ...(local ? { location: local } : {}), ...(ages ? { age: ages } : {}),
      ...(explainability !== undefined ? { explainability } : {}),
      ...(candidates ? { candidateEntityIds: candidates } : {}),
      ...(excluded ? { excludeEntityIds: excluded } : {}),
      ...(minimumPopularity !== undefined ? { popularityMin: minimumPopularity } : {}),
      ...(maximumPopularity !== undefined ? { popularityMax: maximumPopularity } : {}), limit: take,
      ...(tagFilters ? { tagTypes: tagFilters } : {}), ...(parentFilters ? { parentTypes: parentFilters } : {}),
    });
  }
}
