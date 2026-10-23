// The pages a juror reads first: Moûsa in one minute, with the numbers the gallery's own records give, a path through
// the evidence and what each kind of evidence does and does not show; and how Moûsa uses Qloo, request by request,
// with what the live API taught it. Drawn on the server with no script, like the rest of the site.

import { layout } from './render.mjs';
import { blindSpotOf, blindSpotTotals } from '../gallery/blind-spot.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
// One decimal everywhere, so this page and the landing page show the same figure.
const percent = value => value === null || value === undefined ? '' : `${(100 * value).toFixed(1)}%`;

/** The gallery's blind spot, from the index when it carries it and from each entry's record otherwise. */
export function galleryBlindSpot(gallery) {
  if (gallery?.index?.blindSpot?.sessions) return gallery.index.blindSpot;
  return blindSpotTotals([...(gallery?.entries?.values() || [])].map(entry => ({ id: entry.id, host: entry.host, blindSpot: entry.blindSpot || blindSpotOf(entry.record) })));
}

/** The recorded comparisons' distances, smallest first. */
function distances(gallery) {
  return [...(gallery?.entries?.values() || [])].filter(entry => entry.kind === 'comparison' && entry.distance?.overall !== undefined)
    .map(entry => Number(entry.distance.overall)).sort((a, b) => a - b);
}

function ladder(spot, gallery, benchmark) {
  const range = distances(gallery);
  const rows = [
    ['The blind spot', spot.sessions ? `In ${spot.sessions} recorded sessions in Claude Code, Codex and Kiro, the agents' frozen guesses named ${spot.known} of the ${spot.works} works Qloo measured, and ${spot.confirmed} of the ${spot.guessed} works they guessed were measured.` : '',
      'Counted from each session\'s own record; anyone can recount them from the release\'s gallery bundle with scripts/blind-spot-stats.mjs.',
      'The sessions share a few audiences, and Qloo measures more works than an agent names, so the share is bounded by the two list sizes. It says nothing yet about the design.'],
    ['The pre-registered benchmark', benchmark?.hosts ? benchmarkSentence(benchmark) : 'Twenty audiences and three agents. The protocol and the agents\' sealed predictions were committed to the public repository before Qloo measured any audience.',
      'Protocol, amendments and predictions are public and dated; every run is reported, whatever it shows.',
      'One prompt, one brief and one run per agent and audience. Qloo\'s measurement is aggregate affinity, not ground truth about any person.'],
    ['The mechanism', range.length ? `${range.length} recorded pairs, each built twice from one frozen guess: once with Qloo's measurement, once from the guess alone. Distance between the two designs: ${range[0].toFixed(2)} to ${range.at(-1).toFixed(2)}, and every device of each Qloo design rests on a name the guess missed.` : '',
      'Both arms share the brief, the guess and every stage; only the source of the taste differs.',
      'The distance is a heuristic over palette, type, structure and CSS, from 0 (alike) to 1 (unrelated). It does not rate quality.'],
    ['Beyond the model\'s own variance', 'Repeated pairs of one website brief (3 October, 12 generations): the blind sketches of both arms were alike (p = 0.81), and after Qloo the typography, structure, palette and overall distance separated beyond the model\'s variance (exact permutation test, p = 0.005 each). For game characters, the finished characters separated (p = 0.0079) while the blind sketches did not.',
      'Both arms start from comparable blind sketches and only the Qloo arm moves, so the difference is attributable to the measurement.',
      'One brief and one model per study; it shows difference, not preference. Recorded in the development notes.'],
    ['Preference', 'The blind vote shows a visitor both designs of a pair without saying which used Qloo, and asks which the audience would rather have.',
      'Ballots are sealed; the results page counts every vote.',
      'Visitors choose themselves and are few; it is not a study of the audience.'],
  ];
  return `<ol class="site-ladder">${rows.map(([title, finding, strength, limit], index) => `<li><span class="site-ladder-step">${index + 1}</span><div><h3>${escape(title)}</h3><p>${escape(finding)}</p>
<p class="site-small"><b>Why it holds:</b> ${escape(strength)}</p><p class="site-small"><b>What it does not show:</b> ${escape(limit)}</p></div></li>`).join('')}</ol>`;
}

/** One sentence for the benchmark's headline, from its results. */
export function benchmarkSentence(benchmark) {
  const parts = Object.entries(benchmark.hosts || {}).filter(([, row]) => row.knownShare?.mean !== null && row.knownShare?.mean !== undefined)
    .map(([host, row]) => `${{ 'claude-code': 'Claude Code', codex: 'Codex', kiro: 'Kiro' }[host] || host} ${percent(row.knownShare.mean)}`);
  return parts.length ? `Over ${benchmark.measurable} audiences, the share of measured works each agent's sealed guess already named: ${parts.join(', ')}.` : '';
}

