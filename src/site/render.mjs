// The public site's pages, drawn on the server from the gallery's records, with no script: the landing page a juror
// reads first, the gallery, one page per recorded session (its playable design, its Taste Provenance report, its
// timeline and how to run it again) and one per arm of a comparison. Reports are drawn by the report module itself,
// so a page and a report's own index.html show the same evidence.

import { renderBody, listText } from '../../plugin/server/design/report.mjs';
import { blindSpotOf, blindSpotTotals, benchmarkTotals } from '../gallery/blind-spot.mjs';
import { anchoredPairs, benchmarkSentence, distances } from './judge-pages.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`; };
const HOSTS = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex', kiro: 'Kiro' });
const MEDIA = Object.freeze({ web: 'Website', 'app-ui': 'App interface', game: 'Game', generic: 'Source design' });
const LANES = Object.freeze({ 'mousa:mousa-baseline': 'The baseline agent, without Qloo', 'mousa:mousa-designer': 'The Qloo agent' });
const hex = value => (/^#[0-9a-f]{6}$/u.test(value || '') ? value : null);

/** A page of the site: its header and navigation, the body and the footer. `refresh` reloads it every so many seconds. */
export function layout({ title, description = '', body, active = '', repository = '', image = '', refresh = 0 }) {
  const nav = [['/judges/', 'For the jury', 'judges'], ['/showcase/', 'Showcase', 'showcase'], ['/gallery/', 'Evidence', 'gallery'], ['/benchmark/', 'Benchmark', 'benchmark'], ['/vote/', 'Blind vote', 'vote'], ['/try/', 'Try it', 'try']];
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
const houseSentence = house => !house ? '' : Array.isArray(house) ? `Signatures of the look models default to: ${house.map(item => `${item.label} ${item.count}`).join(', ')} of ${house[0].of}.`
  : `Signatures of the look models default to: ${house.count} of ${house.of}.`;
const card = (entry, { base = '/gallery/', spot = null } = {}) => `<a class="site-card" href="${base}${escape(entry.id)}/"><span class="site-card-image">${entry.card ? `<img src="/gallery/${escape(entry.id)}/${escape(entry.card)}" alt="" width="1200" height="630">` : ''}</span>
<span class="site-card-text"><span class="site-tags"><span>${escape(HOSTS[entry.host] || entry.host)}</span><span>${escape(MEDIA[entry.medium] || entry.medium || '')}</span>${entry.kind === 'comparison' ? '<span>Comparison</span>' : ''}${entry.origin === 'try' ? '<span>Live try</span>' : ''}${entry.surface ? '<span>0.4 surface</span>' : ''}</span>
<b>${escape(entry.title)}</b><span>${escape(spotSentence(spot) || entry.headline?.sentence || '')}</span>${entry.houseStyle ? `<span>${escape(houseSentence(entry.houseStyle))}</span>` : ''}</span></a>`;

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

// The landing page tells one recorded pair the way a short film would: the two designs at play, the blind spot, the
// session step by step, what else the measurement changed, the evidence and how to try it. Every name, count and
// device on it comes from the records; the story's phrases come from the gallery config.
const ANTHROPIC_ARTICLE = 'https://claude.com/resources/articles/improving-frontend-design-through-skills';
const MECHANICS = ['interaction', 'structure'];
const LOOKS = ['palette', 'typography'];
/** A comparison's arms with the guess first: each arm's index in the record and whether it is the Qloo arm. */
function armsGuessFirst(record) {
  const arms = record?.arms || [];
  const qloo = Math.max(0, arms.findIndex(arm => arm.taste === 'qloo'));
  return [...arms.keys()].sort((a, b) => (a === qloo) - (b === qloo)).map(index => ({ index, arm: arms[index], qloo: index === qloo }));
}
/** The devices both arms' Design DNA have on the first of `layers` they share, arm by arm in the record's order. */
function devicesOn(record, layers) {
  for (const name of layers) {
    const row = (record?.layers || []).find(item => item.layer === name);
    if (row?.arms?.length === 2 && row.arms.every(list => Array.isArray(list) && list.length)) return { layer: name, arms: row.arms };
  }
  return null;
}
const count = value => Number(value).toLocaleString('en-US');
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const inWords = value => WORDS[value] || count(value);
const domainWord = label => label === 'TV' ? 'TV' : label.toLowerCase();
export const shortTitle = title => String(title || '').replace(/: (?:Claude Code|Codex|Kiro)$/u, '').replace(/,? with Qloo and without$/u, '');
const anchorChips = device => `<span class="site-chips">${(device.anchors || []).slice(0, 3).map(anchor => chip(anchor, anchor.mark === 'new' ? 'new' : '')).join('')}</span>`;

/** A comparison's two arms at play, the guess first: each arm's recorded clip, or its still for a visitor who asks for less motion. */
export function clipStage(entry) {
  const record = entry?.record;
  if (record?.kind !== 'comparison' || !Array.isArray(entry.clips)) return '';
  const base = `/gallery/${escape(entry.id)}/`;
  const figures = armsGuessFirst(record).map(({ arm, qloo }) => {
    const clip = entry.clips.find(item => item.label === arm?.label);
    if (!clip) return '';
    const what = qloo ? 'the same sealed guess, then Qloo\'s measurement of the audience' : 'the sealed guess alone, with no Qloo data';
    const alt = `Recorded play of the design made ${qloo ? 'with Qloo' : 'from the guess alone'}: ${listText(clip.scenes || [])}.`;
    return `<figure class="story-arm${qloo ? ' qloo' : ''}"><figcaption><b>${qloo ? 'With Qloo' : 'The agent\'s guess'}</b><span>${escape(what)}</span></figcaption>
<picture><source media="(prefers-reduced-motion: reduce)" srcset="${base}${escape(clip.poster)}"><img src="${base}${escape(clip.file)}" alt="${escape(alt)}" width="${escape(clip.width)}" height="${escape(clip.height)}"></picture>
<p class="story-scenes">${(clip.scenes || []).map(scene => `<span>${escape(scene)}</span>`).join('')}</p></figure>`;
  }).filter(Boolean);
  if (figures.length !== 2) return '';
  const seconds = Math.max(...entry.clips.map(clip => Number(clip.seconds) || 0));
  return `<div class="story-arms">${figures.join('')}</div>
<p class="story-stage-note">Both designs as they play in a browser: a script sets up each scene and presses the game's own keys, ${escape(Math.round(seconds))} seconds each, scene for scene. <a class="site-link" href="${base}">Play both, and read the record</a></p>`;
}

/** The opening: the problem in one line, the featured pair in one sentence, and the pair at play. */
function storyHero(entry) {
  const story = entry?.story;
  const example = story ? ` Asked for ${story.ask}, ${HOSTS[entry.host] || 'the agent'}'s own guess built ${story.guess}. Given Qloo's measurement of that audience, it built ${story.measured}.` : '';
  const stage = clipStage(entry);
  return `<section class="site-hero story-hero"><p class="mr-kicker">The taste layer for AI agents</p><h1>AI agents design for the audience they imagine.</h1>
<p class="site-lede">Moûsa makes them design for the one Qloo measures.${escape(example)}</p></section>
${stage ? `<section class="story-stage" aria-label="${escape(shortTitle(entry.title))}: both designs at play">${stage}</section>` : featuredPair(entry)}
<p class="site-actions story-actions"><a class="site-button" href="/try/">Try it with your own audience</a><a class="site-button quiet" href="/judges/">For the jury: the evidence</a><a class="site-button quiet" href="/vote/">Judge two designs blind</a></p>`;
}

/** The blind spot: how much of what an audience loves the agents' own guesses missed, and why that matters to a design. */
function blindSpotSection(bench, spot) {
  const share = bench ? bench.missed : spot.works ? spot.missed : null;
  if (share === null || share === undefined) return '';
  const what = bench ? `of the works Qloo measured were missing from the agents' own sealed guesses, over the ${bench.runs} runs of a pre-registered benchmark: ${bench.audiences} audiences, each guessed by Claude Code, Codex and Kiro, and every guess published before Qloo measured anything.`
    : `of the works Qloo measured were missing from the agents' own sealed guesses: ${count(spot.works - spot.known)} of ${count(spot.works)}, in ${spot.sessions} recorded sessions.`;
  const sessions = bench && spot.works ? `<p>In the ${escape(spot.sessions)} recorded sessions of the evidence, the guesses missed ${escape(count(spot.works - spot.known))} of the ${escape(count(spot.works))} works Qloo measured.</p>` : '';
  return `<section class="site-section story-problem" id="blind-spot"><div class="site-head-row"><h2>The blind spot, measured</h2><p>An agent knows an audience's famous names. Qloo knows what else the same people love.</p></div>
<div class="story-problem-grid"><p class="story-big"><b>${escape(`${(100 * share).toFixed(1)}%`)}</b><span>${escape(what)}${bench ? ' <a class="site-link" href="/benchmark/">The benchmark</a>' : ''}</span></p>
<div class="story-problem-text"><p>An agent designs from what it already believes about an audience: the famous names, and the picture of the fan that comes with them. It cannot see the rest of their taste, so its designs land on the obvious, and on one another.</p>
<p>Anthropic's own article on frontend design says that, without guidance, its model settles on one look, which makes AI-generated interfaces “immediately recognizable—and dismissible” (<a href="${ANTHROPIC_ARTICLE}">Improving frontend design through Skills</a>, 2025). Moûsa does not add a better style. It measures the audience before the design, and makes the design use what the guess missed.</p>${sessions}</div></div></section>`;
}

/** Both arms' stills, the guess first, from their clips' posters. */
function stills(entry) {
  const shown = armsGuessFirst(entry.record).map(({ arm, qloo }) => ({ qloo, clip: (entry.clips || []).find(item => item.label === arm?.label) })).filter(item => item.clip);
  return shown.length === 2 ? `<div class="story-stills">${shown.map(({ qloo, clip }) => `<a href="/gallery/${escape(entry.id)}/"><img src="/gallery/${escape(entry.id)}/${escape(clip.poster)}" alt="${escape(qloo ? 'The design made with Qloo' : 'The design made from the guess alone')}" width="${escape(clip.width)}" height="${escape(clip.height)}" loading="lazy"><span>${qloo ? 'With Qloo' : 'The guess alone'}</span></a>`).join('')}</div>` : '';
}

/** The featured session step by step, in its own records: the request, the sealed guess, the measurement, the devices and the record. */
function sessionSteps(entry, repository = '') {
  const record = entry?.record;
  const prediction = record?.prediction, measured = record?.measured;
  if (record?.kind !== 'comparison' || !prediction || !measured?.counts) return howItWorks(entry);
  const brief = /The brief:\s*([^.]+\.)/u.exec(entry.brief || '')?.[1] || '';
  const briefPath = /--brief-file (\S+)/u.exec(entry.reproduce?.command || '')?.[1];
  const briefLink = briefPath && repository ? `${repository}/blob/main/${briefPath}` : '';
  const guessed = (prediction.groups || []).flatMap(group => group.entries || []).slice(0, 10);
  const kinds = (measured.worlds || []).filter(world => world.works?.length && !/lesser known/iu.test(world.label));
  const worlds = kinds.slice(0, 4);
  const frozen = new Date(prediction.frozenAt || '');
  const sealed = Number.isNaN(frozen.getTime()) ? '' : ` at ${frozen.toISOString().slice(11, 16)} UTC on ${day(prediction.frozenAt)}`;
  const order = armsGuessFirst(record), devices = devicesOn(record, [...MECHANICS, ...LOOKS]);
  const qloo = order.find(item => item.qloo);
  const columns = devices ? `<div class="story-compare">${order.map(({ index, qloo: measuredArm }) => `<div class="story-compare-arm${measuredArm ? ' qloo' : ''}"><p class="mr-label">${measuredArm ? 'With Qloo' : 'The guess alone'}</p>
<ul class="story-devices">${devices.arms[index].slice(0, 4).map(device => `<li><span>${escape(device.device)}</span>${anchorChips(device)}</li>`).join('')}</ul></div>`).join('')}</div>` : '';
  const steps = [
    ['The request', 'One command and a short brief, in an empty folder. The request names the audience once; the rest of the brief keeps the game small enough to finish.',
      `${brief ? `<pre class="story-brief"><code>/mousa:compare … ${escape(brief)} …</code></pre>` : ''}<p class="site-small">${escape([HOSTS[entry.host], entry.model, day(entry.startedAt)].filter(Boolean).join(' · '))}${briefLink ? ` · <a class="site-link" href="${escape(briefLink)}">The whole brief</a>` : ''}</p>`],
    ['The agent guesses first, and the guess is sealed', `Before any data, the agent writes down what it believes the audience loves, and the design it would make from that alone. Moûsa seals the guess${sealed}, with its SHA-256, and both designs start from it.`,
      `${prediction.summary ? `<p class="site-quote">“${escape(prediction.summary)}”</p>` : ''}<p class="site-chips">${guessed.map(item => chip({ name: item.name, mark: item.measured ? 'predicted' : 'own' }, item.measured ? 'measured too' : '')).join('')}</p>`],
    ['Qloo measures the audience', `Qloo measured ${measured.counts.works} works this audience loves${kinds.length ? `, across ${listText(kinds.map(world => domainWord(world.label)))}` : ''}. The guess had named ${inWords(measured.counts.worksPredicted ?? 0)} of them.`,
      worlds.map(world => `<p class="story-world"><span class="mr-label">${escape(world.label)}</span><span class="site-chips">${world.works.slice(0, 4).map(work => chip(work, work.mark === 'new' ? 'new' : '')).join('')}</span></p>`).join('')],
    ['The design has to rest on what the guess missed', `Each device of the Qloo design names the measured works and qualities it rests on. ${qloo?.arm?.headline?.sentence || ''} Here is what each game does, and why.`, columns],
    ['Both are built, played and recorded', `Each arm builds its design, plays its own test and reviews its captures. Moûsa then writes the Taste Provenance record from the session's own files: the guess, the names, every device and its anchors, and the distance between the two designs${record.distance?.overall !== undefined ? `, ${Number(record.distance.overall).toFixed(2)} here on a scale from 0 (alike) to 1` : ''}.`,
      `${stills(entry)}<p class="story-links"><a class="site-button" href="/gallery/${escape(entry.id)}/">Play both, and read the record</a></p>`],
  ];
  return `<section class="site-section story-steps" id="how"><div class="site-head-row"><h2>One session, step by step</h2><p>${escape(shortTitle(entry.title))}, from its own records.</p></div>
<ol>${steps.map(([title, text, shown], step) => `<li><div class="story-step-text"><span class="story-step-number">${step + 1}</span><h3>${escape(title)}</h3><p>${escape(text)}</p></div><div class="story-step-shown">${shown}</div></li>`).join('')}</ol></section>`;
}

/** The pairs the landing page tells after the featured one: more designs from one sentence, and one shop for several audiences. */
function morePairs(gallery) {
  const entries = (gallery.index?.highlights || []).map(id => gallery.entries.get(id)).filter(Boolean);
  const stories = entries.filter(entry => entry.story);
  const shops = entries.filter(entry => !entry.story && entry.record?.kind === 'comparison');
  const told = stories.map(entry => `<a class="site-card story-card" href="/gallery/${escape(entry.id)}/"><span class="site-card-image">${entry.report?.cardSmall ? `<img src="/gallery/${escape(entry.id)}/${escape(entry.report.cardSmall)}" alt="" width="1200" height="630">` : ''}</span>
<span class="site-card-text"><b>${escape(shortTitle(entry.title))}</b><span>Asked for ${escape(entry.story.ask)}.</span><span class="story-line"><span class="story-tag">The guess</span> ${escape(entry.story.guess)}</span><span class="story-line qloo"><span class="story-tag">With Qloo</span> ${escape(entry.story.measured)}</span></span></a>`).join('');
  const shopFigures = shops.map(entry => {
    const view = (entry.record.views || []).find(item => item.a && item.b);
    const qloo = armsGuessFirst(entry.record).find(item => item.qloo);
    const capture = view ? (qloo?.index === 1 ? view.b : view.a) : null;
    const audience = /for people who love (.+)$/u.exec(entry.title || '')?.[1] || shortTitle(entry.title);
    return capture ? `<a class="story-shop" href="/gallery/${escape(entry.id)}/"><img src="/gallery/${escape(entry.id)}/report/${escape(capture.file)}" alt="${escape(`The record shop made with Qloo for people who love ${audience}`)}" width="${escape(capture.width)}" height="${escape(capture.height)}" loading="lazy"><span>${escape(audience)}</span></a>` : '';
  }).filter(Boolean);
  if (!told && !shopFigures.length) return '';
  return `<section class="site-section" id="more"><div class="site-head-row"><h2>Not a style: it changes what a design does</h2><p>The same rule, in a game with no game named, a game for this jury's own audience and a phone app. Each was built twice from one sealed guess.</p></div>
${told ? `<div class="site-cards">${told}</div>` : ''}
${shopFigures.length > 1 ? `<div class="story-shops"><div class="site-head-row"><h3>One record shop, ${escape(inWords(shopFigures.length))} audiences</h3><p>The same request, the same agent and the same stages; only the measured audience changes, and the shop changes with it.</p></div><div class="story-shop-row">${shopFigures.join('')}</div></div>` : ''}
<p class="story-all"><a class="site-link" href="/gallery/">All ${escape(gallery.index?.entries.length ?? 0)} recorded sessions, in Claude Code, Codex and Kiro</a></p></section>`;
}

/** The evidence in four lines, each with where it is checked; the jury page has the whole ladder and its limits. */
function evidenceSection(gallery, bench) {
  const range = distances(gallery), anchored = anchoredPairs(gallery);
  const cards = [
    bench && gallery.benchmark ? ['Sealed before measuring', `${benchmarkSentence(gallery.benchmark)} Every guess was published before Qloo measured anything.`, '/benchmark/', 'The benchmark'] : null,
    range.length ? [`${range.length === 1 ? 'One recorded pair' : `${count(range.length)} recorded pairs`}`, `Each built twice from one sealed guess, once with Qloo and once without. Distance between the two designs: ${range[0].toFixed(2)} to ${range.at(-1).toFixed(2)}${anchored.counted ? `; in ${anchored.whole} of them every device of the Qloo design rests on a name the guess missed` : ''}.`, '/gallery/', 'The pairs'] : null,
    ['Beyond the model\'s own variance', 'In repeated pairs of one brief, the blind sketches of both arms showed no detectable difference (p = 0.81); after Qloo, type, structure and palette separated (p = 0.005 each).', '/judges/', 'What each kind shows, and does not'],
    ['A blind vote', 'Two designs of a pair, unlabelled: which would the audience rather have? You see which used Qloo only after you vote.', '/vote/', 'Vote'],
  ].filter(Boolean);
  return `<section class="site-section" id="evidence"><div class="site-head-row"><h2>Is it the measurement, or chance?</h2><p>Four kinds of evidence, each published with what it does not show.</p></div>
<div class="story-evidence">${cards.map(([title, text, href, link]) => `<div class="mr-card"><h3>${escape(title)}</h3><p>${escape(text)}</p><p><a class="site-link" href="${href}">${escape(link)}</a></p></div>`).join('')}</div></section>`;
}

/** The landing page: the featured pair as a short film, then the blind spot, the session, more pairs, the evidence and how to try it. */
export function landingPage({ gallery, repository = '' }) {
  const index = gallery.index;
  const featured = gallery.entries.get(index?.featured) || [...gallery.entries.values()][0];
  const spot = index?.blindSpot?.sessions ? index.blindSpot
    : blindSpotTotals([...gallery.entries.values()].map(entry => ({ id: entry.id, host: entry.host, blindSpot: entry.blindSpot || blindSpotOf(entry.record) })));
  // The pre-registered benchmark when its results are published; the gallery's own sessions otherwise.
  const bench = benchmarkTotals(gallery.benchmark);
  const tryIt = `<section class="site-section" id="try"><div class="site-head-row"><h2>Try it</h2><p>On this site with your own audience, or in the agent your team already uses.</p></div>
<div class="story-try"><div class="mr-card"><h3>Here, in a minute</h3><p>Name two or three works an audience loves. In under a minute the live try shows Kiro's sealed guess beside Qloo's measurement; building both designs takes five to ten minutes more, and is optional. No code or sign-in.</p><p><a class="site-button" href="/try/">Open the live try</a></p></div>
<div class="mr-card"><h3>In your own agent</h3><p>The plugin runs in Claude Code, Codex and Kiro, on the project a team already has. Each person uses their own Qloo API key.</p><p><a class="site-link" href="#agents">Install it</a></p></div></div></section>`;
  const body = `${storyHero(featured)}${blindSpotSection(bench, spot)}${sessionSteps(featured, repository)}${morePairs(gallery)}${evidenceSection(gallery, bench)}${tryIt}${install(repository)}${PUBLISHED}`;
  return layout({ title: 'Moûsa: design grounded in measured taste', description: 'AI agents design for the audience they imagine. Moûsa makes them design for the one Qloo measures: a sealed guess, a measurement, and a design that must use what the guess missed.',
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
<p class="site-lede">It will run Moûsa in Kiro on this server. First, in under a minute, the model's frozen guess about the audience you name is set beside what Qloo measures. Then, if you like, the server builds a design with Qloo and one without, from the same guess.</p>
<p class="site-actions"><a class="site-button" href="/gallery/">See the recorded sessions</a></p></section>`;
  return layout({ title: 'Try it live · Moûsa', body, active: 'try', repository });
}

/** A page the site does not have, in its own layout. */
export function missingPage({ repository = '' } = {}) {
  return layout({ title: 'Not found · Moûsa', body: '<section class="site-hero small"><h1>That page is not here.</h1><p class="site-lede"><a class="site-link" href="/">Back to the start</a></p></section>', repository });
}
