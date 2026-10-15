// The live try's pages, drawn on the server with no script: the access code, the request (a starter, what the
// audience loves, where and how old), and one page per try that refreshes itself while a step works. Step one's page
// sets the model's frozen guess beside Qloo's measurement in the report's own sections; step two's shows both arms at
// work, then the comparison, the two designs to play and the juror's choice to publish it.

import { layout } from './render.mjs';
import { renderBody, listText } from '../../plugin/server/design/report.mjs';
import { AGE_BANDS, TRY_INPUT_LIMITS } from '../try/starters.mjs';
import { QUICK_ACTIVE, PAIR_ACTIVE, TRY_ARMS } from '../try/manager.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const MEDIA = Object.freeze({ web: 'Website', 'app-ui': 'App interface', game: 'Game character' });
const STAGES = Object.freeze({ predicted: 'Starting from the frozen prediction', measured: 'Reading the Taste Brief', baseline: 'Taking its taste from the prediction alone', read: 'Reading saved',
  specified: 'Design DNA saved', 'production-planned': 'Production plan saved', checked: 'Build checked', captured: 'Captured for review', reviewed: 'Review round saved' });
const ageLabel = band => band.replaceAll('_', ' ');
const minutes = ms => Number.isFinite(ms) ? `${Math.max(1, Math.round(ms / 60000))} min` : '';
const problemBlock = text => text ? `<p class="try-problem" role="alert">${escape(text)}</p>` : '';
const intro = '<p class="site-lede">First, in about two minutes, the model writes down its own guess about the audience you name, and Qloo measures that audience here; the page sets the two side by side. Then, if you like, the server builds the design twice from that same guess, once with what Qloo measured and once without, in fifteen to thirty minutes.</p>';

/** The page that asks for the jury's access code. */
export function tryAccessPage({ problem = '', repository = '' } = {}) {
  const body = `<section class="site-hero small"><p class="mr-kicker">Try it live</p><h1>Run Moûsa in Kiro for an audience you name.</h1>${intro}</section>
<form class="try-form mr-card" method="post" action="/try/access"><label for="try-code">Access code</label><p class="site-small">The jury's code, from the submission.</p>
<input id="try-code" name="code" type="password" autocomplete="off" required maxlength="200">${problemBlock(problem)}
<p class="site-actions"><button class="site-button" type="submit">Open the try</button><a class="site-button quiet" href="/gallery/">See the recorded sessions instead</a></p></form>`;
  return layout({ title: 'Try it live · Moûsa', body, active: 'try', repository });
}

/** The request: a starter, what the audience loves, and where and how old they are. */
export function tryStartPage({ starters, problem = '', values = {}, repository = '' } = {}) {
  const chosen = values.starter || starters[0]?.id;
  const ages = new Set(Array.isArray(values.ages) ? values.ages : []);
  const body = `<section class="site-hero small"><p class="mr-kicker">Try it live</p><h1>Who is the design for?</h1>${intro}</section>
<form class="try-form" method="post" action="/try/">
<fieldset class="try-starters"><legend>What to design</legend>${starters.map(starter => `<label class="try-starter"><input type="radio" name="starter" value="${escape(starter.id)}"${starter.id === chosen ? ' checked' : ''}>
<span><span class="site-tags"><span>${escape(MEDIA[starter.medium] || starter.medium)}</span></span><b>${escape(starter.title)}</b><span>${escape(starter.summary)}</span></span></label>`).join('')}</fieldset>
<div class="mr-card try-fields"><label for="try-references">What the audience loves</label><p class="site-small">One to ${TRY_INPUT_LIMITS.references} names, one per line: films, music, books, TV, games, brands or places.</p>
<textarea id="try-references" name="references" rows="5" required maxlength="1200">${escape(values.references || '')}</textarea>
<label for="try-place">Where they are <span class="site-small">(optional)</span></label><p class="site-small">A city or a neighbourhood weights what Qloo measures toward it.</p>
<input id="try-place" name="place" maxlength="${TRY_INPUT_LIMITS.place}" value="${escape(values.place || '')}">
<fieldset class="try-ages"><legend>How old they are <span class="site-small">(optional, up to ${TRY_INPUT_LIMITS.ages}; Qloo has broad and narrow bands)</span></legend>
${[['Broad', AGE_BANDS.slice(0, 3)], ['Narrow', AGE_BANDS.slice(3)]].map(([group, bands]) => `<p class="try-age-row"><span class="mr-label">${group}</span>${bands.map(band => `<label><input type="checkbox" name="ages" value="${escape(band)}"${ages.has(band) ? ' checked' : ''}> ${escape(ageLabel(band))}</label>`).join('')}</p>`).join('')}</fieldset></div>
${problemBlock(problem)}<p class="site-actions"><button class="site-button" type="submit">Start step one</button></p>
<p class="site-small">The server keeps your request and what the sessions make. Nothing of it is published unless you choose to at the end.</p></form>`;
  return layout({ title: 'Try it live · Moûsa', body, active: 'try', repository });
}