/** Moûsa in one minute: what it is, the numbers, a path through the evidence and what each kind shows. */
export function judgesPage({ gallery, benchmark = null, repository = '' }) {
  const spot = galleryBlindSpot(gallery);
  const featured = gallery?.index?.featured || '';
  const tryEntry = [...(gallery?.entries?.values() || [])].find(entry => entry.origin === 'try')?.id || featured;
  const numbers = [
    spot.works ? [percent(spot.missed), `of the works Qloo measured were missing from the agents' own frozen guesses: ${spot.works - spot.known} of ${spot.works}, in ${spot.sessions} recorded sessions.`] : null,
    spot.guessed ? [percent(spot.confirmedShare), `of the works the agents guessed turned up in Qloo's measurement: ${spot.confirmed} of ${spot.guessed}.`] : null,
    ['3', 'agents run the same plugin: Claude Code, Codex and Kiro, on the project a team already has.'],
  ].filter(Boolean);
  const body = `<section class="site-hero small"><p class="mr-kicker">For the jury</p><h1>Moûsa in one minute</h1>
<p class="site-lede">Moûsa is a plugin for the design agents teams already use. Before the agent designs anything, it writes down and seals its own guess about the audience. Qloo then measures that audience, and every design choice has to rest on what the guess missed. Each session ends with a record that sets the guess beside the measurement.</p></section>
<section class="site-section"><div class="site-stats">${numbers.map(([value, text]) => `<p class="site-stat"><b>${escape(value)}</b><span>${escape(text)}</span></p>`).join('')}</div></section>
<section class="site-section"><div class="site-head-row"><h2>A path through the evidence</h2><p>Each step stands on its own; the first three take under four minutes.</p></div>
<ol class="site-path">
<li><b>Look at one pair.</b> <a class="site-link" href="/gallery/${escape(tryEntry)}/">A record shop's website for people who love Paterson and Nujabes</a>: play the design made from the agent's guess and the one made from Qloo's measurement, side by side.</li>
<li><b>Read its record.</b> The same page shows the sealed guess, the names Qloo measured marked new or predicted, and each design device traced to the names it rests on.</li>
<li><b>Try your own audience.</b> <a class="site-link" href="/try/">Open the live try</a> with the code from the testing instructions and name two or three works you love. In about two minutes Moûsa shows Kiro's sealed guess beside Qloo's measurement. Building both designs takes fifteen to thirty minutes more, and is optional.</li>
<li><b>See the benchmark.</b> <a class="site-link" href="/benchmark/">Twenty audiences, three agents</a>, with the predictions published before Qloo measured anything.</li>
<li><b>Vote blind.</b> <a class="site-link" href="/vote/">Which design would the audience rather have?</a> You see which one used Qloo only after you vote.</li></ol></section>
<section class="site-section"><div class="site-head-row"><h2>What the evidence shows, and what it does not</h2><p>Five kinds, from the simplest count to a preference. Each says how strong it is and where it stops.</p></div>${ladder(spot, gallery, benchmark)}</section>
<section class="site-section"><div class="site-grid two"><div class="mr-card"><h3>How Moûsa uses Qloo</h3><p>Search to resolve the audience's names, Insights across films, music, books, TV, brands, podcasts, games and places, and tag rankings for the qualities those works share: at most 24 requests a session, cached for a week. <a class="site-link" href="/qloo/">Request by request, and what the live API taught us</a>.</p></div>
<div class="mr-card"><h3>How it is built</h3><p>One MCP server in Node 22 with no dependencies, packaged for three hosts from one source; a write gate that holds a design until its Design DNA is valid; checks through the project's own CSS variables, tokens or Tailwind theme; captures in a sandboxed headless Chromium; more than 500 tests on Ubuntu and Windows; this site on one AWS stack.${repository ? ` <a class="site-link" href="${escape(repository)}">The source</a>.` : ''}</p></div></div></section>`;
  return layout({ title: 'For the jury · Moûsa', description: 'Moûsa in one minute: the numbers, a path through the evidence, and what each kind of evidence does and does not show.', body, active: 'judges', repository });
}

