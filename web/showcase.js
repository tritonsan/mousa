'use strict';

// The App interface view: the showcased app run, which the Moûsa plugin made in Kiro outside this Studio, as
// scripts/build-showcase.mjs recorded it. app.js fetches the showcase (showcaseRequest) and owns $ and node; game.js
// switches the views and announces each switch as studio:view. The phones play the recorded files from the preview
// origin, sandboxed like a site preview, and load only while this view shows. Nothing here can change the record.
(() => {
  const view = { app: null, shown: !$('app-view').hidden };
  const WORDS = { css: 'CSS', svg: 'SVG', ui: 'UI', js: 'JS', dna: 'DNA' };
  const VERDICTS = { met: 'Met', partly: 'Partly met', unmet: 'Not met' };
  const CAPTURE_FILE = /^captures\/[A-Za-z0-9_-]{1,90}\.png$/u;
  const count = (value, word, plural = `${word}s`) => `${value} ${value === 1 ? word : plural}`;
  const join = items => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  const words = id => { const text = String(id || '').split('-').map(part => WORDS[part] || part).join(' '); return text.charAt(0).toUpperCase() + text.slice(1); };
  const day = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(date); };
  const fileUrl = file => new URL(file, view.app.base).href;

  function metric(container, value, label) {
    const item = node('div', 'taste-metric'); item.append(node('strong', '', value), node('span', '', label)); container.append(item);
  }

  /** A capture the agent reviewed, linked to its full size. */
  function captureLink(capture, label) {
    const link = node('a', 'app-capture'); link.href = fileUrl(capture.file); link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${label}, opens the capture in a new tab`);
    const image = node('img'); image.src = link.href; image.alt = label; image.loading = 'lazy'; image.decoding = 'async';
    if (capture.width && capture.height) { image.width = capture.width; image.height = capture.height; }
    link.classList.toggle('wide', capture.width > capture.height);
    link.append(image);
    return link;
  }

  function renderSummary(record) {
    const recorded = day(record.recordedAt), minutes = Number.isFinite(record.durationMs) ? Math.max(1, Math.round(record.durationMs / 60000)) : null;
    $('app-heading').textContent = `${record.title || 'The app'}, redesigned by the plugin alone`;
    $('app-recorded').textContent = `Showcase${recorded ? ` · recorded ${recorded}` : ''}`;
    $('app-request').textContent = record.request ? `“${record.request}”` : record.title || '';
    $('app-detail').textContent = [record.description,
      `Kiro ran the example’s own agent with the Moûsa plugin on a copy of the app, outside this Studio${record.model ? `, with ${record.model}` : ''}${record.kiro ? ` on Kiro ${record.kiro}` : ''}${minutes ? `, in ${count(minutes, 'minute')}` : ''}.`,
      'This view shows the files it saved and the captures it reviewed; nothing here was generated again.'].filter(Boolean).join(' ');
    const metrics = $('app-metrics'), taste = record.taste, audit = record.audit;
    metrics.replaceChildren();
    if (Number.isFinite(taste?.measuredEntities)) metric(metrics, String(taste.measuredEntities), `entities Qloo measured for the audience${Number.isFinite(taste.surprises) ? `, ${taste.surprises} the model did not predict` : ''}`);
    if (Number.isFinite(taste?.predictions)) metric(metrics, `${taste.predictionsConfirmed ?? 0} of ${taste.predictions}`, 'entities the model predicted, before any data, that the measurement returned');
    if (Number.isFinite(taste?.measuredQualities)) metric(metrics, String(taste.measuredQualities), `qualities the audience’s works share${taste.qualitySurprises === taste.measuredQualities ? ', none of them predicted' : Number.isFinite(taste.qualitySurprises) ? `, ${taste.qualitySurprises} not predicted` : ''}`);
    if (audit?.cited?.length) metric(metrics, `${audit.opened.length} of ${audit.cited.length}`, 'captures cited in its reviews that the session record shows it opened');
    metrics.hidden = !metrics.childElementCount;
  }

  function renderSteps(record) {
    const { taste, reading, dna, plan } = record, rounds = record.review?.rounds || [];
    const steps = [];
    if (Number.isFinite(taste?.predictions)) steps.push(['Prediction', `Wrote down ${count(taste.predictions, 'entity', 'entities')} it expected the audience to like, before seeing any data.`]);
    if (taste) steps.push(['Taste pass', `Qloo measured ${count(taste.measuredEntities ?? 0, 'entity', 'entities')}, ${count(taste.measuredQualities ?? 0, 'shared quality', 'shared qualities')} and ${count(taste.measuredTags ?? 0, 'tag')}${record.seeds?.length ? ` from ${join(record.seeds)}` : ''}.`]);
    if (reading?.clusters?.length) steps.push(['Reading', `Grouped what came back into ${count(reading.clusters.length, 'cluster')}${reading.setAside ? ` and set ${count(reading.setAside, 'result')} aside` : ''}.`]);
    if (dna?.devices?.length) steps.push(['Design DNA', `${count(dna.devices.length, 'device')} for the ${join([...new Set(dna.devices.map(device => device.layer))])}.`]);
    if (plan?.steps?.length) steps.push(['Plan', `A method for each device, and ${count(plan.criteria.length, 'criterion', 'criteria')} to judge the screens by.`]);
    if (record.changed?.length) steps.push(['Build', `Changed ${count(record.changed.length, 'file')}${record.fonts?.length ? ` and added ${count(record.fonts.length, 'open-licence font')}` : ''}.`]);
    if (rounds.length) steps.push(['Review', `${count(rounds.length, 'round')} on ${count(record.captures?.length || 0, 'capture')} of its own screens, repairing between them.`]);
    $('app-steps').replaceChildren(...steps.map(([title, text]) => { const item = node('li'); item.append(node('strong', '', title), node('span', '', text)); return item; }));
  }

  function renderDna(record) {
    const dna = record.dna;
    $('app-dna').hidden = !dna?.devices?.length;
    if (!dna?.devices?.length) return;
    $('app-dna-count').textContent = count(dna.devices.length, 'device');
    $('app-thesis').textContent = dna.thesis || '';
    $('app-approach').textContent = record.reading?.approach ? `The agent’s reading of the data: ${record.reading.approach}` : '';
    $('app-approach').hidden = !record.reading?.approach;
    const methods = new Map((record.plan?.steps || []).map(step => [step.device, step]));
    $('app-devices').replaceChildren(...dna.devices.map(device => {
      const card = node('article', 'app-device');
      card.append(node('span', 'event-mode', words(device.layer)), node('h3', '', device.device || device.id), node('p', '', device.translation || ''));
      if (device.anchors?.length) {
        const anchors = node('p', 'app-anchors');
        anchors.append(node('span', '', 'Anchored on'), ...device.anchors.map(name => node('span', 'quality-chip', name)));
        card.append(anchors);
      }
      const step = methods.get(device.id);
      if (step) card.append(node('p', 'app-method', `${words(step.method)}${step.why ? ` · ${step.why}` : ''}`));
      return card;
    }));
  }

  function renderReview(record) {
    const rounds = record.review?.rounds || [];
    $('app-review').hidden = !rounds.length;
    if (!rounds.length) return;
    const captures = new Map((record.captures || []).filter(capture => CAPTURE_FILE.test(capture.file || '')).map(capture => [capture.id, capture]));
    $('app-review-count').textContent = `${count(rounds.length, 'round')} · ${count(captures.size, 'capture')}`;
    $('app-review-note').textContent = [...rounds.map(round => round.summary ? `Round ${round.round}: ${round.summary}` : ''), record.review.note ? `The agent’s own note: ${record.review.note}` : ''].filter(Boolean).join(' ');
    // The board shows every screen at once; the last round's board is the finished app as the agent last saw it.
    const board = [...captures.values()].filter(capture => capture.view === 'board').sort((a, b) => (b.round || 0) - (a.round || 0))[0];
    $('app-board').hidden = !board;
    if (board) {
      $('app-board-link').replaceChildren(captureLink(board, `Every screen at review round ${board.round}`));
      $('app-board-caption').textContent = `Every screen side by side, as the agent saw them in round ${board.round}.`;
    }
    const devices = new Map((record.dna?.devices || []).map(device => [device.id, device.device]));
    const criteria = record.plan?.criteria?.length ? record.plan.criteria : [...new Map(rounds.flatMap(round => round.criteria || []).map(item => [item.id, { id: item.id }])).values()];
    $('app-criteria').replaceChildren(...criteria.map(criterion => {
      const card = node('article', 'app-criterion');
      const heading = node('div', 'app-criterion-heading');
      heading.append(node('h3', '', words(criterion.id)), node('span', '', [devices.get(criterion.device), criterion.view ? words(criterion.view) : ''].filter(Boolean).join(' · ')));
      card.append(heading);
      if (criterion.look) card.append(node('p', 'app-look', criterion.look));
      const judged = node('div', 'app-rounds');
      for (const round of rounds) {
        const item = (round.criteria || []).find(entry => entry.id === criterion.id);
        if (!item) continue;
        const figure = node('figure', 'app-round'), capture = captures.get(item.capture);
        if (capture) figure.append(captureLink(capture, `${words(criterion.id)}, round ${round.round}`));
        const caption = node('figcaption');
        caption.append(node('span', `verdict ${VERDICTS[item.verdict] ? item.verdict : ''}`, `Round ${round.round} · ${VERDICTS[item.verdict] || words(item.verdict)}`));
        if (item.observed) caption.append(node('p', '', item.observed));
        if (item.repair) caption.append(node('p', 'app-repair', `Repair: ${item.repair}`));
        figure.append(caption);
        judged.append(figure);
      }
      card.append(judged);
      return card;
    }));
  }

  /** The phones load from the preview origin only while the view shows; leaving the view unloads them. */
  function renderPhones() {
    for (const [id, part] of [['app-before-frame', 'before'], ['app-after-frame', 'after']]) {
      const frame = $(id), src = view.shown && view.app ? fileUrl(`${part}/index.html`) : '';
      if (src && frame.getAttribute('src') !== src) frame.src = src;
      if (!src) frame.removeAttribute('src');
      frame.hidden = !src;
    }
  }

  document.addEventListener('studio:view', event => { view.shown = event.detail?.view === 'app'; renderPhones(); });

  showcaseRequest.then(showcase => {
    if (!showcase.app?.record) { $('app-request').textContent = 'No app run is showcased on this server.'; return; }
    view.app = showcase.app;
    const record = showcase.app.record;
    renderSummary(record); renderSteps(record); renderDna(record); renderReview(record); renderPhones();
  });
})();
