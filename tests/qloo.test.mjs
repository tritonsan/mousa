import test from 'node:test';
import assert from 'node:assert/strict';
import { QlooClient, QlooError } from '../src/qloo/client.mjs';

const seedA = '00000000-0000-4000-8000-000000000057';
const seedB = '00000000-0000-4000-8000-000000000084';
const jsonResponse = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('observed Search types arrays identify entities without inventing affinity', async () => {
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async () => jsonResponse({ results: [{
    entity_id: '00000000-0000-4000-8000-000000000076', name: 'Nujabes', types: ['urn:entity:artist'],
    properties: { description: 'Observed Search uses a types array.' }, popularity: 0.9963226735849884,
    tags: [{ id: 'urn:tag:genre:chillout', name: 'Chillout' }],
  }] }) });
  const result = await client.searchEntities({ query: 'Nujabes', types: ['artist'] });
  assert.equal(result.results[0].type, 'urn:entity:artist');
  assert.equal(result.results[0].popularity, 0.9963226735849884);
  assert.equal(Object.hasOwn(result.results[0], 'affinity'), false);
});

test('documented legacy search categories are separate from Insights result categories', async () => {
  const requests = [];
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async url => { requests.push(url); return jsonResponse({ results: [] }); } });
  for (const type of ['actor', 'album', 'author', 'director', 'locality']) {
    await client.searchEntities({ query: 'An explicit name', types: [type] });
    assert.equal(requests.at(-1).searchParams.get('types'), `urn:entity:${type}`);
  }
  await assert.rejects(client.getInsights({ seedEntityIds: [seedA], resultType: 'author' }), error => error.code === 'QLOO_INPUT_INVALID');
  await assert.rejects(client.getInsights({ seedEntityIds: [seedA], resultType: 'video_game' }), error => error.code === 'QLOO_INPUT_INVALID');
  assert.equal(requests.length, 5);
});

test('tag namespaces and parent filters are mapped only for tag insights', async () => {
  const requests = [];
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async url => {
    requests.push(url); return jsonResponse({ success: true, results: { tags: [{ tag_id: 'urn:tag:theme:qloo:routine', name: 'Routine', type: 'urn:tag', query: { affinity: 0.64 } }] } });
  } });
  const result = await client.getInsights({ seedEntityIds: [seedA], resultType: 'tag', tagTypes: ['urn:tag:theme', 'urn:tag:archetype'], parentTypes: ['movie', 'urn:entity:book'] });
  assert.equal(requests[0].searchParams.get('filter.tag.types'), 'urn:tag:theme,urn:tag:archetype');
  assert.equal(requests[0].searchParams.get('filter.parents.types'), 'urn:entity:movie,urn:entity:book');
  assert.equal(result.results[0].entityId, 'urn:tag:theme:qloo:routine');
  assert.equal(result.results[0].affinity, 0.64);
  for (const input of [
    { resultType: 'movie', tagTypes: ['urn:tag:theme'] },
    { resultType: 'tag', tagTypes: ['theme'] },
    { resultType: 'tag', parentTypes: ['author'] },
    { resultType: 'tag', tagTypes: ['urn:tag:one', 'urn:tag:two', 'urn:tag:three', 'urn:tag:four', 'urn:tag:five'] },
  ]) await assert.rejects(client.getInsights({ seedEntityIds: [seedA], ...input }), error => error.code === 'QLOO_INPUT_INVALID');
  assert.equal(requests.length, 1);
});

test('observed explainability field names and response query remain source data separate from sent parameters', async () => {
  const contributions = [{ entity_id: seedA, score: 0.5593401259776708 }, { entity_id: seedB, score: 0.4406598740223293 }];
  const aggregate = { 'signal.interests.entities': { effect_on_top3_recs: [{ entity_id: seedA, avg_score: 0.5074572417712336 }] } };
  const responseQuery = { explainability: aggregate };
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async () => jsonResponse({
    success: true, query: responseQuery, warnings: ['An actual upstream warning'],
    results: { entities: [{ entity_id: 'returned-artist', name: 'Returned artist', subtype: 'urn:entity:artist', query: { affinity: 0.73891, explainability: { 'signal.interests.entities': contributions } } }] },
  }) });
  const result = await client.getInsights({ seedEntityIds: [seedA, seedB], resultType: 'artist', explainability: true });
  assert.deepEqual(result.results[0].explainability['signal.interests.entities'], contributions);
  assert.deepEqual(result.explainability, aggregate);
  assert.deepEqual(result.responseQuery, responseQuery);
  assert.deepEqual(result.query.seedEntityIds, [seedA, seedB]);
  assert.deepEqual(result.warnings, ['An actual upstream warning']);
  assert.equal(Object.hasOwn(result, 'designScore'), false);
});

