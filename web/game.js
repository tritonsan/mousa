'use strict';

// The Game character view: the RPG proof's Qloo off/on character pairs beside the website workspace. app.js loads
// first and owns the page's access token and service status; this view reuses its api, $, node, toast, formatTime,
// emptyLog, readiness, statusLabels and terminalStatuses, and keeps its own state in this scope.
(() => {
  const game = { view: 'sites', defaults: null, pairs: [], pairsFor: null, job: null, pendingId: null, showcaseId: null, timer: null, polling: false, submitting: false, cancelling: false, frameUrl: '', lastEvents: '', lastSummary: '' };
  // The Studio's views; this file switches them. The App interface view (showcase.js) hears each switch as studio:view.
  const VIEWS = ['sites', 'game', 'app'];
  const FAMILIES = [['look', 'Look'], ['mood', 'Mood'], ['meaning', 'Meaning']];
  const MAX_REFERENCES = 8;
  const active = () => Boolean(game.job && !terminalStatuses.has(game.job.status));
  const references = () => [...new Set($('game-references').value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean))];
  const percent = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
  const score = value => Number.isFinite(value) ? value.toFixed(2) : '—';
  const dateLabel = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date); };
  const join = items => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  const count = (value, word) => `${value} ${word}${value === 1 ? '' : 's'}`;

  function showGameError(message) { $('game-error').textContent = message || ''; $('game-error').hidden = !message; }

  function setUrl() {
    const url = new URL(location.href);
    if (game.view === 'sites') { url.searchParams.delete('view'); url.searchParams.delete('character'); }
    else {
      url.searchParams.set('view', game.view);
      if (game.view === 'game' && game.job?.id) url.searchParams.set('character', game.job.id); else url.searchParams.delete('character');
    }
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function selectView(view, focus = false) {
    if (!VIEWS.includes(view) || $(`view-tab-${view}`).hidden) view = 'sites';
    game.view = view;
    for (const name of VIEWS) {
      const tab = $(`view-tab-${name}`), selected = name === view;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      $(`${name}-view`).hidden = !selected;
    }
    $('intro-text').textContent = $('intro-text').dataset[view];
    if (focus) $(`view-tab-${view}`).focus();
    setUrl();
    if (view === 'game') { if (!game.defaults) loadDefaults(); refreshPairs(); renderFrame(); }
    // A hidden scene keeps two game loops running, so it is unloaded until the view returns.
    else { $('game-frame').removeAttribute('src'); game.frameUrl = ''; }
    document.dispatchEvent(new CustomEvent('studio:view', { detail: { view } }));
  }

  // Roles open with a capital in the canon ("Keeper of the Vesper beacon"); mid-sentence only that first letter drops.
  const midSentence = text => text.charAt(0).toLowerCase() + text.slice(1);

  function renderWorld() {
    const world = game.defaults?.world;
    if (!world) return;
    const card = node('div', 'game-world-card');
    const title = node('p', 'game-world-title', world.name); title.append(node('span', '', ` · ${world.scene.name}`));
    const abilities = node('ul', 'game-abilities');
    for (const ability of world.character.abilities) { const item = node('li'); item.append(node('strong', '', ability.name), document.createTextNode(` ${ability.description}`)); abilities.append(item); }
    const music = game.defaults.music;
    card.append(title, node('p', 'game-world-premise', world.premise), node('p', 'game-world-scene', world.scene.summary),
      node('p', 'game-world-character', `${world.character.name} the ${midSentence(world.character.role)} meets ${world.keeper.name}, ${midSentence(world.keeper.role)}.`), abilities,
      node('p', 'field-hint', `Both runs share this world’s lore, layout and story beats, the keeper and the engine. Each designs the character’s look, movement and lines, and the moment around it: the sky, the weather, the beacons, the render style of the whole frame${music ? ` and the music, from an open library of ${music.tracks} ${music.licenses.join(' and ')} tracks` : ''}.`));
    $('game-world').replaceChildren(card);
  }

  function fillAges() {
    const select = $('game-age'), current = select.value;
    const options = [node('option', '', 'Any age')];
    options[0].value = '';
    for (const band of game.defaults?.ageBands || []) { const option = node('option', '', band.label); option.value = band.value; options.push(option); }
    select.replaceChildren(...options);
    select.value = [...select.options].some(option => option.value === current) ? current : '';
  }

  function fillBrief(brief) {
    $('game-brief').value = brief.brief;
    $('game-references').value = brief.references.map(ref => ref.name).join('\n');
  }

  async function loadDefaults() {
    try {
      game.defaults = await api('/api/character-defaults');
      renderWorld(); fillAges();
      if (!$('game-brief').value.trim()) fillBrief(game.defaults.brief);
    } catch (error) { $('game-world').replaceChildren(node('p', 'loading-copy', `The world could not be loaded: ${error.message}`)); }
    renderControls();
  }

  // The pair list loaded without the token, which no token can equal.
  const SHOWCASE_ONLY = Symbol('showcase only');
  /** The showcased pair as an entry of the pair list, from its public record. */
  const showcaseEntry = job => ({ id: job.id, status: job.status, createdAt: job.createdAt, imported: job.imported || null, references: (job.brief?.references || []).map(ref => ref.name), profile: false });

  /**
   * The pair list needs the access token when the server requires one; it is loaded again when the token changes.
   * Without the token the list holds only the showcased pair, which the server serves to anyone. A page opened without
   * a pair to show opens a running pair, then the showcased one, then the latest.
   */
  async function refreshPairs(force = false) {
    const showcase = await showcaseRequest;
    if (game.view !== 'game' || !state.status) return;
    game.showcaseId = showcase.game?.id || null;
    if (state.status.access?.required && !state.token) {
      if (!force && game.pairsFor === SHOWCASE_ONLY) return;
      game.pairs = showcase.game ? [showcaseEntry(showcase.game)] : []; game.pairsFor = SHOWCASE_ONLY;
      renderPairs();
      // A link to another pair waits for the token; the showcased pair opens when nothing else is asked for.
      if (game.showcaseId && !game.job && (!game.pendingId || game.pendingId === game.showcaseId)) { game.pendingId = null; await openPair(game.showcaseId); }
      renderControls(); return;
    }
    if (!force && game.pairsFor === state.token) return;
    game.pairsFor = state.token;
    try { game.pairs = await api('/api/character-jobs'); }
    catch (error) { game.pairs = []; game.pairsFor = null; showGameError(`Could not list the character pairs: ${error.message}`); }
    renderPairs();
    const requested = game.pendingId || (!game.job && (game.pairs.find(pair => !terminalStatuses.has(pair.status)) || game.pairs.find(pair => pair.id === game.showcaseId) || game.pairs.find(pair => pair.status === 'completed'))?.id);
    game.pendingId = null;
    if (requested && requested !== game.job?.id) await openPair(requested);
    renderControls();
  }

  function renderPairs() {
    const select = $('game-pair-select');
    const options = [node('option', '', game.pairs.length ? 'Recorded pairs…' : game.pairsFor === SHOWCASE_ONLY ? 'Recorded pairs open with the access token' : 'No recorded pairs yet')];
    options[0].value = '';
    for (const pair of game.pairs) {
      const names = pair.references.slice(0, 3).join(', ') + (pair.references.length > 3 ? ` +${pair.references.length - 3}` : '');
      const option = node('option', '', `${pair.id === game.showcaseId ? 'Showcase · ' : ''}${dateLabel(pair.createdAt)} · ${names}${pair.imported ? ' · imported' : ''}${pair.status === 'completed' ? '' : ` · ${statusLabels[pair.status] || pair.status}`}`);
      option.value = pair.id;
      options.push(option);
    }
    select.replaceChildren(...options);
    select.value = game.job?.id && game.pairs.some(pair => pair.id === game.job.id) ? game.job.id : '';
    select.disabled = !game.pairs.length || game.submitting;
    // Completed pairs with a measured profile can lend it: reused instead of a taste pass, or swapped into the second run.
    for (const [id, first] of [['game-profile-from', 'A new Qloo taste pass'], ['game-swap-from', 'Choose a recorded pair…']]) {
      const field = $(id), current = field.value;
      const choices = [node('option', '', first)];
      choices[0].value = '';
      for (const pair of game.pairs.filter(item => item.profile)) {
        const names = pair.references.slice(0, 3).join(', ') + (pair.references.length > 3 ? ` +${pair.references.length - 3}` : '');
        const option = node('option', '', `${id === 'game-profile-from' ? 'Recorded profile · ' : ''}${names} · ${dateLabel(pair.createdAt)}`);
        option.value = pair.id;
        choices.push(option);
      }
      field.replaceChildren(...choices);
      field.value = [...field.options].some(option => option.value === current) ? current : '';
    }
  }

  async function openPair(id) {
    clearTimeout(game.timer);
    if (!id) { game.job = null; render(); setUrl(); return; }
    try {
      const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
      if (job?.kind !== 'character' || !Array.isArray(job.runs)) throw new Error('This record is not a character pair.');
      game.job = job; game.lastEvents = ''; game.lastSummary = '';
      showGameError('');
      render(); schedulePoll();
    } catch (error) { showGameError(`Could not open the pair: ${error.message}`); }
    setUrl();
  }

  function schedulePoll(delay = 2000) {
    clearTimeout(game.timer);
    if (active()) game.timer = setTimeout(poll, delay);
  }

  async function poll() {
    const id = game.job?.id;
    if (!id || game.polling) return;
    game.polling = true;
    try {
      const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
      if (game.job?.id !== id) return;
      const finished = !terminalStatuses.has(game.job.status) && terminalStatuses.has(job.status);
      game.job = job; render();
      if (finished) {
        await refreshPairs(true);
        toast(job.status === 'completed' ? 'Both characters are ready. Play them side by side.' : job.status === 'cancelled' ? 'The character pair was stopped.' : 'The character pair did not complete. Its record shows why.');
      }
      schedulePoll();
    } catch (error) {
      showGameError(`Could not refresh the pair: ${error.message} The connection will be retried.`);
      schedulePoll(5000);
    } finally { game.polling = false; }
  }

  function renderControls() {
    const locked = active() || game.submitting;
    const reason = readiness('compare');
    const refs = references(), text = $('game-brief').value.trim();
    for (const id of ['game-brief', 'game-references', 'game-pair-kind', 'game-departure']) $(id).disabled = locked || !game.defaults;
    const swap = $('game-pair-kind').value === 'swap', reused = Boolean($('game-profile-from').value);
    $('game-swap-field').hidden = !swap;
    $('game-swap-from').disabled = locked || !swap || !game.defaults;
    $('game-profile-from').disabled = locked || !game.defaults;
    // A reused profile keeps the place and age it was measured with.
    for (const id of ['game-location', 'game-age']) $(id).disabled = locked || !game.defaults || reused;
    $('game-audience-hint').textContent = reused ? 'A reused profile keeps the place and age it was measured with, so these stay empty.'
      : 'A place and an age band weight the Qloo taste pass, so they reach the data, and both runs are told them. Neither is used to guess identity.';
    const location = $('game-location').value.trim();
    const images = state.status?.images;
    const portraits = $('game-portraits'), paint = $('game-paint');
    if (!images?.available) { portraits.value = '0'; paint.checked = false; }
    portraits.disabled = locked || !images?.available;
    portraits.title = images?.available ? 'A designer whose plan chooses a portrait paints it from its imagery device, before drawing.' : images?.reason || 'Image generation is off on this server.';
    paint.disabled = locked || !images?.available;
    $('game-paint-hint').textContent = images?.available
      ? 'Codex repaints a checked drawing in the technique of its render style, from the designer’s description of every piece, and the game moves the painted pieces on the same skeleton. A designer whose plan paints reviews the drawing first, then the painted figure, and may repaint once to repair it: up to two images per character.'
      : `No portraits or painting here. ${images?.reason || 'Image generation is off on this server.'} The designers plan with methods that need none.`;
    // A study setting makes a picture method one both designers must use; it needs that method to be available.
    const requirePaint = $('game-require-paint'), requirePortrait = $('game-require-portrait');
    if (!paint.checked) requirePaint.checked = false;
    if (!(Number(portraits.value) > 0)) requirePortrait.checked = false;
    requirePaint.disabled = locked || !paint.checked;
    requirePortrait.disabled = locked || !(Number(portraits.value) > 0);
    $('game-required').hidden = !images?.available;
    const review = game.defaults?.production?.review;
    $('game-review-hint').textContent = !game.defaults ? 'Checking whether this server can capture the characters for their review.'
      : review?.available ? `Each designer captures its checked character in the game’s own pages with headless ${review.browser}, opens the captures and judges its plan against them, repairing and reviewing again once if needed.`
        : `No visual review on this server: ${review?.reason || 'no browser can capture the characters.'} The designers still plan how to make each part.`;
    const pictures = (Number(portraits.value) || 0) + (paint.checked ? 1 : 0);
    $('game-run-note').textContent = `${reused ? 'No Qloo request: the recorded profile is reused' : 'One Qloo taste pass of up to 24 requests'}${swap ? ', and the second run reads the swapped profile without a request' : ''}; then one Kiro run per character with the same model and tools${pictures ? `, and up to ${pictures === 1 ? 'one Codex image' : `${pictures} Codex images`} per character, as each plan chooses` : ''}. Model usage may incur charges.`;
    $('game-brief-count').textContent = `${$('game-brief').value.length.toLocaleString('en-US')} / 3,500`;
    const problem = !game.defaults ? 'Loading the world and the default brief.' : text.length < 40 ? 'The brief needs at least 40 characters.' : !refs.length ? 'Name at least one work, artist or brand the audience loves.'
      : refs.length > MAX_REFERENCES ? `Use at most ${MAX_REFERENCES} references.` : location && location.length < 2 ? 'Name the audience’s place in at least two characters, or leave it empty.'
        : swap && !$('game-swap-from').value ? 'Choose the recorded pair whose profile the second run reads.'
          : swap && reused && $('game-swap-from').value === $('game-profile-from').value ? 'Swap in a profile from another pair than the one this pair reuses.' : '';
    $('game-readiness').textContent = game.submitting ? 'Sending the pair request…' : active() ? (game.job.status === 'queued' ? 'Queued behind another generation. The pair starts when the Studio is free.' : 'The pair is running. The taste pass and both design sessions report their steps below.')
      : reason || problem || (swap ? 'Both characters use the same brief, model, world and tools; only the measured profile differs.' : 'Both characters use the same brief, model, world and tools; only the taste source differs.');
    $('game-readiness').classList.toggle('warning', !locked && Boolean(reason || (problem && game.defaults)));
    $('game-start').disabled = locked || Boolean(reason) || Boolean(problem);
    $('game-start-label').textContent = game.submitting ? 'Starting…' : active() ? 'Pair in progress' : 'Design both characters';
    $('game-cancel').hidden = !active();
    $('game-cancel').disabled = game.cancelling;
    $('game-cancel').textContent = game.cancelling ? 'Stopping…' : 'Stop the pair';
    $('game-pair-select').disabled = !game.pairs.length || game.submitting;
  }

  function render() {
    const job = game.job;
    $('game-status').textContent = job ? statusLabels[job.status] || job.status : 'No pair open';
    $('game-status').className = `job-status ${job?.status || ''}`;
    $('game-live').hidden = !active();
    renderPairs(); renderSummary(); renderFrame(); renderEvents(); renderControls();
  }

  function metric(container, value, label) {
    const item = node('div', 'taste-metric'); item.append(node('strong', '', value), node('span', '', label)); container.append(item);
  }

  function renderSummary() {
    const job = game.job;
    // A pair whose pictures a generator made is marked as recorded where one ran, when this server has none.
    const recorded = Boolean(job?.pictures?.providers?.length && state.status?.images && !state.status.images.available);
    const signature = JSON.stringify([job?.id, job?.status, job?.taste, job?.swapTaste, job?.protocol, job?.production, job?.comparison, job?.imported, job?.recordKind, recorded, game.showcaseId]);
    if (signature === game.lastSummary) return;
    game.lastSummary = signature;
    $('game-summary').hidden = !job;
    if (!job) return;
    const comparison = job.comparison, taste = job.taste, protocol = job.protocol || {};
    const labels = comparison?.labels || { baseline: job.runs[0]?.label || 'Qloo off', qloo: job.runs[1]?.label || 'Qloo on' };
    const earlier = taste && !taste.qualities?.length && !taste.fixture;
    $('game-summary-tag').textContent = [job.id === game.showcaseId ? 'Showcase' : '', job.recordKind === 'dry-run' ? 'Fixture record' : '', job.imported ? 'Imported' : '', recorded ? 'Recorded with local image generation' : '', earlier && comparison ? 'Earlier protocol' : '',
      job.swapFrom ? 'Swap pair' : '', job.departure === false ? 'Ablation: no departure rule' : '', comparison && !protocol.artDirection && !earlier ? 'Before art direction' : ''].filter(Boolean).join(' · ') || (statusLabels[job.status] || job.status);
    $('game-headline').textContent = comparison?.headline || (job.status === 'completed' ? 'The pair completed without a comparison.' : terminalStatuses.has(job.status) ? job.error || 'The pair did not complete.' : 'The characters are being designed. The comparison appears when both are saved.');
    $('game-detail').textContent = [comparison?.dataHeadline, comparison?.qualityHeadline, comparison?.worldHeadline, comparison?.renderHeadline, comparison?.productionHeadline, comparison?.sketchHeadline,
      earlier && comparison ? 'Recorded before shared qualities: its anchors are the highest-affinity entities, and its palette and silhouette did not have to rest on qualities.' : ''].filter(Boolean).join(' ');
    $('game-detail').hidden = !$('game-detail').textContent;
    const metrics = $('game-metrics'); metrics.replaceChildren();
    const both = text => `${text} · ${labels.baseline} · ${labels.qloo}`;
    if (comparison?.distance) {
      const d = comparison.distance;
      metric(metrics, score(d.overall), d.world !== undefined ? `Design distance · character ${score(d.character)}, moment ${score(d.world)}` : `Character distance · palette ${score(d.palette)}, silhouette ${score(d.silhouette)}, motion ${score(d.motion)}, voice ${score(d.voice)}`);
      metric(metrics, `${percent(comparison.sketch?.baseline)} · ${percent(comparison.sketch?.qloo)}`, both('character moved from its own blind sketch'));
      if (comparison.momentMoved) metric(metrics, `${percent(comparison.momentMoved.baseline)} · ${percent(comparison.momentMoved.qloo)}`, both('moment moved from its sketched moment'));
      metric(metrics, `${percent(comparison.conformance?.baseline)} · ${percent(comparison.conformance?.qloo)}`, both('DNA conformance'));
    }
    // Each arm's own review of captures of its character: the criteria its last round judged met.
    const reviewed = side => side?.review ? `${side.review.met}/${side.criteria}` : '—';
    if (job.production && (job.production.baseline?.review || job.production.qloo?.review)) {
      metric(metrics, `${reviewed(job.production.baseline)} · ${reviewed(job.production.qloo)}`, both('own criteria met at the last self-review'));
    }
    if (taste) metric(metrics, taste.fixture ? 'Fixture' : taste.reusedFrom ? '0' : String(taste.calls ?? '—'), taste.fixture ? 'taste profile; no Qloo request was made' : taste.reusedFrom ? `Qloo requests: the profile of ${taste.reusedFrom} was reused${taste.replayed ? ', read again from its recorded responses' : ''}` : 'Qloo requests in one taste pass, before either run');
    metrics.hidden = !metrics.childElementCount;
    const qualities = $('game-qualities'); qualities.replaceChildren();
    const profileBlock = (source, title) => {
      if (!source?.qualities?.length) return;
      qualities.append(node('p', 'game-qualities-title', title));
      const list = node('dl', 'game-quality-list');
      for (const [family, label] of FAMILIES) {
        const items = source.qualities.filter(item => item.family === family);
        if (!items.length) continue;
        const values = node('dd');
        for (const item of items) {
          const chip = node('span', `quality-chip${item.surprise ? ' surprise' : ''}`, `${item.name}${item.surprise ? ' ✦' : ''}`);
          chip.append(node('small', '', `${count(item.count, 'work')} · ${count(item.domains?.length || 0, 'domain')}`));
          values.append(chip);
        }
        list.append(node('dt', '', label), values);
      }
      if (source.artStyles?.length) {
        const values = node('dd');
        for (const item of source.artStyles) {
          const chip = node('span', `quality-chip${item.surprise ? ' surprise' : ''}`, `${item.name}${item.surprise ? ' ✦' : ''}`);
          chip.append(node('small', '', `${count(item.count, 'work')}${item.preset ? ` · draws ${item.preset}` : ''}`));
          values.append(chip);
        }
        list.append(node('dt', '', 'Art style'), values);
      }
      qualities.append(list);
      const notes = [source.renderStyle ? `The strongest render style, ${source.renderStyle.name}, draws the frame in ${source.renderStyle.preset} unless the design sets it aside with a reason.` : '',
        source.tags?.length ? `Ranked tags for the whole audience: ${join(source.tags.map(tag => `${tag.name}${tag.surprise ? ' ✦' : ''}`))}.` : ''].filter(Boolean);
      if (notes.length) qualities.append(node('p', 'workflow-hint', notes.join(' ')));
    };
    profileBlock(taste, job.swapTaste ? `This brief’s profile: the qualities its audience’s works share, measured by Qloo. ${labels.baseline} designed from them. ✦ marks qualities the model did not predict.`
      : 'Qualities the audience’s works share, measured by Qloo. The Qloo on character’s palette, silhouette and moment rest on them. ✦ marks qualities the model did not predict.');
    if (job.swapTaste) profileBlock(job.swapTaste, `The swapped profile, recorded for ${job.swapTaste.from || 'another pair'}${job.swapTaste.seeds?.length ? ` from ${join(job.swapTaste.seeds.map(seed => seed.name).slice(0, 4))}` : ''}. ${labels.qloo} designed from it under the same brief.`);
    const tracks = comparison?.moments ? [[labels.baseline, comparison.moments.baseline], [labels.qloo, comparison.moments.qloo]].filter(([, moment]) => moment?.music) : [];
    if (tracks.length) qualities.append(node('p', 'game-music-credits', `Music: ${tracks.map(([label, moment]) => `${label}, “${moment.music.title}” by ${moment.music.artist} (${moment.music.license}, ${moment.music.source})`).join('; ')}.`));
    qualities.hidden = !qualities.childElementCount;
  }

  function renderFrame() {
    const job = game.job, frame = $('game-frame'), placeholder = $('game-placeholder');
    const url = game.view === 'game' && job?.urls?.embed ? job.urls.embed : '';
    if (url !== game.frameUrl) {
      game.frameUrl = url;
      if (url) frame.src = url; else frame.removeAttribute('src');
    }
    frame.hidden = !url;
    placeholder.hidden = Boolean(url);
    placeholder.classList.toggle('is-running', active());
    placeholder.classList.toggle('is-error', Boolean(job && ['failed', 'cancelled'].includes(job.status)));
    const labels = (job?.runs || []).map(run => run.label);
    $('game-badge').textContent = labels.length ? labels.join(' · ') : 'Qloo off · Qloo on';
    $('game-placeholder-text').textContent = !job ? 'Open a recorded pair, or design a new one from the brief.'
      : active() ? `${job.taste?.reusedFrom || job.profileFrom ? 'The recorded profile is loaded first' : 'The taste pass runs first'}, then ${join(labels)} design their characters one after the other.`
        : job.status === 'completed' ? 'Loading the scene…' : job.error || 'The pair did not complete.';
    const links = $('game-links'); links.replaceChildren();
    if (job?.urls) {
      const link = (href, text, label) => { const anchor = node('a', '', text); anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.setAttribute('aria-label', `${label} (opens in a new tab)`); return anchor; };
      links.append(link(job.urls.compare, 'Full screen', 'Open the comparison full screen'),
        ...job.runs.filter(run => job.urls.play?.[run.key]).map(run => link(job.urls.play[run.key], `Play ${run.label}`, `Play the ${run.label} character`)));
    }
  }

  function renderEvents() {
    const runs = game.job?.runs || [];
    const events = runs.flatMap(run => (run.events || []).map(event => ({ ...event, mode: run.mode, label: run.label })));
    events.sort((a, b) => (new Date(a.time).getTime() || 0) - (new Date(b.time).getTime() || 0));
    $('game-events-count').textContent = String(events.length);
    const signature = JSON.stringify(events);
    if (signature === game.lastEvents) return;
    game.lastEvents = signature;
    const area = $('game-events');
    if (!events.length) { emptyLog(area, game.job ? 'Waiting for the first step. Only steps the server records appear here.' : 'The taste pass and both design sessions report their steps here.'); return; }
    const stayAtBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 45;
    const list = node('ol', 'event-list game-event-list');
    for (const event of events) {
      const item = node('li', event.type === 'error' ? 'error' : '');
      const time = node('time', '', formatTime(event.time));
      if (!Number.isNaN(new Date(event.time).getTime())) time.dateTime = new Date(event.time).toISOString();
      item.append(time, node('span', `event-mode ${event.mode}`, event.label || event.mode), node('p', '', String(event.message || '')));
      list.append(item);
    }
    area.replaceChildren(list);
    if (stayAtBottom) area.scrollTop = area.scrollHeight;
  }

  async function start(event) {
    event.preventDefault();
    if ($('game-start').disabled) return;
    const refs = references();
    game.submitting = true; showGameError(''); renderControls();
    try {
      const swap = $('game-pair-kind').value === 'swap', reused = $('game-profile-from').value;
      const body = { kind: 'character', brief: { name: `The Long Dusk pair for ${join(refs.slice(0, 3))}${refs.length > 3 ? ' and more' : ''}`, brief: $('game-brief').value.trim(), references: refs },
        // A painting arm may repaint once, to repair what the review of its painted figure finds.
        portraitsPerArm: Number($('game-portraits').value) || 0, paintPerArm: $('game-paint').checked ? 2 : 0, departure: $('game-departure').checked,
        required: [['game-require-paint', 'painted-rig'], ['game-require-portrait', 'portrait']].filter(([id]) => $(id).checked && !$(id).disabled).map(([, method]) => method),
        ...(reused ? { profileFrom: reused } : { ...($('game-location').value.trim() ? { location: $('game-location').value.trim() } : {}), ...($('game-age').value ? { age: $('game-age').value } : {}) }),
        ...(swap ? { swapFrom: $('game-swap-from').value } : {}) };
      const { id } = await api('/api/jobs', { method: 'POST', body: JSON.stringify(body) });
      await openPair(id);
      await refreshPairs(true);
      toast('The character pair started: one taste pass, then one design run per character.');
    } catch (error) { showGameError(error.message); }
    finally { game.submitting = false; renderControls(); }
  }

  async function cancel() {
    if (!game.job || !active()) return;
    game.cancelling = true; renderControls();
    try { game.job = await api(`/api/jobs/${encodeURIComponent(game.job.id)}/cancel`, { method: 'POST' }); render(); schedulePoll(); }
    catch (error) { showGameError(`Could not stop the pair: ${error.message}`); }
    finally { game.cancelling = false; renderControls(); }
  }

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => selectView(button.dataset.view));
    button.addEventListener('keydown', event => {
      const views = VIEWS.filter(name => !$(`view-tab-${name}`).hidden), index = views.indexOf(button.dataset.view);
      const next = { ArrowRight: views[(index + 1) % views.length], ArrowLeft: views[(index + views.length - 1) % views.length], Home: views[0], End: views.at(-1) }[event.key];
      if (next) { event.preventDefault(); selectView(next, true); }
    });
  });
  $('game-form').addEventListener('submit', start);
  $('game-cancel').addEventListener('click', cancel);
  $('game-brief').addEventListener('input', renderControls);
  $('game-references').addEventListener('input', renderControls);
  $('game-location').addEventListener('input', renderControls);
  for (const id of ['game-pair-kind', 'game-swap-from', 'game-profile-from', 'game-age', 'game-departure', 'game-portraits', 'game-paint', 'game-require-paint', 'game-require-portrait']) $(id).addEventListener('change', renderControls);
  $('game-pair-select').addEventListener('change', () => openPair($('game-pair-select').value));
  // app.js renders the service status after every check and whenever the access token changes.
  document.addEventListener('studio:status', () => { renderControls(); refreshPairs(); });
  window.addEventListener('beforeunload', () => clearTimeout(game.timer));

  const initial = new URL(location.href).searchParams;
  const requested = initial.get('character');
  game.pendingId = /^[a-f0-9-]{36}$/iu.test(requested || '') ? requested : null;
  if (initial.get('view') === 'app') selectView('app');
  else if (initial.get('view') === 'game' || game.pendingId) selectView('game');
  render();
  // The App interface tab shows only with a showcased app run; a page opened on it without one falls back to the websites.
  showcaseRequest.then(showcase => {
    $('view-tab-app').hidden = !showcase.app;
    if (!showcase.app && game.view === 'app') selectView('sites');
  });
})();
