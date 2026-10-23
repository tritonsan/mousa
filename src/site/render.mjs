// The public site's pages, drawn on the server from the gallery's records, with no script: the landing page a juror
// reads first, the gallery, one page per recorded session (its playable design, its Taste Provenance report, its
// timeline and how to run it again) and one per arm of a comparison. Reports are drawn by the report module itself,
// so a page and a report's own index.html show the same evidence.

import { renderBody, listText } from '../../plugin/server/design/report.mjs';
import { blindSpotOf, blindSpotTotals } from '../gallery/blind-spot.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`; };
const HOSTS = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex', kiro: 'Kiro' });
const MEDIA = Object.freeze({ web: 'Website', 'app-ui': 'App interface', game: 'Game', generic: 'Source design' });
const LANES = Object.freeze({ 'mousa:mousa-baseline': 'The baseline agent, without Qloo', 'mousa:mousa-designer': 'The Qloo agent' });
const hex = value => (/^#[0-9a-f]{6}$/u.test(value || '') ? value : null);

/** A page of the site: its header and navigation, the body and the footer. `refresh` reloads it every so many seconds. */
export function layout({ title, description = '', body, active = '', repository = '', image = '', refresh = 0 }) {
  const nav = [['/judges/', 'For the jury', 'judges'], ['/#how', 'How it works', 'how'], ['/gallery/', 'Evidence', 'gallery'], ['/benchmark/', 'Benchmark', 'benchmark'], ['/vote/', 'Blind vote', 'vote'], ['/try/', 'Try it', 'try']];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>${description ? `<meta name="description" content="${escape(description)}">` : ''}${image ? `<meta property="og:image" content="${escape(image)}">` : ''}${Number.isInteger(refresh) && refresh > 0 ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<link rel="stylesheet" href="/site/report.css"><link rel="stylesheet" href="/site/site.css"><link rel="stylesheet" href="/brand.css"></head>
<body class="site mr"><a class="site-skip" href="#main">Skip to the content</a>
<header class="site-head"><a class="site-mark" href="/" aria-label="Moûsa home"><span class="brand-lockup"><img src="/assets/mousa-logo.png" alt="Moûsa" width="1254" height="1254"></span></a>
<nav aria-label="Site">${nav.map(([href, label, key]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav></header>
<main id="main">${body}</main>
<footer class="site-foot"><p>Moûsa is an entry to the Qloo Agentic Hackathon. Taste data from <a href="https://www.qloo.com/">Qloo</a>; fonts from the open-licence library the plugin carries (SIL OFL 1.1).${repository ? ` Source: <a href="${escape(repository)}">${escape(repository.replace(/^https?:\/\//u, ''))}</a>, MIT licence.` : ' MIT licence.'}</p>
<p>Every page here is drawn from the sessions' own records. Qloo's ids, affinity scores, popularity and descriptions are not published; each design choice is the agent's interpretation of the names shown. <a href="/qloo/">How Moûsa uses Qloo</a> · <a href="/studio">The Studio</a></p></footer>
</body></html>`;
}

const qlooRecord = record => record?.kind === 'comparison' ? (record.records || []).find(item => item.taste === 'qloo') || record.records?.[0] : record;
const swatches = colors => `<span class="site-swatches">${(colors || []).map(hex).filter(Boolean).slice(0, 7).map(color => `<i style="background:${color}"></i>`).join('')}</span>`;
const chip = (item, small = '') => `<span class="mr-chip" data-mark="${escape(item.mark)}">${escape(item.name)}${small ? ` <small>${escape(small)}</small>` : ''}</span>`;
/** An index entry's blind spot: from the index when the gallery carries it, else from the entry's loaded record. */
const spotOf = (gallery, entry) => entry.blindSpot || blindSpotOf(gallery?.entries?.get(entry.id)?.record);
const spotSentence = spot => spot ? `The agent's guess named ${spot.known} of the ${spot.works} works Qloo measured.` : '';
const card = (entry, { base = '/gallery/', spot = null } = {}) => `<a class="site-card" href="${base}${escape(entry.id)}/"><span class="site-card-image">${entry.card ? `<img src="/gallery/${escape(entry.id)}/${escape(entry.card)}" alt="" width="1200" height="630">` : ''}</span>
<span class="site-card-text"><span class="site-tags"><span>${escape(HOSTS[entry.host] || entry.host)}</span><span>${escape(MEDIA[entry.medium] || entry.medium || '')}</span>${entry.kind === 'comparison' ? '<span>Comparison</span>' : ''}${entry.origin === 'try' ? '<span>Live try</span>' : ''}${entry.surface ? '<span>0.4 surface</span>' : ''}</span>
<b>${escape(entry.title)}</b><span>${escape(spotSentence(spot) || entry.headline?.sentence || '')}</span></span></a>`;

/** The steps of the featured session, in its own data: what the model guessed, what Qloo found and what the design rests on. */
function howItWorks(entry) {
  const record = qlooRecord(entry?.record);
  if (!record) return '';
  const sketch = record.prediction?.sketch;
  const predicted = (record.prediction?.groups || []).filter(group => group.quality).flatMap(group => group.entries).slice(0, 5);
  const found = Object.values(record.measured?.qualities || {}).flat().filter(item => item.mark === 'new').slice(0, 6);
  const devices = (record.dna?.devices || []).filter(device => device.surprise).slice(0, 3);
  const counts = record.measured?.counts || {};
  return `<section class="site-section" id="how"><div class="site-head-row"><h2>How it works</h2><p>Four steps every Moûsa session takes, shown with the data of one recorded session: ${escape(entry.title)}.</p></div>
<ol class="site-steps">
<li><b>1. The agent guesses first.</b><p>Before any data, it freezes its own prediction of what the audience loves, and the design it would make from that alone.</p>${sketch ? `<p class="site-quote">“${escape(sketch.summary)}”</p>${swatches(sketch.palette)}` : ''}
${predicted.length ? `<p class="site-small">It expected: ${escape(listText(predicted.map(item => item.name)))}.</p>` : ''}</li>
<li><b>2. Qloo measures the audience.</b><p>What the audience loves across films, music, books, games and brands, and the qualities those works share.${counts.works !== undefined ? ` Here: ${escape(counts.works)} works, ${escape(counts.worksPredicted ?? 0)} of them predicted.` : ''}</p>
<p class="site-chips">${found.map(item => chip(item, 'new')).join('')}</p></li>
<li><b>3. The design must rest on what the guess missed.</b><p>Each device of the Design DNA is anchored to measured names, and the surprises have to move it away from the frozen sketch.</p>
<ul class="site-devices">${devices.map(device => `<li><span class="mr-layer">${escape(device.layer)}</span> ${escape(device.device)}<span class="site-chips">${(device.anchors || []).slice(0, 2).map(anchor => chip(anchor)).join('')}</span></li>`).join('')}</ul></li>
<li><b>4. The record shows it.</b><p>The agent checks, captures and reviews its build, and Moûsa writes the Taste Provenance page from the session's own records: names only, every interpretation marked.</p>
<p><a class="site-link" href="/gallery/${escape(entry.id)}/">Read this session's record</a></p></li></ol></section>`;
}

/** The featured comparison's first pair of captures, side by side, with the distance. */
function featuredPair(entry) {
  const record = entry?.record;
  const view = record?.kind === 'comparison' ? (record.views || []).find(item => item.a && item.b) : null;
  if (!view) return '';
  const arms = record.arms || [];
  return `<section class="site-feature" aria-label="A recorded comparison"><div class="site-pair">${[[arms[0], view.a], [arms[1], view.b]].map(([arm, capture]) =>
    `<figure><img src="/gallery/${escape(entry.id)}/report/${escape(capture.file)}" alt="${escape(`${arm?.label}: ${capture.label}`)}" width="${escape(capture.width)}" height="${escape(capture.height)}"><figcaption><b>${escape(arm?.label)}</b> ${escape(arm?.headline?.sentence || '')}</figcaption></figure>`).join('')}</div>
<p class="site-feature-text"><b>${escape(entry.title)}.</b> One brief, ${record.samePrediction ? 'one frozen prediction' : 'two predictions'}, the same stages; only the source of the taste differs. Distance ${escape(Number(record.distance?.overall ?? 0).toFixed(2))} on a heuristic scale from 0 to 1. <a class="site-link" href="/gallery/${escape(entry.id)}/">See the whole comparison</a></p></section>`;
}

function install(repository) {
  const where = repository || '<this repository>';
  return `<section class="site-section" id="agents"><div class="site-head-row"><h2>One engine, three agents</h2><p>The same Moûsa tools and skills run in each host. Every person uses their own Qloo API key, entered on a local page that never passes it through the chat.</p></div>
<div class="site-agents"><div class="mr-card"><h3>Claude Code</h3><pre><code>/plugin marketplace add ${escape(where)}
/plugin install mousa@mousa</code></pre><p class="site-small">Comparisons run as two subagents at once.</p></div>
<div class="mr-card"><h3>Codex</h3><pre><code>codex plugin marketplace add ${escape(where)}
codex plugin add mousa@mousa</code></pre><p class="site-small">Codex's own image tool can paint the pictures a plan asks for.</p></div>
<div class="mr-card"><h3>Kiro</h3><pre><code>plugins/kiro</code></pre><p class="site-small">A Kiro agent that runs the same server and skills. The recorded Kiro session used the earlier 0.4 surface.</p></div></div></section>`;
}

const PUBLISHED = `<section class="site-section" id="published"><div class="site-head-row"><h2>What is published, and what is not</h2><p>The evidence is meant to be checked, and to stay fair to Qloo's data and to the people who ran it.</p></div>
<div class="site-grid two"><div class="mr-card"><h3>Here</h3><ul><li>The request, the audience and each host, model and version.</li><li>The frozen prediction and sketch, and the names Qloo measured, marked new or predicted.</li><li>The reading, the Design DNA with its tokens, the captures, the review and the check.</li><li>The design itself, playable, and the commit and command that ran it.</li></ul></div>
<div class="mr-card"><h3>Not here</h3><ul><li>Qloo's ids, affinity scores, popularity and descriptions, and its raw answers.</li><li>The session streams, tool inputs and outputs, and the model's private text.</li><li>Local paths, user names, keys and tokens: a scan of every file blocks a gallery that holds one.</li></ul></div></div></section>`;

/** The landing page: the idea, the featured comparison, how it works in recorded data, the agents and the gallery. */
export function landingPage({ gallery, repository = '' }) {
  const index = gallery.index;
  const featured = gallery.entries.get(index?.featured) || [...gallery.entries.values()][0];
  const spot = index?.blindSpot?.sessions ? index.blindSpot
    : blindSpotTotals([...gallery.entries.values()].map(entry => ({ id: entry.id, host: entry.host, blindSpot: entry.blindSpot || blindSpotOf(entry.record) })));
  const stat = spot.works ? `<p class="site-hero-stat"><b>${escape((100 * spot.missed).toFixed(1))}%</b><span>of the works Qloo measured were missing from the agents' own sealed guesses: ${escape(spot.works - spot.known)} of ${escape(spot.works)}, in ${escape(spot.sessions)} recorded sessions in Claude Code, Codex and Kiro.</span></p>` : '';
  const body = `<section class="site-hero"><p class="mr-kicker">The taste layer for AI agents</p><h1>Design that rests on what an audience actually loves.</h1>
<p class="site-lede">Moûsa makes an AI agent write down its own guess about an audience before it sees any data. Then Qloo measures that audience, and every choice in the design has to rest on what the guess did not contain. Each session leaves a record of where its choices came from.</p>
${stat}<p class="site-actions"><a class="site-button" href="/judges/">Start here: for the jury</a><a class="site-button quiet" href="/try/">Try it with your own audience</a><a class="site-button quiet" href="/vote/">Judge two designs blind</a></p></section>
${featuredPair(featured)}${howItWorks(featured)}${install(repository)}
<section class="site-section" id="gallery"><div class="site-head-row"><h2>Recorded sessions</h2><p>${escape(index?.entries.length ?? 0)} sessions in Claude Code, Codex and Kiro. Each page shows the design, its record and how to run it again.</p></div>
<div class="site-cards">${(index?.entries || []).map(entry => card(entry, { spot: spotOf(gallery, entry) })).join('')}</div></section>${PUBLISHED}`;
  return layout({ title: 'Moûsa: design grounded in measured taste', description: 'An AI agent freezes its own guess, Qloo measures the audience, and every design choice rests on what the guess did not contain.',
    body, repository, image: featured?.report?.card ? `/gallery/${featured.id}/${featured.report.card}` : '' });
}

/** Every entry of the gallery, comparisons first. */
export function galleryPage({ gallery, repository = '' }) {
  const entries = gallery.index?.entries || [];
  const group = (title, note, list) => list.length ? `<section class="site-section"><div class="site-head-row"><h2>${escape(title)}</h2><p>${escape(note)}</p></div><div class="site-cards">${list.map(entry => card(entry, { spot: spotOf(gallery, entry) })).join('')}</div></section>` : '';
  const body = `<section class="site-hero small"><p class="mr-kicker">Evidence</p><h1>Recorded sessions</h1><p class="site-lede">Each one ran with the Moûsa plugin in a real agent host. Open one for its design, its Taste Provenance record, what the agent did step by step and how to run it again.</p></section>
${group('With Qloo and without', 'One frozen prediction, two arms; only the source of the taste differs.', entries.filter(entry => entry.kind === 'comparison'))}
${group('Single sessions', 'One design each, measured with Qloo.', entries.filter(entry => entry.kind !== 'comparison'))}`;
  return layout({ title: 'Recorded sessions · Moûsa', body, active: 'gallery', repository });
}

/** A session's steps, lane by lane: the tools in order, a refused Moûsa call marked with its code. */
export function timelineBlock(timeline) {
  if (!timeline?.lanes?.length) return '';
  const totals = timeline.totals || {};
  const time = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
  const lanes = timeline.lanes.map(lane => `<div class="mr-card site-lane"><h3>${escape(LANES[lane.label] || lane.label)}</h3><ol class="site-steps-inline">${lane.steps.map(step => {
    const kind = step.tool.startsWith('mousa:') ? 'mousa' : step.tool.replace(/\s+/gu, '-');
    const name = step.tool.replace(/^mousa:/u, '');
    return `<li data-kind="${escape(kind)}" data-status="${escape(step.status)}"${Number.isFinite(step.at) ? ` title="${escape(time(step.at))}"` : ''}>${Number.isFinite(step.at) ? `<time>${escape(time(step.at))}</time> ` : ''}${escape(name)}${step.detail ? ` <em>${escape(step.detail)}</em>` : ''}${step.count ? ` ×${escape(step.count)}` : ''}${step.status === 'refused' ? ` <strong>refused${step.code ? `: ${escape(step.code)}` : ''}</strong>` : step.status === 'error' ? ' <strong>error</strong>' : ''}</li>`;
  }).join('')}</ol></div>`).join('');
  return `<section class="mr-section" id="timeline"><div class="mr-section-head"><h2>What the agent did</h2><p>${escape(`${totals.mousa ?? 0} Moûsa calls${totals.refused ? `, ${totals.refused} refused by a validator and repaired` : ''}; ${totals.reads ?? 0} reads, ${totals.writes ?? 0} writes and ${totals.shell ?? 0} shell commands. Tool names, stages and outcomes only: no file contents, commands or model text.`)}</p></div>${lanes}</section>`;
}

function playBlock(entry, previewBase, only = null) {
  const items = (entry.play || []).filter(item => !only || item.path.startsWith(`out/${only}/`));
  if (!items.length) return '';
  const frame = entry.medium === 'app-ui' ? 'phone' : entry.medium === 'game' ? 'wide' : 'desktop';
  const url = file => `${previewBase}/gallery/${entry.id}/${file}`;
  return `<section class="mr-section" id="play"><div class="mr-section-head"><h2>${items.length > 1 ? 'Play both' : 'Play it'}</h2><p>The design's own files as the session left them, running sandboxed on a separate origin.${entry.before ? ' The starter it restyled is beside it.' : ''}</p></div>
<div class="site-frames" data-frame="${frame}" data-count="${items.length + (entry.before && !only ? 1 : 0)}">${[...items.map(item => [item.label, item.path]), ...(entry.before && !only ? [['Before: the starter', entry.before]] : [])].map(([label, file]) =>
    `<figure><iframe src="${escape(url(file))}" title="${escape(`${label}: ${entry.title}`)}" sandbox="allow-scripts allow-forms" loading="lazy" referrerpolicy="no-referrer"></iframe><figcaption><b>${escape(label)}</b> <a href="${escape(url(file))}" target="_blank" rel="noopener noreferrer">Open full screen</a></figcaption></figure>`).join('')}</div></section>`;
}

function factsBlock(entry) {
  const facts = [['Host', `${HOSTS[entry.host] || entry.host}${entry.hostVersion ? ` ${entry.hostVersion}` : ''}`], ['Model', entry.model], ['Moûsa', `${entry.surfaceVersion || 'unknown'}${entry.surface ? `, the ${entry.surface}` : ''}`],
    ['Started', day(entry.startedAt)], ['Time', Number.isFinite(entry.minutes) ? `${entry.minutes} minutes${entry.turns ? `, ${entry.turns} turns` : ''}` : null],
    ['Qloo requests', Number.isInteger(entry.qlooRequests) ? String(entry.qlooRequests) : 'not counted by the 0.4 surface'], ['Pictures', entry.pictures]].filter(([, value]) => value);
  return `<dl class="site-facts">${facts.map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
}

function reproduceBlock(entry) {
  const reproduce = entry.reproduce;
  if (!reproduce) return '';
  return `<section class="mr-section" id="reproduce"><div class="mr-section-head"><h2>Run it again</h2><p>${escape(reproduce.note || '')}</p></div><div class="site-grid two">
<div class="mr-card"><p class="mr-label">The request</p><blockquote class="mr-copy">${escape(entry.brief)}</blockquote></div>
<div class="mr-card"><p class="mr-label">The command</p><p class="site-small">From the repository at commit <code class="mr-code">${escape(reproduce.commit || 'unknown')}</code>:</p><pre><code>${escape(reproduce.command)}</code></pre><ul>${(reproduce.needs || []).map(item => `<li>${escape(item)}</li>`).join('')}</ul></div></div></section>`;
}

const downloads = (entry, base) => `<section class="mr-section" id="files"><div class="mr-section-head"><h2>The record's files</h2><p>The same evidence as data and as pictures, for reading without this site.</p></div>
<p class="site-files"><a href="${base}report/index.html">The report on its own</a><a href="${base}report/record.json">record.json</a>${entry.report?.picture ? `<a href="${base}${escape(entry.report.picture)}">The whole report as one picture</a>` : ''}${entry.report?.card ? `<a href="${base}${escape(entry.report.card)}">The card</a>` : ''}</p></section>`;

/** A recorded session's page: its facts, the design to play, the report, the timeline, the command and the files. */
export function entryPage({ entry, previewBase, families = [], repository = '' }) {
  const base = `/gallery/${entry.id}/`;
  const body = `<div class="site-page"><nav class="site-crumbs" aria-label="Breadcrumb"><a href="/gallery/">Evidence</a> <span aria-hidden="true">/</span> <span>${escape(entry.title)}</span></nav>
<header class="site-entry-head"><p class="mr-kicker">${entry.origin === 'try' ? (entry.tryBy === 'juror' ? 'A juror\'s live try' : 'A live try, recorded') : 'Recorded'} ${escape(day(entry.startedAt))} · ${escape(HOSTS[entry.host] || entry.host)}</p><h1>${escape(entry.title)}</h1>${entry.summary ? `<p class="site-lede">${escape(entry.summary)}</p>` : ''}${factsBlock(entry)}</header>
${playBlock(entry, previewBase)}
<div class="site-report">${renderBody(entry.record, { base: `${base}report/`, fonts: families })}</div>
${timelineBlock(entry.timeline)}${reproduceBlock(entry)}${downloads(entry, base)}</div>`;
  return layout({ title: `${entry.title} · Moûsa`, description: entry.headline?.sentence || entry.summary || '', body, active: 'gallery', repository, image: entry.report?.card ? `${base}${entry.report.card}` : '' });
}

/** One arm of a comparison on its own: its design to play and its own report, with the way back to the comparison. */
export function armPage({ entry, arm, record, previewBase, families = [], repository = '' }) {
  const base = `/gallery/${entry.id}/`;
  const label = (entry.arms || []).find(item => item.folder === arm)?.label || arm;
  const body = `<div class="site-page"><nav class="site-crumbs" aria-label="Breadcrumb"><a href="/gallery/">Evidence</a> <span aria-hidden="true">/</span> <a href="${base}">${escape(entry.title)}</a> <span aria-hidden="true">/</span> <span>${escape(label)}</span></nav>
<header class="site-entry-head"><p class="mr-kicker">One arm of a comparison · ${escape(label)}</p><h1>${escape(entry.title)}: ${escape(label)}</h1>${factsBlock(entry)}</header>
${playBlock(entry, previewBase, arm)}
<div class="site-report">${renderBody(record, { base: `${base}report/arms/${arm}/`, fonts: families })}</div>
<p class="site-back"><a class="site-link" href="${base}">Back to the comparison</a></p></div>`;
  return layout({ title: `${entry.title}: ${label} · Moûsa`, body, active: 'gallery', repository });
}

/** The live try before it opens: what it will do, and the recorded sessions meanwhile. */
export function tryPendingPage({ repository = '' } = {}) {
  const body = `<section class="site-hero small"><p class="mr-kicker">Try it live</p><h1>The live try is not open yet.</h1>
<p class="site-lede">It will run Moûsa in Kiro on this server for the jury, behind an access code. First, in about two minutes, the model's frozen guess about the audience you name is set beside what Qloo measures. Then, if you like, the server builds a design with Qloo and one without, from the same guess.</p>
<p class="site-actions"><a class="site-button" href="/gallery/">See the recorded sessions</a></p></section>`;
  return layout({ title: 'Try it live · Moûsa', body, active: 'try', repository });
}

/** A page the site does not have, in its own layout. */
export function missingPage({ repository = '' } = {}) {
  return layout({ title: 'Not found · Moûsa', body: '<section class="site-hero small"><h1>That page is not here.</h1><p class="site-lede"><a class="site-link" href="/">Back to the start</a></p></section>', repository });
}