test('known credentials are redacted before response-field truncation', async () => {
  const key = 'fixtureCredentialAtTheBoundary';
  const text = 'x'.repeat(995) + key + ' after';
  const client = new QlooClient({ apiKey: key, fetchImpl: async () => jsonResponse({ results: [{ entity_id: seedA, name: 'Safe name', properties: { description: text } }] }) });
  const result = await client.searchEntities({ query: 'Safe name' });
  assert.equal(result.results[0].description.length, 1000);
  assert.equal(result.results[0].description.includes(key.slice(0, 5)), false);
});

test('search uses documented GET /search and exposes only sanitized cultural fields', async () => {
  const key = 'fixture-key-not-a-production-credential';
  let called;
  const client = new QlooClient({ apiKey: key, fetchImpl: async (url, options) => {
    called = { url, options };
    return jsonResponse({ results: [{ entity_id: seedA, name: 'Example Book', subtype: 'urn:entity:book',
      properties: { description: `Example cultural metadata ${key}`, api_key: key },
      tags: [{ id: 'urn:tag:genre:media:fiction', name: 'Fiction' }], authorization: key }] });
  } });
  const result = await client.searchEntities({ query: 'Example Book', types: ['book'], limit: 3 });
  assert.equal(called.url.origin, 'https://hackathon.api.qloo.com');
  assert.equal(called.url.pathname, '/search');
  assert.equal(called.url.searchParams.get('types'), 'urn:entity:book');
  assert.equal(called.url.searchParams.get('take'), '3');
  assert.equal(called.options.method, 'GET');
  assert.equal(called.options.headers['X-Api-Key'], key);
  assert.equal(called.options.redirect, 'error');
  assert.equal(result.results[0].entityId, seedA);
  assert.equal(result.results[0].description, 'Example cultural metadata [redacted]');
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(JSON.stringify(client).includes(key), false);
});

test('insights keep original affinity and separate seed, candidate and location parameters', async () => {
  let called;
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async url => {
    called = url;
    return jsonResponse({ success: true, results: { entities: [{ entity_id: seedB, name: 'Example Artist', subtype: 'urn:entity:artist',
      query: { affinity: 0.73891 }, popularity: 0.92 }] } });
  } });
  const result = await client.getInsights({ seedEntityIds: [seedA, seedA], resultType: 'artist', candidateEntityIds: [seedB], location: 'Istanbul', limit: 8 });
  assert.equal(called.pathname, '/v2/insights');
  assert.equal(called.searchParams.get('signal.interests.entities'), seedA);
  assert.equal(called.searchParams.get('filter.results.entities'), seedB);
  assert.equal(called.searchParams.get('filter.type'), 'urn:entity:artist');
  assert.equal(called.searchParams.get('signal.location.query'), 'Istanbul');
  assert.equal(called.searchParams.has('filter.location'), false);
  assert.equal(called.searchParams.has('filter.location.query'), false);
  assert.equal(result.results[0].affinity, 0.73891);
  assert.equal(result.evidence.provider, 'Qloo');
  assert.equal(result.evidence.resultCount, 1);
  assert.match(result.evidence.interpretation, /neither individual enjoyment probability nor a design quality score/);
});

test('WKT location and tag response use their documented formats without invented entity data', async () => {
  let called;
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async url => {
    called = url;
    return jsonResponse({ results: { tags: [{ tag_id: 'urn:tag:genre:media:drama', name: 'Drama', type: 'urn:tag', query: { affinity: 0.64 } }] } });
  } });
  const result = await client.getInsights({ seedEntityIds: [seedA], resultType: 'tag', location: 'POINT(28.9 41.0)' });
  assert.equal(called.searchParams.get('signal.location'), 'POINT(28.9 41.0)');
  assert.equal(called.searchParams.has('signal.location.query'), false);
  assert.equal(called.searchParams.has('filter.location'), false);
  assert.equal(called.searchParams.get('filter.type'), 'urn:tag');
  assert.equal(result.results[0].name, 'Drama');
  assert.equal(result.results[0].affinity, 0.64);
});