const REQUESTS = [
  ['/search', 'Resolves each name the audience is described by. A match counts only when the meaningful words of both names agree; a work or creator wins over a same-named place.', 'Which works the measurement starts from, and which names are reported as unresolved.'],
  ['/v2/tags', 'Resolves genre and interest words to tags, typed first for music genres.', 'Seeds an audience named by a genre rather than a work.'],
  ['/v2/audiences', 'Resolves audience descriptions such as "parents with young children" to Qloo audience segments.', 'Weights every Insights request toward that segment.'],
  ['/v2/insights, entities', 'One request per taste domain the medium needs: brands, films, artists, books, TV, podcasts, games or places. The resolved seeds go in signal.interests.entities, the seeds themselves are excluded, explainability is asked for, and brands and films are asked again below a popularity cap for lesser-known neighbours. An optional place and age bands weight every request.', 'The works the audience loves: the names the agent\'s guess is compared with, and the anchors of the Design DNA.'],
  ['/v2/insights, tags', 'Two audience-level rankings, style and aesthetic properties, sent apart: in one combined request, no aesthetic tag reached the first twelve.', 'The pacing, surfaces and tone that direct motion and illustration.'],
  ['Typed tags of the returned works', 'No request: the tags each measured work carries are grouped by their Qloo type into look, mood and meaning. A tag two or more works share becomes a quality.', 'Palette, type and voice anchor to qualities, so one loud keyword cannot become the design.'],
  ['/v2/insights with filter.results.entities', 'Ranks a shortlist the agent gives, on one scale.', 'Answers a design question between named options, such as which of three references fits.'],
];
const FINDINGS = [
  'The search for "Paterson" returned the city before the film, so a work or creator now wins over a same-named place, and places belong in the location signal.',
  '"Studio Ghibli films" matched the music artist Studio Ghibli, and "ambient music" an artist named Ambient Music. A reference\'s last word now decides which kind of entity may seed it.',
  'The canonical game type urn:entity:videogame returned 200; the hackathon guide\'s video_game spelling returned 400 in this environment.',
  'A style ranking seeded with an entity and a genre tag together returned HTTP 500; with the entity alone it returned eight tags. Tag rankings now take entity seeds when any resolved.',
  'Four requests in parallel hit the rate limit on three of seven; two at a time, with a short retry, does not. Timeouts on a busy afternoon answered a minute later.',
  'A work\'s first keyword can take over a design: the hockey team LA Kings brought a black-and-silver palette tag to a food shop. Grouping typed tags into shared qualities stopped it.',
  'Books in the recorded passes carried no typed look, mood or meaning tag, and brands\' look tags describe their logos more than the audience\'s taste.',
  'Unsupported parameters can be ignored silently with a 200, so Moûsa records what it asked and reads the returned context before saying a filter applied.',
];

/** How Moûsa uses Qloo: each request, what it decides, the budget and cache, the data rule and what the live API taught it. */
export function qlooPage({ repository = '' } = {}) {
  const body = `<section class="site-hero small"><p class="mr-kicker">Qloo in Moûsa</p><h1>Request by request</h1>
<p class="site-lede">Moûsa calls the Qloo Insights API at hackathon.api.qloo.com with GET requests and the key in X-Api-Key, never through the model. A session measures its audience once, at most 24 requests, after the agent's guess is sealed, and answers later taste questions from that measurement.</p></section>
<section class="site-section"><div class="site-head-row"><h2>What each request decides</h2><p>The measurement is the engine's, so every agent and every host sends the same requests for the same audience.</p></div>
<div class="site-requests">${REQUESTS.map(([request, what, decides]) => `<div class="mr-card"><p class="mr-label">${escape(request)}</p><p>${escape(what)}</p><p class="site-small"><b>Decides:</b> ${escape(decides)}</p></div>`).join('')}</div></section>
<section class="site-section"><div class="site-grid two"><div class="mr-card"><h3>Budget and cache</h3><ul><li>At most 24 requests a session; a live try's measurement used 12.</li><li>Answers are cached in the project for a week, so a second design for the same audience costs nothing.</li><li>Requests go two at a time, with a short retry on a rate limit, a timeout or a server error, each counted toward the budget.</li></ul></div>
<div class="mr-card"><h3>Qloo's data stays private</h3><ul><li>The cache lives only on the machine or server that asked.</li><li>This site and the public repository show the names Qloo measured, never its ids, affinity scores, popularity or descriptions.</li><li>A test fails the repository's build if a Qloo id or a scored entity is committed.</li></ul></div></div></section>
<section class="site-section"><div class="site-head-row"><h2>What the live API taught us</h2><p>Each of these came from a recorded request and changed the engine.</p></div><ul class="site-findings">${FINDINGS.map(item => `<li>${escape(item)}</li>`).join('')}</ul>
${repository ? `<p class="site-small">The full account, with the requests and their dates: <a class="site-link" href="${escape(repository)}/blob/main/docs/qloo-integration.md">docs/qloo-integration.md</a>.</p>` : ''}</section>`;
  return layout({ title: 'Qloo in Moûsa', description: 'How Moûsa uses the Qloo Insights API, request by request, and what the live API taught it.', body, active: 'qloo', repository });
}
