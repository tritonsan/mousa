// The blind vote's pages, with no script and no cookie: a ballot that shows one comparison's two designs as Left and
// Right, a form with three buttons, the page after a vote that says which side was made with Qloo, and the results with
// their limits. Pictures load by the ballot's sealed token, so no URL says which side is which.

import { layout } from './render.mjs';
import { listText } from '../../plugin/server/design/report.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const QUESTIONS = Object.freeze({ game: 'Which character would this audience rather play?', web: 'Which site would this audience rather visit?', 'app-ui': 'Which app would this audience rather use?' });
const percent = value => `${Math.round(value * 100)}%`;

/** The captures a ballot shows of each side: the first views both arms have, at most two. */
export const ballotViews = record => (record?.views || []).filter(view => view.a && view.b).slice(0, 2);
const audienceOf = record => (record?.audience?.references || []).map(item => item.name);

export function votePage({ entry, ballot, repository = '' }) {
  const record = entry.record, views = ballotViews(record), names = audienceOf(record);
  const side = which => `<figure class="vote-side"><figcaption>${which === 'left' ? 'Left' : 'Right'}</figcaption>${views.map((view, index) =>
    `<img src="/vote/image/${escape(ballot.token)}/${which}/${index}" alt="${escape(`${which === 'left' ? 'Left' : 'Right'} design: ${view.label}`)}" width="${escape(view.a.width)}" height="${escape(view.a.height)}">`).join('')}</figure>`;
  const body = `<section class="site-hero small"><p class="mr-kicker">Blind vote</p><h1>${escape(QUESTIONS[record.medium] || 'Which design would this audience rather have?')}</h1>
<p class="site-lede">${names.length ? `The audience loves ${escape(listText(names))}. ` : ''}One of these designs was made with what Qloo measured about that audience, the other from the model's own guess, with the same brief and the same stages. You will see which after you vote.</p></section>
<form class="vote-form" method="post" action="/vote/"><input type="hidden" name="ballot" value="${escape(ballot.token)}"><div class="vote-sides">${side('left')}${side('right')}</div>
<p class="vote-buttons"><button class="site-button" name="choice" value="left">Left</button><button class="site-button quiet" name="choice" value="same">I cannot choose</button><button class="site-button" name="choice" value="right">Right</button></p></form>
<p class="site-small vote-note">No cookie and no address is kept: a vote is counted with a hash of your address for the day, and each address can vote once a day on each pair. <a href="/vote/results/">See the results so far</a></p>`;
  return layout({ title: 'Blind vote · Moûsa', body, active: 'vote', repository });
}

export function voteThanksPage({ entry, outcome, result, repository = '' }) {
  const chose = outcome.choice === 'same' ? 'You could not choose between them.' : outcome.choice === 'qloo' ? 'You chose the design made with Qloo.' : 'You chose the design made from the model\'s own guess.';
  const body = `<section class="site-hero small"><p class="mr-kicker">Thank you</p><h1>${escape(outcome.qlooSide === 'left' ? 'Left' : 'Right')} was the design made with Qloo.</h1>
<p class="site-lede">${escape(chose)} ${result?.votes ? escape(`${result.votes} vote${result.votes === 1 ? '' : 's'} on this pair so far${result.share !== undefined ? `; ${percent(result.share)} of those with a preference chose the Qloo design` : ''}.`) : ''}</p>
<p class="site-actions"><a class="site-button" href="/vote/">Vote on another pair</a><a class="site-button quiet" href="/gallery/${escape(entry.id)}/">See this pair's record</a><a class="site-button quiet" href="/vote/results/">All results</a></p></section>`;
  return layout({ title: 'Thank you · Moûsa', body, active: 'vote', repository });
}

export function voteProblemPage({ message, status, repository = '' }) {
  const body = `<section class="site-hero small"><p class="mr-kicker">Blind vote</p><h1>${status === 429 ? 'Please wait a little.' : status === 409 ? 'Already counted.' : 'That ballot cannot be counted.'}</h1>
<p class="site-lede">${escape(message)}</p><p class="site-actions"><a class="site-button" href="/vote/">Take a new ballot</a><a class="site-button quiet" href="/vote/results/">See the results</a></p></section>`;
  return layout({ title: 'Blind vote · Moûsa', body, active: 'vote', repository });
}

export function voteResultsPage({ results, entries, repository = '' }) {
  const rows = results.map(result => {
    const entry = entries.get(result.pair);
    const share = result.share === undefined ? 'no preference yet' : `${percent(result.share)} for the Qloo design`;
    const interval = result.interval ? ` (95% interval ${percent(result.interval[0])} to ${percent(result.interval[1])})` : '';
    return `<tr><th scope="row"><a href="/gallery/${escape(result.pair)}/">${escape(entry?.title || result.pair)}</a></th><td>${escape(result.votes)}</td><td>${escape(result.qloo)}</td><td>${escape(result.baseline)}</td><td>${escape(result.same)}</td><td>${escape(share + interval)}</td></tr>`;
  }).join('');
  const body = `<section class="site-hero small"><p class="mr-kicker">Blind vote</p><h1>Results so far</h1><p class="site-lede">Each vote compares the two designs of one comparison, shown blind. The share counts only votes with a preference.</p></section>
<div class="vote-table"><table><thead><tr><th scope="col">Pair</th><th scope="col">Votes</th><th scope="col">Qloo design</th><th scope="col">Model's guess</th><th scope="col">No preference</th><th scope="col">Share</th></tr></thead><tbody>${rows}</tbody></table></div>
<section class="site-section"><div class="site-head-row"><h2>How to read it</h2></div><ul class="mr-limits"><li>The voters are whoever opens this page, not a sample of each audience, and most have not met the works it loves.</li>
<li>With few votes the interval is wide; an interval that spans 50% means the votes cannot tell the designs apart by preference.</li><li>A preference for one design says nothing about why: palette, character, copy or chance.</li>
<li>Both designs are also public in the gallery, so a voter who looked them up first did not vote blind.</li></ul>
<p class="site-actions"><a class="site-button" href="/vote/">Vote</a></p></section>`;
  return layout({ title: 'Blind vote results · Moûsa', body, active: 'vote', repository });
}