test('age bands weight the audience through signal.demographics.age and only documented bands are sent', async () => {
  const requests = [];
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async url => {
    requests.push(url);
    return jsonResponse({ results: { entities: [] } });
  } });
  await client.getInsights({ seedEntityIds: [seedA], resultType: 'movie', age: ['24_and_younger', '25_to_29', '24_and_younger'] });
  await client.getInsights({ seedEntityIds: [seedA], resultType: 'tag', tagTypes: ['urn:tag:style:qloo'], age: '36_to_55', location: 'Lisbon' });
  assert.equal(requests[0].searchParams.get('signal.demographics.age'), '24_and_younger,25_to_29');
  assert.equal(requests[1].searchParams.get('signal.demographics.age'), '36_to_55');
  assert.equal(requests[1].searchParams.get('signal.location.query'), 'Lisbon');
  for (const age of [[], ['teenagers'], ['24_and_younger', '25_to_29', '30_to_34', '35_to_44'], 'adults']) {
    await assert.rejects(client.getInsights({ seedEntityIds: [seedA], resultType: 'movie', age }), error => error.code === 'QLOO_INPUT_INVALID' && /age must be 1–3 of/u.test(error.message), JSON.stringify(age));
  }
  assert.equal(requests.length, 2, 'an invalid band never reaches the network');
});

test('movie and place location context never silently restricts physical result coordinates', async () => {
  const requests = [];
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async url => {
    requests.push(url);
    return jsonResponse({ results: { entities: [] } });
  } });
  await client.getInsights({ seedEntityIds: [seedA], resultType: 'movie', location: 'Lower East Side' });
  await client.getInsights({ seedEntityIds: [seedA], resultType: 'place', location: seedB });
  assert.equal(requests[0].searchParams.get('signal.location.query'), 'Lower East Side');
  assert.equal(requests[1].searchParams.get('signal.location'), seedB);
  assert.equal(requests[1].searchParams.has('signal.location.query'), false);
  for (const request of requests) {
    assert.equal(request.searchParams.has('filter.location'), false);
    assert.equal(request.searchParams.has('filter.location.query'), false);
  }
});

test('an empty result remains empty and absent affinities remain absent', async () => {
  const emptyClient = new QlooClient({ apiKey: 'fixture', fetchImpl: async () => jsonResponse({ results: { entities: [] } }) });
  const result = await emptyClient.getInsights({ seedEntityIds: [seedA], resultType: 'brand' });
  assert.equal(result.status, 'empty');
  assert.deepEqual(result.results, []);
  assert.equal(result.evidence.resultCount, 0);
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async () => jsonResponse({ results: [{ entity_id: seedA, name: 'No affinity' }] }) });
  assert.equal(Object.hasOwn((await client.searchEntities({ query: 'No affinity' })).results[0], 'affinity'), false);
});

test('missing credentials and invalid inputs never send a request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('unexpected'); };
  const missing = new QlooClient({ fetchImpl });
  await assert.rejects(missing.searchEntities({ query: 'Example' }), error => error.code === 'QLOO_KEY_MISSING');
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl });
  await assert.rejects(client.searchEntities({ query: 'Example', limit: 21 }), error => error.code === 'QLOO_INPUT_INVALID');
  await assert.rejects(client.getInsights({ seedEntityIds: ['A title with spaces'], resultType: 'artist' }), error => error.code === 'QLOO_INPUT_INVALID');
  await assert.rejects(client.getInsights({ seedEntityIds: [], resultType: 'artist' }), error => error.code === 'QLOO_INPUT_INVALID');
  await assert.rejects(client.getInsights({ seedEntityIds: [seedA], resultType: 'furniture' }), error => error.code === 'QLOO_INPUT_INVALID');
  assert.equal(calls, 0);
});

test('upstream errors never expose response bodies or secret-bearing network messages', async () => {
  for (const [status, code, retryable] of [[401, 'QLOO_AUTH', false], [403, 'QLOO_FORBIDDEN', false], [429, 'QLOO_RATE_LIMIT', true], [500, 'QLOO_UPSTREAM', true]]) {
    const client = new QlooClient({ apiKey: 'secret-fixture', fetchImpl: async () => new Response('secret-fixture', { status }) });
    await assert.rejects(client.searchEntities({ query: 'Example' }), error => {
      assert.ok(error instanceof QlooError);
      assert.equal(error.code, code);
      assert.equal(error.retryable, retryable);
      assert.equal(JSON.stringify(error).includes('secret-fixture'), false);
      assert.equal(error.message.includes('secret-fixture'), false);
      return true;
    });
  }
  const client = new QlooClient({ apiKey: 'secret-fixture', fetchImpl: async () => { throw new Error('URL contains secret-fixture'); } });
  await assert.rejects(client.searchEntities({ query: 'Example' }), error => error.code === 'QLOO_NETWORK' && !error.message.includes('secret-fixture'));
});