/** The steps of step one, each done, working, waiting or stopped. */
function quickProgress(run, view) {
  const order = ['planning', 'predicting', 'measuring', 'reporting'], status = run.quick.status;
  const at = status === 'done' ? order.length : status === 'queued' ? -1 : order.indexOf(status === 'measuring' && run.quick.measured ? 'reporting' : status);
  const stopped = ['failed', 'cancelled'].includes(status);
  const reached = stopped ? (run.quick.measured ? 3 : run.quick.prediction ? 2 : run.quick.plan ? 1 : 0) : at;
  const items = [['Plan the taste questions for this medium', ''], ['Kiro freezes the model\'s own prediction', view.predict?.calls ? `${view.predict.calls} Moûsa calls so far` : ''],
    ['Qloo measures the audience', run.quick.measured ? `${run.quick.measured.qlooRequests} requests` : ''], ['The report sets the guess beside the measurement', '']];
  return `<ol class="try-progress">${items.map(([label, note], index) => {
    const state = index < reached ? 'done' : index === reached && !stopped && status !== 'queued' ? 'working' : index === reached && stopped ? 'stopped' : 'waiting';
    return `<li data-state="${state}"><b>${escape(label)}</b>${note ? ` <span class="site-small">${escape(note)}</span>` : ''}</li>`;
  }).join('')}</ol>${status === 'queued' && view.quickPlace ? `<p class="site-small">Waiting for a free slot: number ${escape(view.quickPlace)} in line.</p>` : ''}`;
}

/** One arm at work or done: its stage, its counts and, while it works, its latest capture and its design as it stands. */
function armCard(run, arm, previewBase) {
  const working = arm.status === 'designing';
  const play = `${previewBase}/try/${run.id}/${run.previewToken}/${arm.id}/index.html`;
  const capture = !working ? '' : arm.latest ? `<img src="/try/${escape(run.id)}/progress/${escape(arm.id)}.png?n=${escape(arm.captures)}" alt="${escape(`${arm.label}: the latest capture`)}">
<p class="site-small"><a href="${escape(play)}" target="_blank" rel="noopener noreferrer">Open the design as it stands</a></p>` : '<p class="site-small">No capture yet.</p>';
  const counts = [arm.live?.calls ? `${arm.live.calls} calls` : arm.session ? `${arm.session.calls.length} calls` : '', arm.captures ? `${arm.captures} captures` : '', arm.reviews ? `${arm.reviews} review round${arm.reviews === 1 ? '' : 's'}` : '', arm.session ? minutes(arm.session.durationMs) : '',
    // What the session cost, as Kiro metered it, and how full its context window got: the two numbers a hosted try is bounded by.
    Number.isFinite(arm.session?.credits) ? `${arm.session.credits} credits` : '', Number.isFinite(arm.session?.contextPeak) ? `context ${Math.round(arm.session.contextPeak)}%` : ''];
  return `<div class="mr-card try-arm" data-state="${escape(arm.status || 'queued')}"><p class="mr-label">${escape(arm.label)}</p>
<p><b>${escape(working ? STAGES[arm.stage] || 'Starting its session' : arm.status === 'done' ? 'Finished' : arm.status === 'failed' ? 'Ended early' : 'Waiting')}</b></p>
<p class="site-small">${escape(counts.filter(Boolean).join(' · '))}</p>${capture}${arm.problem ? problemBlock(arm.problem) : ''}
${arm.guard ? `<p class="site-small">Put back after the session, since the design may not change it: ${escape(listText([...arm.guard.restored, ...arm.guard.removed]))}.</p>` : ''}</div>`;
}