test('invalid JSON and unrecognized results are reported as malformed, not successful empty calls', async () => {
  for (const response of [new Response('not json'), jsonResponse({ unrelated: [] }), jsonResponse({ results: [{ name: 'Missing identifier' }] })]) {
    const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async () => response });
    await assert.rejects(client.searchEntities({ query: 'Example' }), error => error.code === 'QLOO_RESPONSE_INVALID');
  }
});

test('a fetch which ignores cancellation still ends at the bounded timeout', async () => {
  const client = new QlooClient({ apiKey: 'fixture', timeoutMs: 15, fetchImpl: async () => new Promise(() => {}) });
  await assert.rejects(client.searchEntities({ query: 'Example' }), error => error.code === 'QLOO_TIMEOUT' && error.retryable);
});

test('known credential values cannot be echoed through reflected query fields', async () => {
  const key = 'fixtureSecret123';
  const client = new QlooClient({ apiKey: key, fetchImpl: async () => jsonResponse({ results: [] }) });
  assert.equal(JSON.stringify(await client.searchEntities({ query: key })).includes(key), false);
});

test('explainability is opt-in and preserves actual unknown field names and warnings with bounded redaction', async () => {
  const key = 'private-fixture-key';
  const requests = [];
  const source = {
    actual_fixture_key: [{ entity_id: seedA, magnitude: 0.2468 }],
    warning: `Unavailable contributor detail ${key}`,
    api_key: key,
  };
  const client = new QlooClient({ apiKey: key, fetchImpl: async url => {
    requests.push(url);
    return jsonResponse({ query: { explainability: source, authorization: key }, results: { entities: [{
      entity_id: seedB, name: 'Example Brand', query: { affinity: 0.7, explainability: { raw_fixture_shape: { [seedA]: 0.25 }, notes: 'x'.repeat(2000) } },
    }] } });
  } });
  const result = await client.getInsights({ seedEntityIds: [seedA], resultType: 'brand', explainability: true });
  assert.equal(requests[0].searchParams.get('feature.explainability'), 'true');
  assert.deepEqual(result.explainability.actual_fixture_key, source.actual_fixture_key);
  assert.equal(result.explainability.warning, 'Unavailable contributor detail [redacted]');
  assert.equal(Object.hasOwn(result.explainability, 'api_key'), false);
  assert.deepEqual(result.results[0].explainability.raw_fixture_shape, { [seedA]: 0.25 });
  assert.equal(result.results[0].explainability.notes.length, 1000);
  assert.equal(JSON.stringify(result).includes(key), false);
  await client.getInsights({ seedEntityIds: [seedA], resultType: 'brand' });
  assert.equal(requests[1].searchParams.has('feature.explainability'), false);
  await client.getInsights({ seedEntityIds: [seedA], resultType: 'brand', explainability: false });
  assert.equal(requests[2].searchParams.get('feature.explainability'), 'false');
  await assert.rejects(client.getInsights({ seedEntityIds: [seedA], resultType: 'brand', explainability: 'true' }), error => error.code === 'QLOO_INPUT_INVALID');
  assert.equal(requests.length, 3);
});

test('requested but absent explainability is never invented and excessive metadata is bounded', async () => {
  let source = { leaf: 'too deep' };
  for (let index = 0; index < 12; index++) source = { nested: source };
  const client = new QlooClient({ apiKey: 'fixture-key', fetchImpl: async () => jsonResponse({ query: { explainability: { deep: source, many: Array.from({ length: 1000 }, (_, index) => index) } }, results: [] }) });
  const result = await client.getInsights({ seedEntityIds: [seedA], resultType: 'brand', explainability: true });
  assert.ok(result.explainability.many.length <= 50);
  assert.equal(JSON.stringify(result.explainability).includes('too deep'), false);
  const missing = new QlooClient({ apiKey: 'fixture-key', fetchImpl: async () => jsonResponse({ results: [] }) });
  assert.equal(Object.hasOwn(await missing.getInsights({ seedEntityIds: [seedA], resultType: 'brand', explainability: true }), 'explainability'), false);
});