const form = (action, label, quiet = false, hidden = '') => `<form class="try-inline" method="post" action="${escape(action)}">${hidden}<button class="site-button${quiet ? ' quiet' : ''}" type="submit">${escape(label)}</button></form>`;

/** A try's own page: where each step stands, the measurement beside the guess, then the pair and the choice to publish. */
export function tryRunPage({ run, view, measurement = null, comparison = null, previewBase, families = [], repository = '' }) {
  const id = run.id, quick = run.quick, pair = run.pair;
  const active = QUICK_ACTIVE.includes(quick.status) || (pair && PAIR_ACTIVE.includes(pair.status));
  const audience = `${listText(run.input.references)}${run.input.place ? `, in ${run.input.place}` : ''}`;
  const measured = quick.status === 'done' && quick.measured?.status === 'ok' && measurement;
  const stepOneHead = '<div class="mr-section-head"><h2>Step one: the guess and the measurement</h2><p>The model\'s prediction was frozen before any Qloo data; the measurement shows what it contained and what it missed.</p></div>';
  const stepOneReport = measured ? `<div class="site-report">${renderBody(measurement, { base: `/try/${id}/files/.mousa/report/`, fonts: families })}</div><p class="site-files"><a href="/try/${escape(id)}/files/.mousa/report/index.html">The measurement report on its own</a></p>` : '';
  // Once the pair is asked for, it leads the page, and step one folds away: the comparison carries the guess and the measurement too.
  const stepOne = pair && measured
    ? `<section class="mr-section" id="step-one"><details class="try-fold"><summary><b>Step one: the guess and the measurement</b> <span class="site-small">${escape(measurement.headline?.sentence || '')}</span></summary>${stepOneReport}</details></section>`
    : `<section class="mr-section" id="step-one">${stepOneHead}
${quickProgress(run, view)}${['failed', 'cancelled'].includes(quick.status) ? `${problemBlock(quick.problem)}<p class="site-actions"><a class="site-button" href="/try/">Start a new try</a></p>` : ''}
${quick.status === 'done' && !measured ? `<div class="mr-card"><p><b>Qloo could not measure this audience well enough to design from.</b></p>${(quick.measured?.cautions || []).length ? `<ul>${quick.measured.cautions.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : ''}<p class="site-actions"><a class="site-button" href="/try/">Try other names</a></p></div>` : ''}
${stepOneReport}</section>`;

  let stepTwo = '';
  if (measured) {
    const head = '<div class="mr-section-head"><h2>Step two: with Qloo and without</h2><p>Two Kiro sessions from the same frozen prediction and the same stages; one designs from what Qloo measured, the other from the prediction alone.</p></div>';
    if (!pair) stepTwo = `${head}<div class="mr-card"><p>The server copies the starter twice, locks one copy to the measurement and the other to the guess, and runs a session in each. It takes fifteen to thirty minutes, and this page follows both.</p>${form(`/try/${id}/design`, 'Build the pair')}</div>`;
    else {
      const arms = view.arms.length ? view.arms : TRY_ARMS.map(arm => ({ ...arm }));
      const waiting = pair.status === 'queued' ? `<p class="site-small">The pair waits for the one free slot${view.pairPlace ? `: number ${escape(view.pairPlace)} in line` : ''}.</p>` : pair.status === 'preparing' ? '<p class="site-small">Copying the starter into both arms and locking each to its source of taste.</p>' : pair.status === 'reporting' ? '<p class="site-small">Writing the comparison report.</p>' : '';
      const finished = ['done', 'partial'].includes(pair.status) && comparison;
      const plays = finished ? `<div class="site-frames" data-frame="${run.medium === 'app-ui' ? 'phone' : run.medium === 'game' ? 'wide' : 'desktop'}" data-count="2">${TRY_ARMS.map(arm => {
        const url = `${previewBase}/try/${id}/${run.previewToken}/${arm.id}/index.html`;
        return `<figure><iframe src="${escape(url)}" title="${escape(`${arm.label}: the design`)}" sandbox="allow-scripts allow-forms" loading="lazy" referrerpolicy="no-referrer"></iframe><figcaption><b>${escape(arm.label)}</b> <a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Open full screen</a></figcaption></figure>`;
      }).join('')}</div>` : '';
      stepTwo = `${head}${waiting}<div class="site-grid two try-arms">${arms.map(arm => armCard(run, arm, previewBase)).join('')}</div>
${['failed', 'cancelled'].includes(pair.status) ? `${problemBlock(pair.problem)}${form(`/try/${id}/design`, 'Build the pair again')}` : ''}
${finished ? `${pair.status === 'partial' ? problemBlock(pair.problem) : ''}${plays}<div class="site-report">${renderBody(comparison, { base: `/try/${id}/files/.mousa/compare-report/`, fonts: families })}</div>
<p class="site-files"><a href="/try/${escape(id)}/files/.mousa/compare-report/index.html">The comparison report on its own</a>${TRY_ARMS.map(arm => `<a href="/try/${escape(id)}/files/${escape(arm.folder)}/.mousa/report/index.html">${escape(arm.label)}: its own report</a>`).join('')}</p>` : ''}`;
    }
    stepTwo = `<section class="mr-section" id="step-two">${stepTwo}</section>`;
  }

  // Only a finished pair is published: a gallery entry has designs to play.
  const publishable = Boolean(pair && ['done', 'partial'].includes(pair.status) && comparison);
  const consent = publishable ? `<section class="mr-section" id="publish"><div class="mr-section-head"><h2>Publish it, if you like</h2><p>Nothing of this try is public unless you choose so.</p></div><div class="mr-card">
${run.consent?.publish ? `<p>You agreed on ${escape(run.consent.at.slice(0, 10))} to add this try to the public gallery. It joins when the gallery is next built.</p>${form(`/try/${id}/publish`, 'Withdraw my consent', true, '<input type="hidden" name="consent" value="no">')}`
    : `<p>The gallery would show the request and the audience you named, the frozen prediction, the names Qloo measured, each design's record and captures, and the designs themselves. Never the session streams, Qloo's ids or scores, or anything about you.</p>
<form class="try-inline" method="post" action="/try/${escape(id)}/publish"><label class="try-check"><input type="checkbox" name="consent" value="yes" required> I agree to publish this try in Moûsa's public gallery.</label><button class="site-button" type="submit">Publish this try</button></form>`}</div></section>` : '';

  const body = `<div class="site-page"><nav class="site-crumbs" aria-label="Breadcrumb"><a href="/try/">Try it live</a> <span aria-hidden="true">/</span> <span>This try</span></nav>
<header class="site-entry-head"><p class="mr-kicker">${escape(MEDIA[run.medium] || run.input.starter)} · Kiro${run.hostVersion ? ` ${escape(run.hostVersion)}` : ''}${run.model ? ` · ${escape(run.model)}` : ''}</p><h1>${escape(run.title)}, for people who love ${escape(audience)}</h1>
${active ? `<p class="site-small" role="status">This page refreshes itself every few seconds while a step works.</p>${form(`/try/${id}/cancel`, 'Stop this try', true)}` : ''}</header>
${pair ? `${stepTwo}${stepOne}` : `${stepOne}${stepTwo}`}${consent}<p class="site-back"><a class="site-link" href="/try/">Start another try</a> · <a class="site-link" href="/vote/">Judge two recorded designs blind</a></p></div>`;
  return layout({ title: 'Your try · Moûsa', body, active: 'try', repository, ...(active ? { refresh: 4 } : {}) });
}

/** A short page for a try request that could not be taken, with the way back. */
export function tryProblemPage({ message, status = 400, repository = '' }) {
  const body = `<section class="site-hero small"><p class="mr-kicker">Try it live</p><h1>${status === 429 ? 'Please wait a little.' : status === 503 ? 'The try is not taking runs right now.' : status === 404 ? 'There is no such try.' : 'That request cannot be run.'}</h1>
<p class="site-lede">${escape(message)}</p><p class="site-actions"><a class="site-button" href="/try/">Back to the try</a><a class="site-button quiet" href="/gallery/">See the recorded sessions</a></p></section>`;
  return layout({ title: 'Try it live · Moûsa', body, active: 'try', repository });
}
