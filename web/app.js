'use strict';

const $ = (id) => document.getElementById(id);
const requestedJobId = new URL(location.href).searchParams.get('job');
const state = { status: null, statusError: '', templates: [], selectedTemplate: null, job: null, token: '', submitting: false, restoring: false, pendingRestoreId: /^[a-f0-9-]{36}$/i.test(requestedJobId || '') ? requestedJobId : null, cancelling: false, refreshing: false, polling: false, activeTab: 'events', modeInitialized: false, jobTimer: null, statusTimer: null, toastTimer: null, lastInspection: '' };
const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
const modes = ['baseline', 'qloo'];
const labels = { baseline: 'Qloo off', qloo: 'Qloo on' };
const statusLabels = { queued: 'Queued', running: 'Generating', completed: 'Completed', failed: 'Failed', cancelled: 'Stopped' };
const templateSymbols = { 'local-food': '◒', 'indie-game': '⌘', 'boutique-hotel': '⌂', 'record-store': '◎', 'fashion-brand': '◇', 'creative-workshop': '✳' };
Object.assign(state, { showcase: null, workspace: null, workspaces: [], workspaceBusy: false, audiences: [], planJob: null, selectedDirection: null, inspectorEnabled: false, inspected: null, inspectorSessions: {}, diffCache: new Map(), diffLoading: false, hydratedJobId: null, preparationJob: null, pendingProduction: null, cultureExtensions: {}, contextSource: 'starter-default', contextTemplateId: null, defaultContextSnapshot: null, lastTaste: '' });
const inspectionTabs = ['events', 'evidence', 'decisions', 'diff'];
// The showcase: the recorded work a reviewer sees first, which the server serves without the access token. This one
// request answers for every view; game.js and showcase.js read it too.
const showcaseRequest = fetch('/api/showcase', { headers: { Accept: 'application/json' }, cache: 'no-store' })
  .then((response) => (response.ok ? response.json() : null)).catch(() => null)
  .then((value) => ({ sites: value?.sites?.id ? value.sites : null, game: value?.game?.id ? value.game : null, app: value?.app?.id && value.app.base ? value.app : null }));
const isShowcaseJob = (job) => Boolean(job?.id && job.id === state.showcase?.sites?.id);

function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = String(text);
  return result;
}

function isActive() {
  return Boolean(state.job && !terminalStatuses.has(state.job.status));
}

function needsJobPoll() {
  return isActive() || Boolean(state.job?.status === 'cancelled' && state.job.runs?.some((run) => ['queued', 'running'].includes(run.status)));
}

function currentMode() {
  return document.querySelector('input[name="mode"]:checked')?.value || 'baseline';
}

function headers(json = false) {
  const result = { Accept: 'application/json' };
  if (json) result['Content-Type'] = 'application/json';
  if (state.token) result['X-Demo-Token'] = state.token;
  return result;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers(Boolean(options.body)), ...options.headers }, cache: 'no-store' });
  let result;
  try { result = await response.json(); } catch { throw new Error('The server did not return readable JSON. Check your connection.'); }
  if (!response.ok) {
    const detail = typeof result.error === 'string' ? result.error : result.error?.message || result.message;
    if (response.status === 401 || response.status === 403) throw new Error(detail || 'Demo access could not be verified. Check your token in Access settings.');
    throw new Error(detail || `Request failed (${response.status}).`);
  }
  return result;
}

function showError(message) {
  $('form-error').textContent = message || '';
  $('form-error').hidden = !message;
}

function toast(message) {
  clearTimeout(state.toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  state.toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

function readiness(mode) {
  if (!state.status) return state.statusError || 'Checking service connections.';
  if (!state.status.kiro?.available) return 'Kiro CLI was not found on the server. Generation requires a Kiro connection.';
  if (!state.status.kiro?.authenticated) return 'Kiro authentication is not confirmed. Check the server’s Kiro session.';
  if (!state.status.model) return 'A model has not been selected. Check the server’s model configuration.';
  if (mode !== 'baseline' && !state.status.qloo?.configured) return 'The Qloo API key is not configured. Qloo off generation is available.';
  if (mode === 'compare' && !state.status.comparisonReady) return 'Comparison is not ready. Check the service configuration.';
  if (state.status.access?.required && !state.token) return 'This demo requires an access token. Enter it in Access settings.';
  return '';
}

function renderModelLabel() {
  const model = state.status?.model || state.job?.model;
  $('model-label').textContent = model ? `Generation model · ${model}` : 'Waiting for model information';
  $('model-label').title = state.job?.model && state.job.model !== model ? `This saved run used ${state.job.model}. New generations use ${model}.` : 'Model used for new generations.';
}

function renderStatus() {
  const service = state.status;
  renderModelLabel();
  $('kiro-version').textContent = service?.kiro?.version ? `Kiro · ${service.kiro.version}` : 'Kiro CLI';
  const kiroReady = Boolean(service?.kiro?.available && service?.kiro?.authenticated);
  $('kiro-state').textContent = !service ? 'No connection' : !service.kiro?.available ? 'Not found' : !service.kiro?.authenticated ? 'Sign-in required' : 'Connected';
  $('kiro-state').className = `service-value ${kiroReady ? 'ready' : 'error'}`;
  $('qloo-state').textContent = !service ? 'No connection' : service.qloo?.configured ? 'Key configured' : 'Key required';
  $('qloo-state').className = `service-value ${service?.qloo?.configured ? 'ready' : 'error'}`;
  // Generated images are optional, so an unavailable generator reads as off rather than as an error.
  const images = service?.images;
  $('images-state').textContent = !service ? 'No connection' : images?.available ? `${images.provider === 'codex' ? 'Codex' : images.provider || 'On'}${images.version ? ` · ${images.version}` : ''}` : 'Off';
  $('images-state').className = `service-value${images?.available ? ' ready' : ''}`;
  $('images-state').title = images?.available ? 'Taste-led builds can request images from their DNA imagery devices.' : images?.reason || '';
  // Captures for the designers' own review are optional too: without a browser the plans are still made, and nothing is reviewed.
  const capture = service?.capture;
  $('capture-state').textContent = !service ? 'No connection' : capture?.available ? capture.label || 'On' : 'Off';
  $('capture-state').className = `service-value${capture?.available ? ' ready' : ''}`;
  $('capture-state').title = capture?.available ? 'Taste-led builds capture their saved site so each designer can review it against its own plan.' : capture?.reason || '';
  const connection = $('connection-summary');
  connection.replaceChildren();
  const ready = kiroReady && service?.qloo?.configured && service?.comparisonReady;
  connection.append(node('span', `status-dot ${ready ? 'ready' : service ? 'pending' : 'error'}`), document.createTextNode(ready ? 'Ready to generate' : kiroReady ? 'Ready with Qloo off' : 'Connection required'));
  $('access-description').textContent = !service ? 'The server’s access status could not be read.' : service.access?.required ? 'This server requires a demo token for generation and downloads.' : 'This server does not require a demo token.';
  $('token-dot').hidden = !state.token;
  $('refresh-status').disabled = state.refreshing;
  renderControls();
  // The taste panel labels recorded pictures by whether this server can generate them.
  if (state.job) renderTaste();
  // The Game character view (game.js) follows the same status and access token.
  document.dispatchEvent(new CustomEvent('studio:status'));
}

function renderControls() {
  const locked = isActive() || state.submitting || state.restoring || state.workspaceBusy;
  const radioInputs = [...document.querySelectorAll('input[name="mode"]')];
  for (const input of radioInputs) {
    const reason = readiness(input.value);
    input.disabled = locked || Boolean(reason);
    input.closest('label').title = reason || '';
  }
  if (!locked) {
    const selected = radioInputs.find((input) => input.checked);
    if (!state.selectedDirection && (!state.modeInitialized || selected?.disabled) && radioInputs.some((input) => !input.disabled)) {
      const available = radioInputs.find((input) => input.value === 'compare' && !input.disabled) || radioInputs.find((input) => input.value === 'qloo' && !input.disabled) || radioInputs.find((input) => !input.disabled);
      available.checked = true;
      state.modeInitialized = true;
    }
  }
  for (const button of document.querySelectorAll('.template-button')) button.disabled = locked;
  $('brief').disabled = locked || !state.selectedTemplate;
  $('brief-count').textContent = `${$('brief').value.length.toLocaleString('en-US')} / 3,500`;
  const reason = readiness(currentMode());
  $('readiness-note').textContent = state.restoring ? 'Loading saved generation…' : state.submitting ? 'Sending generation request…' : isActive() ? state.job?.kind === 'prepare' ? 'The agent is preparing creative context. No Qloo calls are made.' : 'The agent is working. Outputs and records update as they arrive.' : reason || (currentMode() === 'compare' ? 'Both generations use the same brief, model, and starter files.' : 'Generation runs through a real agent.');
  $('readiness-note').classList.toggle('warning', Boolean(reason) && !locked);
  $('start-button').disabled = locked || Boolean(reason) || !state.selectedTemplate || $('brief').value.trim().length < 10;
  $('start-label').textContent = state.submitting ? 'Starting…' : isActive() ? state.job?.kind === 'prepare' ? 'Preparing creative context' : 'Generation in progress' : state.selectedDirection ? 'Build selected direction' : currentMode() === 'compare' ? 'Generate both designs' : 'Generate design';
  $('cancel-button').hidden = !isActive();
  $('cancel-button').disabled = state.cancelling;
  $('cancel-button').textContent = state.cancelling ? 'Stopping…' : state.job?.kind === 'prepare' ? 'Stop preparation' : 'Stop generation';
  $('plan-button').disabled = locked || Boolean(reason) || !state.selectedTemplate || $('brief').value.trim().length < 10;
  $('prepare-button').disabled = locked || Boolean(readiness('baseline')) || !state.selectedTemplate || $('brief').value.trim().length < 10;
  $('prepare-button').title = 'Prepare with the current model. No Qloo API key is required.';
  for (const input of $('preparation-panel').querySelectorAll('input,textarea,button')) input.disabled = locked;
  const clarificationFinished = (state.preparationJob?.preparationRound || 0) >= 1;
  $('preparation-answer').disabled = locked || clarificationFinished;
  $('preparation-submit').disabled = locked || clarificationFinished || !$('preparation-answer').value.trim();
  for (const input of $('context-panel').querySelectorAll('input,textarea,button')) input.disabled = locked;
  $('add-audience').disabled = locked || state.audiences.length >= 3;
  $('production-audience').disabled = locked;
  // A study setting makes generated images a method both designers must use; without it each plan decides.
  const staged = Boolean(state.status?.production?.stages && state.status?.protocol === 'taste');
  const study = staged && Boolean(state.status?.images?.available);
  $('study-images-field').hidden = !study;
  $('study-images').disabled = locked || !study;
  // Without a generator, such as on a hosted server, the form says why and how the plans make imagery instead.
  const imagesOff = Boolean(staged && state.status?.images && !state.status.images.available);
  $('site-images-hint').hidden = !imagesOff;
  $('site-images-hint').textContent = imagesOff ? `No generated pictures here. ${state.status.images.reason || 'Image generation is off.'} Each designer’s plan makes its imagery with methods that need no generator.` : '';
  for (const id of ['save-workspace', 'new-workspace', 'import-workspace', 'workspace-select', 'workspace-name']) $(id).disabled = locked;
  $('export-workspace').disabled = locked || !state.workspace?.id;
  $('selected-direction-note').hidden = !state.selectedDirection;
  $('selected-direction-title').textContent = state.selectedDirection ? `Direction · ${state.selectedDirection.title}` : '';
  $('clear-direction').disabled = locked;
  for (const button of document.querySelectorAll('.direction-card button[data-direction-ready]')) button.disabled = locked || button.dataset.directionReady !== 'true';
  $('revision-source').disabled = locked; $('revision-target').disabled = locked; $('revision-brief').disabled = locked;
  const sourceMode = $('revision-source').value;
  $('revise-button').disabled = locked || !completedRun(sourceMode) || Boolean(readiness(sourceMode)) || !validSelector($('revision-target').value.trim()) || $('revision-brief').value.trim().length < 10;
}

async function refreshStatus(reinspect = false) {
  if (state.refreshing) return;
  state.refreshing = true;
  $('refresh-status').disabled = true;
  try {
    state.status = await api(reinspect ? '/api/status?refresh=1' : '/api/status');
    state.statusError = '';
  } catch (error) {
    state.status = null;
    state.statusError = error.message;
  } finally {
    state.refreshing = false;
    renderStatus();
  }
}

async function loadTemplates() {
  try {
    const result = await api('/api/templates');
    if (!Array.isArray(result) || !result.length) throw new Error('The server does not provide a starter template yet.');
    state.templates = result.filter((template) => typeof template.id === 'string' && typeof template.name === 'string');
    if (!state.templates.length) throw new Error('Starter templates could not be read.');
    $('template-grid').replaceChildren();
    state.templates.forEach((template, index) => {
      const button = node('button', 'template-button');
      button.type = 'button'; button.dataset.template = template.id; button.setAttribute('aria-pressed', 'false');
      const top = node('span', 'template-button-top');
      top.append(node('span', 'template-button-number', String(index + 1)), node('span', 'template-button-icon', templateSymbols[template.id] || '◇'));
      top.lastChild.setAttribute('aria-hidden', 'true');
      button.append(top, node('strong', '', template.name));
      button.title = template.description || template.name;
      button.addEventListener('click', () => { state.pendingRestoreId = null; selectTemplate(template); });
      $('template-grid').append(button);
    });
    selectTemplate(state.templates[0]);
  } catch (error) {
    $('template-grid').replaceChildren(node('p', 'loading-copy', 'Templates could not be loaded.'));
    showError(error.message);
  }
}

function selectTemplate(template) {
  if (isActive() || state.submitting) return;
  const previousTemplate = state.selectedTemplate;
  const switching = previousTemplate && previousTemplate.id !== template.id;
  let resetDefaultContext = !previousTemplate;
  if (switching) {
    try { resetDefaultContext = state.contextSource === 'starter-default' && JSON.stringify(readCultureBrief()) === state.defaultContextSnapshot; }
    catch { resetDefaultContext = false; }
  }
  if (state.workspace && state.workspace.templateId !== template.id) {
    state.workspace = null; $('workspace-name').value = ''; $('workspace-select').value = ''; renderVariants();
    workspaceFeedback('A separate workspace will be created for this starter. Your previously saved workspace remains in the archive.');
  }
  state.selectedTemplate = template;
  if (resetDefaultContext) applyCultureBrief(template.defaultCultureBrief || {}, { source: 'starter-default', templateId: template.id });
  else if (switching) {
    const sourceName = state.templates.find((entry) => entry.id === state.contextTemplateId)?.name || previousTemplate.name;
    $('context-origin-note').textContent = `Your saved or edited cultural context from ${sourceName} was retained. Review its audience references and brand constraints before using ${template.name}.`;
    $('context-origin-note').hidden = false;
  }
  state.planJob = null; state.selectedDirection = null; state.inspected = null;
  state.preparationJob = null; state.pendingProduction = null;
  for (const button of document.querySelectorAll('.template-button')) {
    const selected = button.dataset.template === template.id;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
  $('brief').value = template.defaultBrief || '';
  $('template-description').textContent = template.description || '';
  $('starter-name').textContent = template.name;
  $('starter-empty').hidden = false;
  $('starter-empty').textContent = 'Loading starter preview.';
  $('starter-frame').src = `/templates/${encodeURIComponent(template.id)}/index.html`;
  if (state.job) { state.job = null; state.lastInspection = ''; updateJobUrl(null); renderJob(); }
  renderDirections();
  showError('');
  renderControls();
}

function previewUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const candidate = new URL(value, location.origin);
    const allowed = new Set([location.origin]);
    if (typeof state.status?.previewOrigin === 'string') {
      const configured = new URL(state.status.previewOrigin);
      if (/^https?:$/.test(configured.protocol)) allowed.add(configured.origin);
    }
    return /^https?:$/.test(candidate.protocol) && !candidate.username && !candidate.password && allowed.has(candidate.origin) ? candidate.href : null;
  } catch { return null; }
}

function placeholder(mode, title, description, kind = '') {
  const area = $(`${mode}-placeholder`);
  area.className = `result-placeholder ${kind}`;
  area.hidden = false;
  area.querySelector('strong').textContent = title;
  area.querySelector('p').textContent = description;
}

function researchWasSkipped(run) {
  return Boolean(run?.mode === 'qloo' && run.status === 'completed' && !run.evidence?.length && run.assessmentCalls?.length && run.assessmentCalls.every((call) => call.result?.action === 'skip'));
}

function runLabel(mode, run = state.job?.runs?.find((entry) => entry.mode === mode)) {
  return researchWasSkipped(run) ? 'Qloo available' : labels[mode];
}

function renderRun(mode) {
  const run = state.job?.runs?.find((entry) => entry.mode === mode);
  const frame = $(`${mode}-frame`);
  const runStatus = $(`${mode}-status`);
  const detail = $(`${mode}-detail`);
  const download = document.querySelector(`[data-download="${mode}"]`);
  const refresh = document.querySelector(`[data-refresh="${mode}"]`);
  const skipped = researchWasSkipped(run);
  if (mode === 'qloo') {
    $('qloo-heading').textContent = skipped ? 'Qloo available' : 'Qloo on';
    $('result-qloo').querySelector('.data-badge').textContent = skipped ? 'Research skipped' : 'Cultural data';
    frame.title = skipped ? 'Site generated with Qloo available; cultural research was skipped' : 'Site generated with Qloo on';
  }
  runStatus.textContent = run ? statusLabels[run.status] || run.status || 'Waiting' : state.job ? 'Not included' : 'Waiting';
  runStatus.className = `run-status ${run?.status || ''}`;
  const safeUrl = previewUrl(run?.previewUrl);
  if (safeUrl) {
    if (frame.dataset.currentUrl !== safeUrl) { delete state.inspectorSessions[mode]; frame.src = safeUrl; frame.dataset.currentUrl = safeUrl; }
    frame.hidden = false; $(`${mode}-placeholder`).hidden = true; refresh.hidden = false;
  } else {
    frame.hidden = true; refresh.hidden = true;
    if (frame.hasAttribute('src')) frame.removeAttribute('src');
    delete frame.dataset.currentUrl;
    if (run?.previewUrl) placeholder(mode, 'Preview URL could not be verified', 'Check the server’s previewOrigin configuration. You can still download the generated files.', 'is-error');
    else if (!state.job) placeholder(mode, mode === 'baseline' ? 'The model’s own interpretation' : 'From cultural connections to design', mode === 'baseline' ? 'The site generated from your brief and starter files appears here.' : "The site generated by the agent using Qloo data appears here.");
    else if (!run) placeholder(mode, 'Not included in this generation', 'Choose the corresponding generation mode to see this output.');
    else if (run.status === 'failed') placeholder(mode, 'Generation failed', run.error || 'Review the live activity record for details.', 'is-error');
    else if (run.status === 'cancelled') placeholder(mode, 'Generation stopped', 'The run was stopped before the agent output was ready.');
    else if (run.status === 'completed' && state.job?.kind === 'plan') placeholder(mode, 'Design directions are ready', 'Choose a direction card to generate a working site.');
    else if (run.status === 'completed') placeholder(mode, 'No preview available', 'Review the generation record and any available files below.');
    else placeholder(mode, run.status === 'queued' ? 'Waiting for the agent' : 'Generating design', 'Follow the actual generation steps in the live activity below.', 'is-running');
  }
  const conformance = run?.taste?.conformance;
  detail.textContent = !state.job ? 'No generation started yet' : !run ? 'Not included in this run' : run.status === 'completed' ? skipped ? 'Agent interpretation · no Qloo research support' : state.job.kind === 'plan' ? 'Actual design plan · inspect the cards' : Number.isFinite(conformance?.score) ? `Actual agent output · DNA ${Math.round(conformance.score * 100)}% present` : 'Actual agent output' : run.error ? 'Generation error · inspect the records' : statusLabels[run.status] || 'Run record';
  const hasFiles = Array.isArray(run?.files) ? run.files.length > 0 : Boolean(run?.files && typeof run.files === 'object' && Object.keys(run.files).length);
  download.disabled = !state.job || !run || run.status !== 'completed' || (!run.previewUrl && !hasFiles);
  download.title = download.disabled ? 'Download files from a completed generation here' : 'Download generated files as JSON';
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function emptyLog(area, message, symbol = '↳') {
  const empty = node('div', 'empty-log'); empty.append(node('span', '', symbol), node('p', '', message)); empty.firstChild.setAttribute('aria-hidden', 'true'); area.replaceChildren(empty);
}

function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(api.?key|access.?token|authorization|secret|password|demo.?token)$/i.test(key)).map(([key, content]) => [key, redactSensitive(content)]));
  }
  return value;
}

function stringify(value) {
  try { return JSON.stringify(redactSensitive(value), null, 2).slice(0, 16000); } catch { return String(value).slice(0, 16000); }
}

function textField(record, keys) {
  for (const key of keys) if (typeof record?.[key] === 'string' && record[key]) return record[key];
  return '';
}

function evidenceButton(id, mode, unverified = false) {
  const button = node('button', 'evidence-reference', id); button.type = 'button';
  button.disabled = unverified;
  button.title = unverified ? 'Imported source; not verified by this run' : 'Inspect the actual tool response';
  button.addEventListener('click', () => {
    selectTab('evidence');
    const matching = [...$('panel-evidence').querySelectorAll('[data-evidence-id]')].find((entry) => entry.dataset.evidenceId === id && entry.dataset.evidenceMode === mode);
    if (matching) matching.scrollIntoView({ block: 'nearest' });
  });
  return button;
}

function appendResearchTrace(card, record, mode) {
  const imported = record.provenance === 'caller-provided-unverified' || record.verification === 'caller-provided-unverified';
  const application = record.application && typeof record.application === 'object' ? record.application : null;
  const verification = record.verification && typeof record.verification === 'object' ? record.verification : null;
  const route = record.action || record.assessment?.action;
  const outcome = record.status || record.outcome;
  const disposition = { applied: 'Agent reports applied', considered: 'Under consideration', 'not-applied': 'Not applied' }[record.disposition];
  if (route || outcome || disposition || application?.kind) card.append(node('p', 'query-description', [route ? `Route: ${route}` : '', outcome ? `Outcome: ${outcome}` : '', application?.kind ? `Application: ${application.kind}` : '', disposition].filter(Boolean).join(' · ')));
  const stages = node('dl', 'research-trace');
  const add = (label, value) => {
    if (typeof value !== 'string' || !value) return;
    const stage = node('div', 'research-stage'); stage.append(node('dt', '', label), node('dd', '', value)); stages.append(stage);
  };
  add('Open research question', record.question);
  add('Initial approach', application?.priorApproach);
  add('Recorded finding · inspect the response', record.finding);
  add('Agent interpretation', record.interpretation);
  add('Proposed visitor change', application?.proposedChange);
  add('Recorded result', record.changeMade);
  add('Output target', application?.outputTarget || record.affectedArtifact);
  add('How to try it', application?.observableCheck);
  add('Tradeoff', application?.tradeoff);
  add('Limitation', record.limitation);
  card.append(stages);
  if (Array.isArray(record.anchors) && record.anchors.length) {
    const anchors = node('ul', 'research-anchor-list');
    const run = state.job?.runs?.find((entry) => entry.mode === mode);
    for (const anchor of record.anchors) {
      const evidence = !imported && run?.evidence?.find((entry) => entry.id === anchor.evidenceId);
      const entity = evidence?.results?.find((entry) => entry.entityId === anchor.entityId);
      const item = node('li');
      item.append(node('strong', '', entity?.name || anchor.entityId || 'Reference detail'), evidenceButton(anchor.evidenceId || 'Unlinked source', mode, imported || !evidence));
      if (anchor.detail) item.append(node('p', '', anchor.detail));
      anchors.append(item);
    }
    card.append(anchors);
  } else if (Array.isArray(record.evidenceIds) && record.evidenceIds.length) {
    const links = node('div', 'provenance');
    for (const id of record.evidenceIds) links.append(evidenceButton(id, mode, imported));
    card.append(links);
  }
  if (Array.isArray(record.webSourceIds) && record.webSourceIds.length) {
    const sources = node('ul', 'research-anchor-list');
    const run = state.job?.runs?.find((entry) => entry.mode === mode);
    for (const id of record.webSourceIds) {
      const source = !imported && run?.webSources?.find((entry) => entry.id === id);
      const item = node('li'); item.append(node('strong', '', source?.title || 'Web reference'), evidenceButton(id, mode, imported || !source));
      for (const anchor of record.webAnchors || []) if (anchor.sourceId === id && anchor.detail) item.append(node('p', '', anchor.detail));
      sources.append(item);
    }
    card.append(sources);
  }
  if (!application || verification?.status === 'legacy') card.append(node('p', 'research-status-note', 'Application detail unavailable in this record. Its rationale does not establish which source detail changed the visitor experience.'));
  if (imported) card.append(node('p', 'research-status-note', 'Imported research · source and application were not verified by this run.'));
  else if (verification) {
    const checks = node('div', 'research-checks');
    checks.append(node('strong', '', 'Record checks'));
    for (const [key, label, values] of [
      ['planTiming', 'Plan saved', { 'before-write': 'before artifact writes', 'after-write': 'after artifact writes', untracked: 'timing not recorded' }],
      ['sourceAnchors', 'Source anchor IDs', { recorded: 'recorded', none: 'none', unchecked: 'not checked' }],
      ['targetPresence', 'Output target', { present: 'present', missing: 'missing', unsupported: 'unsupported target', 'not-checked': 'not checked' }],
      ['artifactChange', 'Artifact file', { changed: 'changed', unchanged: 'unchanged', 'not-checked': 'not checked' }],
      ['targetFragmentChange', 'Target markup', { changed: 'changed', unchanged: 'unchanged', 'not-checked': 'not checked' }],
    ]) if (verification[key]) checks.append(node('span', '', `${label}: ${values[verification[key]] || 'not checked'}`));
    if (verification.limitation) checks.append(node('p', '', verification.limitation));
    card.append(checks);
  } else if (application) card.append(node('p', 'research-status-note', 'Authored application plan · source, timing and output checks are not available.'));
  const target = application?.outputTarget;
  const fragment = typeof target === 'string' ? /^(?:index\.html)?(#[A-Za-z_][A-Za-z0-9_-]{0,119})$/.exec(target)?.[1] : null;
  const run = state.job?.runs?.find((entry) => entry.mode === mode);
  const url = !imported && verification?.targetPresence === 'present' && fragment ? previewUrl(run?.previewUrl) : null;
  if (url) {
    const link = node('a', 'research-target-link', 'Open output target ↗');
    const destination = new URL(url); destination.hash = fragment; link.href = destination.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);
  }
}

function renderRecords(area, entries, type) {
  if (!entries.length) {
    const baselineOnly = state.job?.runs?.every((run) => run.mode === 'baseline');
    const skipped = state.job?.runs?.some(researchWasSkipped);
    emptyLog(area, state.job ? (type === 'evidence' ? skipped ? 'Cultural research was skipped for this decision. No Qloo data supports this output.' : baselineOnly ? 'Qloo is off for this run. No cultural data requests were made.' : 'This run has no cultural evidence yet. Actual Qloo calls will appear here.' : 'This run has no design decisions yet.') : (type === 'evidence' ? 'Cultural connections from actual Qloo responses appear here.' : "The agent’s design rationale appears here after generation."), type === 'evidence' ? '✳' : '↗');
    return;
  }
  const list = node('div', 'record-list');
  entries.forEach(({ record, mode }, index) => {
    const card = node('article', type === 'research' ? 'record-card research-card' : 'record-card');
    const heading = node('div', 'record-card-header');
    const pass = record?.tastePass && typeof record.tastePass === 'object' ? record.tastePass : null;
    const fallbackTitle = type === 'evidence' && record?.tool ? `${record.id || index + 1} · ${record.tool === 'qloo_search_entities' ? 'Reference search' : record.tool === 'qloo_search_tags' ? 'Tag search' : 'Cultural connections'}${pass?.domain ? ` · ${tasteDomainLabels[pass.domain] || pass.domain}${pass.band === 'deep-cut' ? ' · lesser-known' : ''}${pass.seeds === 'entities' ? ' · entity seeds only' : ''}` : ''}${pass ? ' · host taste pass' : ''}` : `${type === 'evidence' ? 'Cultural evidence' : type === 'research' ? 'Research decision' : 'Design decision'} ${index + 1}`;
    const title = typeof record === 'string' ? fallbackTitle : textField(record, ['title', 'name', 'label', 'entity_name', 'entityName', 'decision']) || fallbackTitle;
    heading.append(node('h4', '', title), node('span', `event-mode ${mode}`, runLabel(mode))); card.append(heading);
    if (type === 'decisions' && typeof record?.change === 'string' && record.change) card.append(node('p', 'decision-change', record.change));
    const message = typeof record === 'string' ? record : textField(record, ['summary', 'reason', 'rationale', 'description', 'message', 'explanation']);
    if (message) card.append(node('p', '', message));
    if (type === 'research' && record && typeof record === 'object') {
      appendResearchTrace(card, record, mode);
    }
    if (type === 'decisions' && record && typeof record === 'object') {
      const provenance = node('div', 'provenance');
      provenance.append(node('span', '', record.sourceType === 'qloo' ? 'Qloo evidence + agent interpretation' : record.sourceType === 'product-requirement' ? 'Product requirement' : 'Agent interpretation'));
      if (Array.isArray(record.evidenceIds)) record.evidenceIds.forEach((id) => {
        const button = node('button', 'evidence-reference', id); button.type = 'button'; button.title = 'Inspect evidence record'; button.addEventListener('click', () => { selectTab('evidence'); const matching = [...$('panel-evidence').querySelectorAll('[data-evidence-id]')].find((entry) => entry.dataset.evidenceId === id); if (matching) matching.scrollIntoView({ block: 'nearest' }); }); provenance.append(button);
      });
      card.append(provenance);
    }
    if (type === 'evidence' && record && typeof record === 'object') {
      if (record.id) { card.dataset.evidenceId = record.id; card.dataset.evidenceMode = mode; }
      const queryText = typeof record.query?.text === 'string' ? `Search: ${record.query.text}` : record.query?.resultType ? `Result category: ${String(record.query.resultType).replace(/^urn:entity:/, '')}` : '';
      if (queryText) card.append(node('p', 'query-description', queryText));
      if (Array.isArray(record.results)) {
        const resultList = node('ul', 'entity-list');
        record.results.slice(0, 12).forEach((entity) => {
          if (!entity || typeof entity !== 'object') return;
          const row = node('li', 'entity-item'); const name = node('strong', 'entity-name', entity.name || entity.entityId || 'Qloo record');
          const meta = [entity.type ? String(entity.type).replace(/^urn:entity:/, '') : '', Number.isFinite(entity.affinity) ? `Affinity ${entity.affinity.toLocaleString('en-US', { maximumFractionDigits: 4 })}` : ''].filter(Boolean).join(' · ');
          row.append(name); if (meta) row.append(node('span', 'entity-meta', meta)); resultList.append(row);
        });
        if (resultList.childElementCount) card.append(resultList);
        else card.append(node('p', '', 'This tool call returned no usable results.'));
      }
      if (record.time) card.append(node('p', 'record-time', `Retrieved · ${formatTime(record.time)}`));
    }
    if (record && typeof record === 'object') {
      const details = node('details'); const summary = node('summary', '', 'Record details'); details.append(summary, node('pre', '', stringify(record))); card.append(details);
      const url = textField(record, ['url', 'sourceUrl', 'source_url']);
      if (url) {
        try {
          const parsed = new URL(url);
          if (/^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password) { const link = node('a', '', 'Open source ↗'); link.href = parsed.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
        } catch { /* A source link is optional. */ }
      }
    }
    list.append(card);
  });
  area.replaceChildren(list);
}

function renderCreativePipeline(area, runs) {
  const recorded = runs.filter(run => run.creativePipeline || run.provisionalPlan || run.reconsideration);
  if (!recorded.length) return;
  const section = node('section', 'creative-pipeline');
  section.append(node('h3', '', 'Plan → research → reconsider → build'), node('p', 'workflow-hint', 'Each run starts with its own tentative plan. Both have web research access; Qloo on can discover additional cultural neighbors. Source retrieval and the agent’s interpretation are shown separately.'));
  for (const run of recorded) {
    const card = node('article', 'record-card pipeline-card');
    const heading = node('div', 'record-card-header'); heading.append(node('h4', '', 'Creative checkpoint'), node('span', `event-mode ${run.mode}`, runLabel(run.mode))); card.append(heading);
    const phase = run.creativePipeline;
    if (phase) card.append(node('p', 'query-description', `Phase: ${String(phase.status || 'recorded').replaceAll('-', ' ')} · ${(run.webCalls || []).length} / 6 web calls`));
    if (run.reconsideration?.summary) card.append(node('p', '', run.reconsideration.summary));
    const decisions = run.provisionalPlan?.decisions || [];
    for (const initial of decisions) {
      const final = run.reconsideration?.decisions?.find(decision => decision.decisionId === initial.id);
      const item = node('div', 'pipeline-decision');
      const title = node('div', 'pipeline-decision-heading'); title.append(node('strong', '', initial.decision));
      if (final) title.append(node('span', `reconsideration-outcome ${final.outcome}`, { keep: 'Kept', refine: 'Refined', replace: 'Replaced' }[final.outcome] || final.outcome));
      item.append(title);
      const stages = node('dl', 'research-trace');
      const add = (label, value) => { if (value) { const stage = node('div', 'research-stage'); stage.append(node('dt', '', label), node('dd', '', value)); stages.append(stage); } };
      add('Provisional approach', initial.initialApproach);
      add('Alternatives considered', (initial.alternatives || []).join(' · '));
      add('Research question', (initial.openQuestions || []).join(' '));
      add('Reconsidered approach · agent interpretation', final?.approach);
      add('Why this decision changed or stayed', final?.reason);
      add('Rejected alternatives', final?.rejectedAlternatives?.join(' · '));
      add('Fixed facts', initial.fixedFacts?.join(' '));
      add('Limitations', final?.limitations?.join(' '));
      item.append(stages);
      if (final) {
        const links = node('div', 'provenance');
        for (const id of [...(final.evidenceIds || []), ...(final.webSourceIds || [])]) links.append(evidenceButton(id, run.mode));
        if (links.childElementCount) item.append(links);
      } else item.append(node('p', 'workflow-hint', 'Reconsideration has not been recorded.'));
      card.append(item);
    }
    for (const limitation of phase?.limitations || []) card.append(node('p', 'research-status-note', limitation));
    section.append(card);
  }
  area.append(section);
}

function renderWebSources(area, runs) {
  const recorded = runs.filter(run => run.webCalls?.length || run.webSources?.length);
  if (!recorded.length) return;
  const section = node('section', 'web-research-sources'); section.append(node('h3', '', 'Web reference research'), node('p', 'workflow-hint', 'Captured native tool output. Search excerpts and fetched page content have different scopes; neither proves why a target audience likes a work.'));
  for (const run of recorded) {
    for (const source of run.webSources || []) {
      const card = node('article', 'record-card web-source-card'); card.dataset.evidenceId = source.id; card.dataset.evidenceMode = run.mode;
      const heading = node('div', 'record-card-header'); heading.append(node('h4', '', `${source.id} · ${source.title || 'Web reference'}`), node('span', `event-mode ${run.mode}`, runLabel(run.mode))); card.append(heading);
      card.append(node('p', 'query-description', source.tool === 'web_fetch' ? 'Fetched page content' : 'Search result excerpt'));
      if (source.excerpt) card.append(node('blockquote', 'web-source-excerpt', source.excerpt));
      if (source.limitation || source.truncated) card.append(node('p', 'workflow-hint', [source.limitation, source.truncated ? 'The saved excerpt is truncated.' : ''].filter(Boolean).join(' ')));
      try { const url = new URL(source.url); if (/^https?:$/.test(url.protocol) && !url.username && !url.password) { const link = node('a', 'web-source-link', 'Open reference ↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); } } catch { /* No usable public source link. */ }
      const details = node('details'); details.append(node('summary', '', 'Retrieval record'), node('pre', '', stringify(source))); card.append(details); section.append(card);
    }
    const incomplete = (run.webCalls || []).filter(call => call.status !== 'ok');
    for (const call of incomplete) {
      const card = node('article', 'record-card'); card.append(node('h4', '', `${runLabel(run.mode)} · ${call.tool || 'Web tool'} · ${call.status || 'unknown'}`), node('p', '', call.limitation || 'No attributable source has been recorded for this call.')); section.append(card);
    }
  }
  area.append(section);
}

const tasteDomainLabels = { brand: 'Brands', movie: 'Film', artist: 'Music', book: 'Books', tv_show: 'TV', videogame: 'Games', podcast: 'Podcasts', place: 'Places', destination: 'Destinations', style: 'Style', aesthetic: 'Aesthetic', qualities: 'Qualities' };
// How widely the measured works share a quality, as its chip shows it: "look · 6 works · 3 domains".
const qualitySpread = (entity) => entity.family && Number.isFinite(entity.count) ? [entity.family, `${entity.count} works`, Array.isArray(entity.domains) ? `${entity.domains.length} ${entity.domains.length === 1 ? 'domain' : 'domains'}` : ''].filter(Boolean).join(' · ') : '';

// Type specimens: library families load once from the Studio's copy of the font library, under a prefixed name so a
// specimen never replaces a face the Studio itself uses.
const specimenFonts = { list: null, loading: null, faces: new Map() };
function loadSpecimenFonts() {
  specimenFonts.loading ||= api('/api/fonts').then((list) => {
    specimenFonts.list = new Map((Array.isArray(list) ? list : []).filter((item) => item && typeof item.family === 'string' && Array.isArray(item.files) && item.files.length).map((item) => [item.family.toLowerCase(), item]));
    // A panel drawn before the list arrived is drawn again with its specimens.
    if (specimenFonts.list.size && state.lastTaste) { state.lastTaste = ''; renderTaste(); }
  }).catch(() => { specimenFonts.list = new Map(); });
  return specimenFonts.loading;
}
function fontSpecimen(family) {
  const entry = specimenFonts.list?.get(family.toLowerCase());
  const file = entry?.files.find((face) => face.style === 'normal') || entry?.files[0];
  if (!file || typeof FontFace !== 'function' || !/^fonts\/[a-z0-9-]+\.woff2$/.test(file.path)) return null;
  const name = `Specimen ${entry.family}`;
  if (!specimenFonts.faces.has(name)) {
    const face = new FontFace(name, `url(/library/${file.path})`, { weight: String(file.weight), style: file.style });
    specimenFonts.faces.set(name, face.load().then((loaded) => { document.fonts.add(loaded); return true; }).catch(() => false));
  }
  const sample = node('span', 'dna-specimen', entry.family);
  sample.style.fontFamily = `"${name}", ${/mono/.test(entry.category) ? 'monospace' : /serif/.test(entry.category) && !/sans/.test(entry.category) ? 'serif' : 'sans-serif'}`;
  return sample;
}
const tastePhaseLabels = { 'awaiting-prediction': 'Waiting for the prediction', predicted: 'Prediction frozen', revealed: 'Taste input revealed', read: 'Taste input read', specified: 'Specification saved', planned: 'Production planned', constructing: 'Building to the DNA', reviewed: 'Reviewed its captures', completed: 'Completed', failed: 'Failed', cancelled: 'Stopped' };

function formatScore(value, digits = 2) {
  return Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
}

function tasteRuns(job = state.job) {
  return job?.protocol === 'taste' && Array.isArray(job.runs) ? job.runs.filter((run) => run.taste && typeof run.taste === 'object') : [];
}

function tasteEntityLabel(entity) {
  if (!entity || typeof entity.name !== 'string') return 'Unrecorded reference';
  if (entity.source !== 'qloo') return `${entity.name} · model prediction`;
  const spread = entity.family && Number.isFinite(entity.count) ? `${entity.family} quality of ${entity.count} works` : '';
  return [entity.name, entity.surprise ? 'Qloo, not predicted' : entity.predictedByModel ? 'Qloo, also predicted' : 'Qloo', spread, Number.isFinite(entity.affinity) ? `affinity ${formatScore(entity.affinity)}` : ''].filter(Boolean).join(' · ');
}

function tasteChip(entity, required) {
  const isRequired = required.has(entity.ref);
  const chip = node('li', `taste-chip${entity.surprise ? ' surprise' : ''}${entity.predictedByModel || entity.confirmedBy ? ' matched' : ''}${isRequired ? ' required' : ''}`);
  // Surprises carry a visible mark and spoken text, not color alone.
  if (entity.surprise) { const mark = node('span', 'taste-mark', '✦'); mark.setAttribute('aria-hidden', 'true'); chip.append(mark, node('span', 'sr-only', 'Not predicted: ')); }
  chip.append(document.createTextNode(entity.name));
  const notes = [qualitySpread(entity), entity.predictedByModel ? 'predicted' : entity.confirmedBy ? 'confirmed by Qloo' : entity.knownFromBrief ? 'in the brief' : '', isRequired ? 'required anchor' : ''].filter(Boolean);
  if (notes.length) chip.append(node('small', '', notes.join(' · ')));
  // A quality's own affinity is the mean of the works that carry it; a few of them are named beside it.
  const examples = Array.isArray(entity.examples) ? entity.examples.filter((name) => typeof name === 'string') : [];
  if (Number.isFinite(entity.affinity)) chip.title = `${entity.family ? 'Mean Qloo affinity of the works carrying it' : 'Qloo affinity'} ${formatScore(entity.affinity, 3)}${Number.isFinite(entity.popularity) ? ` · popularity ${formatScore(entity.popularity, 3)}` : ''}${entity.band === 'deep-cut' ? ' · lesser-known band' : ''}${examples.length ? ` · for example ${examples.join(', ')}` : ''}`;
  return chip;
}

function tasteStrip(entities, required) {
  const wrapper = node('div', 'taste-domains');
  for (const domain of [...new Set(entities.map((entity) => entity.domain))]) {
    // Required anchors first, then measured affinity, or for qualities their host score; the strip stays short enough to read at a glance.
    const items = entities.filter((entity) => entity.domain === domain).sort((a, b) => Number(required.has(b.ref)) - Number(required.has(a.ref)) || (b.score ?? b.affinity ?? -1) - (a.score ?? a.affinity ?? -1));
    const row = node('div', 'taste-domain'); const list = node('ul', 'taste-strip');
    for (const entity of items.slice(0, 8)) list.append(tasteChip(entity, required));
    if (items.length > 8) list.append(node('li', 'taste-more', `+${items.length - 8} more`));
    row.append(node('span', 'taste-domain-label', tasteDomainLabels[domain] || domain), list); wrapper.append(row);
  }
  return wrapper;
}

function dnaList(run, templateId) {
  const devices = Array.isArray(run.taste?.dna?.devices) ? run.taste.dna.devices : [];
  if (!devices.length) return null;
  const refs = new Map((run.taste.input?.entities || []).map((entity) => [entity.ref, entity]));
  const checks = new Map((run.taste.conformance?.devices || []).map((device) => [device.id, device]));
  const list = node('ul', 'dna-list');
  for (const device of devices) {
    const anchors = (Array.isArray(device.anchors) ? device.anchors : []).map((ref) => refs.get(ref)).filter(Boolean);
    const surprise = anchors.some((entity) => entity.source === 'qloo' && entity.surprise);
    const item = node('li', `dna-chip${surprise ? ' surprise' : ''}`); const top = node('div', 'dna-chip-top');
    top.append(node('span', 'dna-layer', device.layer || 'device'));
    if (surprise) { const flag = node('span', 'dna-flag', 'Qloo surprise'); flag.title = 'Anchored to a measured entity the model did not predict before seeing the data.'; top.append(flag); }
    const check = checks.get(device.id);
    if (check) top.append(node('span', `dna-check ${check.status}`, { present: 'In the site', partial: 'Partly in the site', missing: 'Missing from the site' }[check.status] || check.status));
    item.append(top, node('strong', '', device.device || device.id));
    const colors = (device.tokens?.colors || []).filter((hex) => typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex));
    if (colors.length) {
      const swatches = node('span', 'dna-swatches'); swatches.setAttribute('aria-hidden', 'true');
      for (const hex of colors) { const swatch = node('span', 'dna-swatch'); swatch.setAttribute('style', `--swatch:${hex}`); swatches.append(swatch); }
      item.append(swatches, node('span', 'dna-tokens', colors.join(' ')));
    }
    const fonts = (device.tokens?.fonts || []).filter((font) => typeof font === 'string');
    if (fonts.length) {
      // Library families are shown in their own face; the plain list beside them stays the readable record.
      const specimens = fonts.map(fontSpecimen).filter(Boolean);
      if (specimens.length) { const line = node('span', 'dna-specimens'); line.setAttribute('aria-hidden', 'true'); line.append(...specimens); item.append(line); }
      item.append(node('span', 'dna-tokens', fonts.join(' · ')));
    }
    const keyframes = (device.tokens?.keyframes || []).filter((name) => typeof name === 'string');
    if (keyframes.length) item.append(node('span', 'dna-tokens', `Keyframes ${keyframes.join(' · ')}`));
    const drawings = (device.tokens?.svg || []).filter((id) => typeof id === 'string');
    if (drawings.length) item.append(node('span', 'dna-tokens', `SVG ${drawings.map((id) => `#${id}`).join(' · ')}`));
    // Library photos the device chose; the IDs beside them are the text alternative, so the thumbnails are decorative.
    const photos = (device.tokens?.images || []).filter((value) => typeof value === 'string' && /^library\/[a-z0-9][a-z0-9-]{0,60}\.jpg$/.test(value));
    if (photos.length) {
      if (templateId) {
        const strip = node('span', 'dna-photos'); strip.setAttribute('aria-hidden', 'true');
        for (const value of photos) {
          const image = node('img');
          image.setAttribute('src', `/library/${encodeURIComponent(templateId)}/${value.slice('library/'.length)}`);
          image.setAttribute('alt', ''); image.setAttribute('width', '64'); image.setAttribute('height', '44'); image.setAttribute('loading', 'lazy');
          strip.append(image);
        }
        item.append(strip);
      }
      item.append(node('span', 'dna-tokens', `Photos ${photos.map((value) => value.slice('library/'.length, -'.jpg'.length)).join(' · ')}`));
    }
    // Qualities of measured anchors are returned tags; those of the model's own predictions are its own words.
    const qualities = (Array.isArray(device.qualities) ? device.qualities : []).filter((quality) => typeof quality === 'string');
    if (qualities.length) item.append(node('p', 'dna-qualities', anchors.some((entity) => entity.source === 'qloo') ? `Translates ${qualities.join(' · ')}` : `Model’s own qualities · ${qualities.join(' · ')}`));
    const novel = device.novel && typeof device.novel === 'object' ? device.novel : null;
    const moved = novel ? [...(novel.fonts || []), ...(novel.colors || []), ...(novel.ids || []).map((id) => `#${id}`)].filter((token) => typeof token === 'string') : [];
    if (moved.length) item.append(node('p', 'dna-novel', `New against the model’s sketch · ${moved.join(' · ')}`));
    item.append(node('p', 'dna-anchors', `Anchored to ${anchors.map(tasteEntityLabel).join('; ') || 'no recorded entity'}`));
    list.append(item);
  }
  return list;
}

// Images the host generated from DNA imagery devices; each shows the prompt the host wrote, so its source can be inspected.
function generatedList(run) {
  const images = (Array.isArray(run.generatedImages) ? run.generatedImages : []).filter((image) => image && typeof image.path === 'string');
  if (!images.length) return null;
  const list = node('ul', 'generated-list');
  for (const image of images) {
    const item = node('li', 'generated-item'); const url = previewUrl(image.url);
    if (url) {
      const picture = node('img');
      picture.setAttribute('src', url); picture.setAttribute('alt', typeof image.subject === 'string' ? image.subject : ''); picture.setAttribute('loading', 'lazy');
      const ratio = Number.isFinite(image.width) && Number.isFinite(image.height) && image.width > 0 ? image.height / image.width : 2 / 3;
      picture.setAttribute('width', '112'); picture.setAttribute('height', String(Math.round(112 * ratio)));
      item.append(picture);
    }
    const body = node('div', 'generated-body');
    body.append(node('strong', '', `${image.path.replace(/^generated\//, '')} · from ${typeof image.device === 'string' ? image.device : 'a device'}`));
    const facts = [image.used === true ? 'In the site' : image.used === false ? 'Not used in the site' : '', Number.isFinite(image.durationMs) ? `${Math.round(image.durationMs / 1000)} s` : '',
      image.provider === 'codex' ? `Codex${typeof image.version === 'string' ? ` ${image.version}` : ''}` : typeof image.provider === 'string' ? image.provider : ''].filter(Boolean);
    if (facts.length) body.append(node('span', 'dna-tokens', facts.join(' · ')));
    if (typeof image.prompt === 'string') {
      const details = node('details', 'generated-prompt');
      details.append(node('summary', '', 'Host prompt'), node('pre', '', image.prompt));
      body.append(details);
    }
    item.append(body); list.append(item);
  }
  return list;
}

// The production stages, as each run recorded them: its own reading of the taste input, its plan for making each
// device, and its review of captures of the saved site.
const textOf = (value) => (typeof value === 'string' ? value : '');
function refNames(run) {
  const refs = new Map((run.taste?.input?.entities || []).map((entity) => [entity.ref, entity]));
  return (ref) => refs.get(ref)?.name || String(ref);
}

function readingBlock(run) {
  const reading = run.production?.reading;
  const clusters = Array.isArray(reading?.clusters) ? reading.clusters.filter((cluster) => cluster && typeof cluster.id === 'string') : [];
  if (!clusters.length) return null;
  const name = refNames(run);
  const block = node('div', 'production-block'); const list = node('ul', 'reading-list');
  for (const cluster of clusters) {
    const item = node('li', `reading-cluster${cluster.surprise ? ' surprise' : ''}`); const top = node('div', 'dna-chip-top');
    top.append(node('span', 'dna-layer', (Array.isArray(cluster.layers) ? cluster.layers : []).join(' · ') || 'cluster'));
    if (cluster.surprise) { const flag = node('span', 'dna-flag', 'Gathers a Qloo surprise'); flag.title = 'One of its refs is a measured entity or quality the model did not predict.'; top.append(flag); }
    item.append(top, node('strong', '', textOf(cluster.name) || cluster.id));
    if (textOf(cluster.reading)) item.append(node('p', 'dna-qualities', cluster.reading));
    item.append(node('p', 'dna-anchors', `Gathers ${(Array.isArray(cluster.refs) ? cluster.refs : []).map(name).join(' · ')}`));
    list.append(item);
  }
  block.append(list);
  const aside = (Array.isArray(reading.setAside) ? reading.setAside : []).filter((item) => item && typeof item.ref === 'string');
  if (aside.length) block.append(node('p', 'taste-sketch-line', `Set aside · ${aside.map((item) => `${name(item.ref)}: ${textOf(item.reason)}`).join(' · ')}`));
  if (textOf(reading.approach)) { const details = node('details', 'generated-prompt'); details.append(node('summary', '', 'How the site carries the clusters'), node('p', 'taste-sketch-line', reading.approach)); block.append(details); }
  return block;
}

function planBlock(run) {
  const plan = run.production?.plan;
  const steps = Array.isArray(plan?.steps) ? plan.steps.filter((step) => step && typeof step.device === 'string') : [];
  if (!steps.length) return null;
  const devices = new Map((run.taste?.dna?.devices || []).map((device) => [device.id, device]));
  const clusters = new Map((run.production.reading?.clusters || []).map((cluster) => [cluster.id, cluster]));
  const block = node('div', 'production-block'); const list = node('ul', 'plan-list');
  for (const step of steps) {
    const item = node('li', 'plan-step'); const top = node('div', 'dna-chip-top');
    top.append(node('span', 'dna-layer', textOf(step.layer) || 'device'), node('span', `plan-method${Number.isInteger(step.count) ? ' generator' : ''}`,
      Number.isInteger(step.count) ? `${step.method} · ${step.count} ${step.count === 1 ? 'picture' : 'pictures'} · fallback ${textOf(step.fallback)}` : textOf(step.method)));
    item.append(top, node('strong', '', textOf(devices.get(step.device)?.device) || step.device));
    const cluster = clusters.get(step.cluster);
    item.append(node('p', 'dna-anchors', [cluster ? `Realizes ${textOf(cluster.name) || cluster.id}` : '', textOf(step.why)].filter(Boolean).join(' · ')));
    list.append(item);
  }
  block.append(list);
  const criteria = (Array.isArray(plan.review) ? plan.review : []).filter((item) => item && typeof item.id === 'string');
  if (criteria.length) block.append(node('p', 'taste-sketch-line', `Review criteria · ${criteria.map((item) => `${item.id}${textOf(item.view) ? ` (${item.view})` : ''} ${textOf(item.look)}`).join(' · ')}`));
  return block;
}

const verdictLabels = { met: 'Met', partly: 'Partly', missed: 'Missed' };
function reviewBlock(run) {
  const production = run.production;
  const captures = (Array.isArray(production?.captures) ? production.captures : []).filter((item) => item && typeof item.id === 'string' && Number.isInteger(item.round));
  const reviews = (Array.isArray(production?.reviews) ? production.reviews : []).filter((item) => item && Number.isInteger(item.round));
  if (!captures.length && !reviews.length) return null;
  const looks = new Map((production.plan?.review || []).map((item) => [item.id, item]));
  const block = node('div', 'production-block');
  for (const round of [...new Set([...captures, ...reviews].map((item) => item.round))].sort((a, b) => a - b)) {
    const section = node('section', 'review-round');
    section.append(node('p', 'review-round-title', `Round ${round}`));
    const shots = node('div', 'review-shots');
    for (const capture of captures.filter((item) => item.round === round)) {
      const figure = node('figure', 'review-shot'); const url = previewUrl(capture.url);
      if (url) {
        // The capture is what the designer judged, so it keeps a description of what it shows; it opens at full size.
        const link = node('a'); link.setAttribute('href', url); link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer');
        const image = node('img'); const width = Number(capture.width) || 1440, height = Number(capture.height) || 900;
        const scale = Math.min(150 / width, 104 / height);
        image.setAttribute('src', url); image.setAttribute('loading', 'lazy');
        image.setAttribute('alt', `Capture ${capture.id}: the ${run.mode === 'qloo' ? 'Qloo on' : 'Qloo off'} site${capture.full ? ' at its full height' : capture.target ? ` scrolled to #${capture.target}` : ''}, ${width} by ${height} pixels`);
        image.setAttribute('width', String(Math.max(1, Math.round(width * scale)))); image.setAttribute('height', String(Math.max(1, Math.round(height * scale))));
        link.append(image); figure.append(link);
      }
      figure.append(node('figcaption', '', capture.id));
      shots.append(figure);
    }
    if (shots.childElementCount) section.append(shots);
    const review = reviews.find((item) => item.round === round);
    if (review) {
      const verdicts = node('ul', 'review-verdicts');
      for (const item of (Array.isArray(review.criteria) ? review.criteria : []).filter((entry) => entry && typeof entry.id === 'string')) {
        const verdict = verdictLabels[item.verdict] ? item.verdict : 'missed';
        const row = node('li', `review-verdict ${verdict}`);
        row.append(node('span', `review-mark ${verdict}`, verdictLabels[verdict]), node('strong', '', `${item.id} on ${textOf(item.capture)}`));
        const look = textOf(looks.get(item.id)?.look);
        if (look) row.append(node('p', 'dna-anchors', `Wanted · ${look}`));
        row.append(node('p', 'dna-qualities', `Saw · ${textOf(item.observed)}`));
        if (textOf(item.repair)) row.append(node('p', 'dna-anchors', `Repair · ${item.repair}`));
        verdicts.append(row);
      }
      section.append(verdicts);
      if (textOf(review.summary)) section.append(node('p', 'taste-sketch-line', review.summary));
      if (review.repairs && typeof review.repairs.site === 'boolean') section.append(node('p', 'taste-sketch-line', review.repairs.site ? 'The site changed before the next capture.' : 'The site did not change before the next capture.'));
    }
    block.append(section);
  }
  const audit = production.audit;
  if (audit && Number.isInteger(audit.rounds)) {
    const opened = Array.isArray(audit.opened) ? audit.opened : [], cited = Array.isArray(audit.cited) ? audit.cited : [], unopened = Array.isArray(audit.unopened) ? audit.unopened : [];
    block.append(node('p', 'taste-sketch-line', audit.audited ? `Host audit · the session’s read tool opened ${opened.length} of the ${cited.length} captures its reviews cite${unopened.length ? `; not opened: ${unopened.join(', ')}` : ''}.`
      : audit.rounds ? 'Host audit · no Kiro session record, so the reviews are recorded as unaudited.' : 'The run saved no review of its captures.'));
    if (typeof audit.afterLastReview?.site === 'boolean') block.append(node('p', 'taste-sketch-line', audit.afterLastReview.site ? 'The site changed after the last review.' : 'The site did not change after the last review.'));
  }
  return block;
}

// What both designers could choose from: the methods the host offered and those it could not, with the reason.
function productionNote(job) {
  const production = job.production;
  if (!production || !Array.isArray(production.methods)) return '';
  const off = production.methods.filter((item) => item && item.available === false);
  const reason = (item) => textOf(item.reason).replace(/[.\s]+$/, '');
  const required = (Array.isArray(production.required) ? production.required : []).filter((id) => typeof id === 'string');
  return [`Both designers chose how to make each device from the same ${production.methods.length - off.length} methods${off.length ? `; ${off.map((item) => `${item.id} is off: ${reason(item)}`).join('; ')}` : ''}.`,
    required.length ? `This study requires ${required.join(' and ')} of both.` : '',
    production.capture?.available ? `Each reviews captures of its saved site in up to ${production.capture.rounds} rounds.` : production.capture?.reason ? `No captures to review: ${reason(production.capture)}.` : ''].filter(Boolean).join(' ');
}

const percentOf = (value) => `${Math.round(value * 100)}%`;

function sketchBlock(taste) {
  const sketch = taste.assumption?.designSketch;
  if (!sketch || typeof sketch !== 'object') return null;
  const block = node('div', 'taste-sketch');
  if (typeof sketch.summary === 'string') block.append(node('p', 'taste-sketch-summary', sketch.summary));
  const colors = (Array.isArray(sketch.palette) ? sketch.palette : []).filter((hex) => typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex));
  if (colors.length) {
    const swatches = node('span', 'dna-swatches'); swatches.setAttribute('aria-hidden', 'true');
    for (const hex of colors) { const swatch = node('span', 'dna-swatch'); swatch.setAttribute('style', `--swatch:${hex}`); swatches.append(swatch); }
    block.append(swatches, node('span', 'dna-tokens', colors.join(' ')));
  }
  const line = (label, values) => { const items = (Array.isArray(values) ? values : []).filter((value) => typeof value === 'string'); if (items.length) block.append(node('p', 'taste-sketch-line', `${label} · ${items.join(' · ')}`)); };
  line('Type', sketch.fonts); line('Sections', (sketch.sections || []).map((id) => `#${id}`)); line('Motifs', sketch.motifs);
  const divergence = taste.sketchDivergence;
  if (divergence && Number.isFinite(divergence.score)) {
    block.append(node('p', 'taste-sketch-divergence', `Saved site against this sketch · ${percentOf(divergence.score)} moved: type ${percentOf(divergence.typography)}, colors ${percentOf(divergence.palette)}, sections ${percentOf(divergence.structure)}`));
    const fonts = divergence.fonts || {};
    const typeLine = [fonts.new?.length ? `New type ${fonts.new.join(', ')}` : '', fonts.kept?.length ? `kept ${fonts.kept.join(', ')}` : ''].filter(Boolean).join(' · ');
    if (typeLine) block.append(node('p', 'taste-sketch-line', typeLine[0].toUpperCase() + typeLine.slice(1)));
  }
  return block;
}

function tasteColumn(run, kind, templateId) {
  const qloo = run.mode === 'qloo'; const taste = run.taste; const input = taste.input;
  const column = node('article', `taste-column ${run.mode}`); const heading = node('div', 'record-card-header');
  heading.append(node('h3', '', qloo ? 'B · Qloo on · measured taste' : 'A · Qloo off · the model’s own prediction'), node('span', `run-status ${run.status || ''}`, tastePhaseLabels[run.tastePipeline?.status] || statusLabels[run.status] || 'Waiting'));
  column.append(heading);
  const required = new Set(Array.isArray(input?.requiredAnchors) ? input.requiredAnchors : []);
  const predicted = (input?.entities || []).filter((entity) => entity.source === 'model-assumption');
  const assumed = predicted.length ? predicted : (taste.assumption?.entries || []).map((entry) => ({ ref: entry.id, name: entry.name, domain: entry.domain, source: 'model-assumption' }));
  column.append(node('h4', '', 'Model assumed · frozen before any data'));
  column.append(assumed.length ? tasteStrip(assumed, required) : node('p', 'workflow-hint', 'The prediction has not been saved yet.'));
  const sketch = sketchBlock(taste);
  if (sketch) column.append(node('h4', '', 'Design the model would make · frozen with it'), sketch);
  if (qloo) {
    const measured = input ? (input.entities || []).filter((entity) => entity.source === 'qloo') : (taste.profile?.entities || []);
    column.append(node('h4', '', 'Qloo measured'));
    if (measured.length) {
      column.append(tasteStrip(measured, required));
      if (!input) column.append(node('p', 'workflow-hint', 'Surprises are marked once the model’s prediction is frozen.'));
    } else column.append(node('p', 'workflow-hint', taste.profile?.status && taste.profile.status !== 'ok' ? `The taste pass ended as ${taste.profile.status}; no measured profile governs this run.` : 'The host taste pass has not finished yet.'));
    const seeds = Array.isArray(taste.profile?.seeds) ? taste.profile.seeds : [];
    if (seeds.length) column.append(node('p', 'taste-seeds', `Seeds · ${seeds.map((seed) => seed.resolution === 'unresolved' ? `${seed.name} (unresolved)` : seed.matchedName && seed.matchedName !== seed.name ? `${seed.name} → ${seed.matchedName}` : seed.name).join(' · ')}`));
  }
  const reading = readingBlock(run);
  if (reading) column.append(node('h4', '', 'Reading · the model’s own judgment of its taste input'), reading);
  const list = dnaList(run, templateId);
  if (list) column.append(node('h4', '', 'Design DNA · binding specification'), list);
  const plan = planBlock(run);
  if (plan) column.append(node('h4', '', 'Production plan · how each device is made'), plan);
  const generated = generatedList(run);
  // A server without an image generator still shows the pictures a run made where one was installed.
  const recorded = Boolean(state.status?.images && !state.status.images.available);
  if (generated) column.append(node('h4', '', `Generated images · prompts written from DNA devices${recorded ? ' · recorded with local image generation' : ''}`), generated);
  const conformance = taste.conformance;
  if (conformance && Number.isFinite(conformance.score)) column.append(node('p', `taste-conformance${conformance.meetsThreshold ? '' : ' below'}`, `DNA conformance ${Math.round(conformance.score * 100)}% · ${conformance.present} present, ${conformance.partial} partial, ${conformance.missing} missing`));
  // What moves and what is drawn, as the host found it in the saved files.
  const motion = conformance?.motion, drawn = Array.isArray(conformance?.illustrations) ? conformance.illustrations.filter((item) => item && typeof item.id === 'string' && Number.isFinite(item.shapes)) : [];
  if (motion && Array.isArray(motion.keyframes)) {
    const facts = [`${motion.keyframes.length} keyframes`, motion.infinite?.length ? `${motion.infinite.length} looping` : '', motion.reducedMotion ? 'reduced-motion fallback' : 'no reduced-motion fallback', motion.infinite?.length ? (motion.pauseControl ? 'pause control' : 'no pause control') : ''].filter(Boolean);
    column.append(node('p', 'taste-sketch-line', `Motion · ${facts.join(' · ')}`));
  }
  if (drawn.length) column.append(node('p', 'taste-sketch-line', `SVG · ${drawn.slice(0, 6).map((item) => `#${item.id} ${item.shapes} shapes`).join(' · ')}`));
  // How much of the starter's narrative the voice device rewrote; the product facts stay as they were.
  const narrative = taste.narrative;
  if (narrative && Number.isFinite(narrative.lines) && narrative.lines > 0 && Number.isFinite(narrative.rewritten)) column.append(node('p', 'taste-sketch-line', `Copy · ${narrative.rewritten} of ${narrative.lines} starter lines rewritten in the DNA's voice`));
  const review = reviewBlock(run);
  if (review) column.append(node('h4', '', 'Self-review · captures the model opened and judged'), review);
  const scores = taste.directionScores;
  if (kind === 'plan' && scores) column.append(node('p', 'taste-conformance', scores.headline || scores.limitation || 'Directions saved.'));
  if (run.error) column.append(node('p', 'research-status-note', run.error));
  return column;
}

function tasteSummary(job, runs) {
  if (job.tasteComparison?.headline) return [job.tasteComparison.headline, [job.tasteComparison.detail, job.tasteComparison.qualityHeadline, job.tasteComparison.sketchHeadline, job.tasteComparison.copyHeadline, job.tasteComparison.productionHeadline].filter(Boolean).join(' ')];
  const qloo = runs.find((run) => run.mode === 'qloo');
  const stats = qloo?.taste?.dna?.stats; const metrics = qloo?.taste?.input?.metrics;
  const detail = metrics ? `The model predicted ${metrics.predictedByModel} of ${metrics.measuredEntities} measured entities before seeing them; ${metrics.surprises} were new to it.${Number.isFinite(metrics.measuredTags) && metrics.measuredTags ? ` Qloo also measured ${metrics.measuredTags} style and aesthetic tags; ${metrics.tagSurprises} were new to it.` : ''}${Number.isFinite(metrics.measuredQualities) && metrics.measuredQualities ? ` The measured works share ${metrics.measuredQualities} ${metrics.measuredQualities === 1 ? 'quality' : 'qualities'}; ${metrics.qualitySurprises} were new to it.` : ''}` : '';
  const qualities = stats && Number.isFinite(stats.qualityAnchoredDevices) && Number.isFinite(metrics?.measuredQualities) && metrics.measuredQualities ? ` ${stats.qualityAnchoredDevices} of ${stats.devices} Qloo on devices translate measured qualities.` : '';
  if (stats) return [`${stats.surpriseAnchoredDevices} of ${stats.devices} design devices in the Qloo on design rest on entities${qualities ? ' or qualities' : ''} the model did not predict.`, `${detail}${qualities}`.trim()];
  if (metrics) return [`${metrics.surprises} of ${metrics.measuredEntities} measured entities were new to the model.`, job.kind === 'plan' ? 'Directions are scored by their measured Qloo support.' : 'The Design DNA has not been saved yet.'];
  if (qloo?.taste?.profile) return [`Qloo measured ${qloo.taste.profile.entities?.length || 0} entities from the brief’s references.`, 'The model must save its own prediction before it can read them.'];
  if (qloo) return ['The host runs one bounded Qloo taste pass before any model run.', 'Neither run can call Qloo or the web itself.'];
  return ['This run has no measured taste data.', 'Its taste input is the model’s own prediction.'];
}

function renderTaste() {
  const job = state.job; const runs = job?.kind === 'prepare' ? [] : tasteRuns(job);
  $('taste-panel').hidden = !runs.length;
  if (!runs.length) { state.lastTaste = ''; return; }
  // Whether this server has an image generator decides how recorded pictures are labelled.
  const imagesOff = Boolean(state.status?.images && !state.status.images.available);
  const signature = JSON.stringify([job.id, job.status, job.kind, job.tasteComparison, job.production, imagesOff, runs.map((run) => [run.mode, run.status, run.error, run.tastePipeline, run.taste, run.generatedImages, run.production])]);
  if (signature === state.lastTaste) return;
  state.lastTaste = signature;
  const [headline, detail] = tasteSummary(job, runs);
  $('taste-headline').textContent = headline; $('taste-detail').textContent = detail; $('taste-detail').hidden = !detail;
  const qloo = runs.find((run) => run.mode === 'qloo');
  $('taste-status').textContent = job.tasteComparison ? 'Compared' : qloo && !qloo.taste.profile && !terminalStatuses.has(job.status) ? 'Taste pass running' : statusLabels[job.status] || job.status || '';
  const metrics = $('taste-metrics'); metrics.replaceChildren();
  const metric = (value, label) => { const item = node('div', 'taste-metric'); item.append(node('strong', '', value), node('span', '', label)); metrics.append(item); };
  const comparison = job.tasteComparison;
  if (comparison?.distance) {
    metric(formatScore(comparison.distance.overall), `Design distance · palette ${formatScore(comparison.distance.palette)}, type ${formatScore(comparison.distance.typography)}, structure ${formatScore(comparison.distance.structure)}, features ${formatScore(comparison.distance.features)}`);
    if (Number.isFinite(comparison.qloo?.surpriseShare)) metric(`${Math.round(comparison.qloo.surpriseShare * 100)}%`, 'of Qloo on design devices rest on unpredicted entities');
    if (Number.isFinite(comparison.qloo?.sketch?.score) && Number.isFinite(comparison.baseline?.sketch?.score)) metric(`${percentOf(comparison.baseline.sketch.score)} · ${percentOf(comparison.qloo.sketch.score)}`, 'moved from the model’s own frozen sketch · Qloo off · Qloo on');
    const prediction = comparison.qloo?.prediction;
    if (prediction?.predictions) metric(`${prediction.predictionsConfirmed} / ${prediction.predictions}`, 'model predictions also measured by Qloo');
    if (Number.isFinite(comparison.qloo?.conformance) || Number.isFinite(comparison.baseline?.conformance)) metric(`${Number.isFinite(comparison.baseline?.conformance) ? Math.round(comparison.baseline.conformance * 100) : '—'}% · ${Number.isFinite(comparison.qloo?.conformance) ? Math.round(comparison.qloo.conformance * 100) : '—'}%`, 'DNA conformance · Qloo off · Qloo on');
  }
  // Each arm's own review of captures of its site: the criteria its last round judged met.
  const made = comparison?.production;
  const reviewed = (side) => (side?.review && Number.isFinite(side.review.met) ? `${side.review.met}/${side.criteria}` : '—');
  if (made && (made.baseline?.review || made.qloo?.review)) metric(`${reviewed(made.baseline)} · ${reviewed(made.qloo)}`, 'own review criteria met at the last self-review · Qloo off · Qloo on');
  metrics.hidden = !metrics.childElementCount;
  $('taste-grid').replaceChildren(...runs.map((run) => tasteColumn(run, job.kind, job.templateId)));
  const production = productionNote(job);
  $('taste-note').textContent = `${runs.length > 1 ? 'Both runs use' : 'This run uses'} the same model, prompt and starter files, with no web tools. Each saves its own taste prediction before seeing any data; only the taste source differs. ✦ marks measured entities the model did not predict.${production ? ` ${production}` : ''}${comparison?.limitation ? ` ${comparison.limitation}` : ''}`;
}

function renderInspection() {
  const runs = Array.isArray(state.job?.runs) ? state.job.runs : [];
  const events = runs.flatMap((run) => (Array.isArray(run.events) ? run.events : []).map((event) => ({ ...event, mode: run.mode })));
  events.sort((a, b) => (new Date(a.time).getTime() || 0) - (new Date(b.time).getTime() || 0));
  const evidence = runs.flatMap((run) => (Array.isArray(run.evidence) ? run.evidence : []).map((record) => ({ record, mode: run.mode })));
  const decisions = runs.flatMap((run) => (Array.isArray(run.decisions) ? run.decisions : []).map((record) => ({ record, mode: run.mode })));
  const research = runs.flatMap((run) => (Array.isArray(run.researchDecisions) ? run.researchDecisions : []).map((record) => ({ record, mode: run.mode })));
  const webSources = runs.flatMap(run => run.webSources || []);
  $('events-count').textContent = String(events.length); $('evidence-count').textContent = String(evidence.length + webSources.length); $('decisions-count').textContent = String(decisions.length + research.length + runs.reduce((count, run) => count + (run.reconsideration?.decisions?.length || 0), 0));
  const signature = JSON.stringify([events, evidence, decisions, research, runs.map(({ creativePipeline, provisionalPlan, reconsideration, webCalls, webSources }) => ({ creativePipeline, provisionalPlan, reconsideration, webCalls, webSources }))]);
  if (signature === state.lastInspection) return;
  state.lastInspection = signature;
  const area = $('panel-events'); const stayAtBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 45;
  if (!events.length) emptyLog(area, state.job ? 'Waiting for agent activity. Only actual steps received from the server are added here.' : 'Follow the agent’s steps here once it starts working.');
  else {
    const list = node('ol', 'event-list');
    events.forEach((event) => {
      const item = node('li', event.type === 'error' ? 'error' : ''); const time = node('time', '', formatTime(event.time));
      if (event.time && !Number.isNaN(new Date(event.time).getTime())) time.dateTime = new Date(event.time).toISOString();
      item.append(time, node('span', `event-mode ${event.mode}`, event.mode === 'qloo' && !researchWasSkipped(runs.find((run) => run.mode === event.mode)) ? '+ Qloo' : 'Model'), node('p', '', typeof event.message === 'string' ? event.message : stringify(event.message || event)));
      list.append(item);
    });
    area.replaceChildren(list);
    if (stayAtBottom) area.scrollTop = area.scrollHeight;
  }
  renderRecords($('panel-evidence'), evidence, 'evidence');
  renderWebSources($('panel-evidence'), runs);
  $('panel-decisions').replaceChildren();
  renderCreativePipeline($('panel-decisions'), runs);
  if (research.length) {
    const section = node('section', 'research-decisions'); section.append(node('h3', '', 'From research to a working experience'));
    section.append(node('p', 'workflow-hint', 'Compare the recorded findings, the agent’s interpretation and the output you can try. Initial approaches are each run’s own plans; record checks do not prove design quality or that Qloo was necessary.'));
    const content = node('div'); renderRecords(content, research, 'research'); section.append(content); $('panel-decisions').append(section);
  }
  const designSection = node('section', 'design-decisions');
  if (research.length) designSection.append(node('h3', '', 'Additional design rationale'));
  const designContent = node('div'); renderRecords(designContent, decisions, 'decisions'); designSection.append(designContent); $('panel-decisions').append(designSection);
}

function renderJob() {
  const job = state.job;
  $('job-status').textContent = job ? statusLabels[job.status] || job.status : 'Start when ready';
  $('job-status').className = `job-status ${job?.status || ''}`;
  $('live-indicator').hidden = !isActive();
  const noSite = ['plan', 'prepare'].includes(job?.kind);
  $('results-toolbar').hidden = noSite; $('comparison-grid').hidden = noSite;
  const recorded = isShowcaseJob(job) && !Number.isNaN(new Date(job.createdAt).getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(new Date(job.createdAt)) : '';
  $('showcase-badge').hidden = !isShowcaseJob(job);
  $('showcase-badge').textContent = `Showcase${recorded ? ` · recorded ${recorded}` : ''}`;
  $('showcase-badge').title = 'The recorded comparison a reviewer sees first. It is read-only: new work from it starts a workspace of its own.';
  modes.forEach(renderRun);
  if (job?.kind === 'plan') state.planJob = job;
  if (job?.kind === 'prepare') state.preparationJob = job;
  $('tab-diff').hidden = job?.kind === 'prepare';
  if (job?.kind === 'prepare' && state.activeTab === 'diff') selectTab('events');
  const diffMode = $('diff-mode').value;
  for (const option of $('diff-mode').options) option.disabled = !job?.runs?.some((run) => run.mode === option.value);
  if (job?.runs?.length && !job.runs.some((run) => run.mode === diffMode)) $('diff-mode').value = job.runs[0].mode;
  renderPreparation(); renderDirections(); renderTaste(); renderRevision(); renderInspector(); renderDiff(); renderVariants();
  renderInspection(); renderControls();
  renderModelLabel();
  if (job?.error) showError(job.error);
}

function updateJobUrl(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('job', id); else url.searchParams.delete('job');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

async function restorePendingJob() {
  const id = state.pendingRestoreId;
  if (!id || state.restoring || !state.status || !state.templates.length) return;
  // The showcased comparison is the one record the server lets a reviewer read without the token.
  const showcased = id === state.showcase?.sites?.id;
  if (state.status.access?.required && !state.token && !showcased) {
    showError('Enter your demo token in Access settings to open this generation record.');
    return;
  }
  state.restoring = true; renderControls();
  try {
    const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
    if (!job || job.id !== id || !Array.isArray(job.runs)) throw new Error('The saved generation could not be read in the expected format.');
    const template = state.templates.find((entry) => entry.id === job.templateId);
    if (!template) throw new Error('The starter template for this generation was not found on the server.');
    selectTemplate(template);
    $('brief').value = job.kind === 'revise' ? job.productBrief || state.workspace?.brief || job.brief || '' : typeof job.brief === 'string' ? job.brief : '';
    if (job.kind === 'revise') $('revision-brief').value = job.revisionRequest || job.brief || '';
    if (job.kind === 'prepare' && job.intendedKind === 'revise') { $('revision-brief').value = job.brief || ''; $('brief').value = job.productBrief || template.defaultBrief || ''; }
    const mode = job.runs.length > 1 ? 'compare' : job.runs[0]?.mode || 'baseline';
    const radio = document.querySelector(`input[name="mode"][value="${mode === 'compare' || modes.includes(mode) ? mode : 'baseline'}"]`);
    if (radio && job.kind !== 'prepare') radio.checked = true;
    // Opened as the page's default, the showcase keeps the plain address, which always opens the current showcase.
    state.modeInitialized = true; state.job = job; state.pendingRestoreId = null; state.lastInspection = ''; updateJobUrl(showcased && !requestedJobId ? null : job.id);
    if (job.baseCultureBrief || job.cultureBrief) applyCultureBrief(job.baseCultureBrief || job.cultureBrief, { source: 'job', templateId: job.templateId });
    $('starter-panel').open = false; showError(''); renderJob(); scheduleJobPoll();
    await hydrateJobContext(job);
  } catch (error) { showError(`Could not load saved generation: ${error.message}`); }
  finally { state.restoring = false; renderControls(); }
}

function scheduleJobPoll(delay = 1500) {
  clearTimeout(state.jobTimer);
  if (!needsJobPoll()) return;
  state.jobTimer = setTimeout(pollJob, delay);
}

async function pollJob() {
  const id = state.job?.id;
  if (!id || !needsJobPoll() || state.polling) return;
  state.polling = true;
  try {
    const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
    if (state.job?.id !== id) return;
    if (!job || typeof job.status !== 'string' || !Array.isArray(job.runs)) throw new Error('The generation record could not be read in the expected format.');
    state.job = job; renderJob();
    if (!needsJobPoll()) await hydrateJobContext(job);
    if (!needsJobPoll()) { clearTimeout(state.jobTimer); if (job.status === 'completed') toast(job.kind === 'prepare' ? preparationResult(job)?.status === 'needs_input' ? 'Creative preparation is waiting for your input.' : 'Creative context is ready.' : job.kind === 'plan' ? 'Design directions are ready.' : 'Generation completed. Inspect the sites and decision records.'); }
    else scheduleJobPoll();
  } catch (error) {
    if (state.job?.id !== id) return;
    showError(`Could not load generation record: ${error.message} The connection will be retried.`);
    scheduleJobPoll(4000);
  } finally {
    state.polling = false;
  }
  await continuePreparedProduction();
}

async function startGeneration(event) {
  event.preventDefault();
  await submitProduction('build');
}

function preparationResult(job = state.preparationJob) {
  return job?.runs?.find((run) => run.mode === 'baseline')?.preparation || null;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function preparationSignature(payload) {
  const revision = (payload.intendedKind || payload.kind) === 'revise';
  return JSON.stringify(canonical({ templateId: payload.templateId, workspaceId: payload.workspaceId || '', brief: payload.brief, cultureBrief: normalizeCultureBrief(payload.baseCultureBrief || payload.cultureBrief || {}), audienceId: payload.audienceId || '', intendedKind: revision ? 'revise' : 'initial', ...(revision ? { parentJobId: payload.parentJobId, parentMode: payload.parentMode, targetSelector: payload.targetSelector } : {}) }));
}

function preparationMatches(job, payload) {
  return Boolean(job?.kind === 'prepare' && job.status === 'completed' && preparationSignature(job) === preparationSignature(payload));
}

function renderPreparation() {
  const job = state.preparationJob;
  $('preparation-panel').hidden = !job;
  if (!job) return;
  const result = preparationResult(job);
  const needsInput = job.status === 'completed' && result?.status === 'needs_input';
  $('preparation-status').textContent = needsInput ? 'Your input needed' : result?.status === 'ready' ? 'Context ready' : job.status === 'running' ? 'Preparing' : statusLabels[job.status] || job.status;
  $('preparation-question-area').hidden = !needsInput;
  const clarificationFinished = (job.preparationRound || 0) >= 1;
  for (const id of ['preparation-answer-label', 'preparation-answer', 'preparation-submit']) $(id).hidden = clarificationFinished;
  $('preparation-response-note').textContent = clarificationFinished ? 'The reference clarification round is complete. Choose an inspiration, let the agent choose, or continue without cultural research.' : 'Suggestions are agent-selected inspiration, not claims about your audience. Only an explicit choice or answer continues preparation.';
  $('preparation-summary').replaceChildren();
  const assessment = result?.assessment;
  if (assessment) {
    const actionLabel = { research: 'Research can inform this decision', reuse: 'Use the existing creative context', clarify: 'Gather a little creative context', skip: 'Continue directly' }[assessment.action] || 'Creative decision assessment';
    $('preparation-summary').append(node('strong', '', actionLabel));
    const reason = Array.isArray(assessment.reasons) ? assessment.reasons.join(' ') : assessment.reason;
    if (reason) $('preparation-summary').append(node('p', '', reason));
  } else $('preparation-summary').append(node('p', '', job.error || job.runs?.find((run) => run.error)?.error || (terminalStatuses.has(job.status) ? 'No completed creative assessment is available.' : 'The agent is assessing the brief. No site files are being changed.')));
  const context = result?.creativeContext;
  if (Array.isArray(context?.references) && context.references.length) {
    const references = node('ul', 'preparation-reference-list');
    for (const reference of context.references) {
      const role = { audience: 'Audience preference', 'creator-inspiration': 'Creative inspiration', brand: 'Brand reference', 'world-canon': 'World reference' }[reference.role] || String(reference.role || 'Creative reference').replaceAll('_', ' ').replaceAll('-', ' ');
      const origin = { 'user-provided': 'user supplied', 'existing-context': 'existing context', 'agent-selected': 'agent selected' }[reference.origin] || reference.origin;
      references.append(node('li', '', `${reference.name || reference.entityId || 'Reference'} · ${role}${origin ? ` · ${origin}` : ''}`));
    }
    $('preparation-summary').append(references);
  }
  $('preparation-question').textContent = result?.question || 'Which cultural references or creative preferences should guide this work?';
  $('preparation-options').replaceChildren();
  for (const option of Array.isArray(result?.options) ? result.options.slice(0, 3) : []) {
    const card = node('article', 'preparation-option');
    card.append(node('h4', '', option.title || 'Creative inspiration'), node('p', '', option.summary || ''));
    if (Array.isArray(option.references) && option.references.length) card.append(node('small', '', option.references.map((reference) => reference.name).filter(Boolean).join(' · ')));
    const choose = node('button', 'subtle-button', 'Use this inspiration'); choose.type = 'button'; choose.addEventListener('click', () => answerPreparation({ type: 'option', optionId: option.id })); card.append(choose); $('preparation-options').append(card);
  }
  $('preparation-next').hidden = result?.status !== 'ready';
  $('preparation-next').textContent = state.pendingProduction ? 'Creative context is ready. Continuing your requested production…' : 'Creative context is ready. Choose Explore design directions or Generate design to continue. Opening this saved record does not start production.';
}

async function requestJob(payload) {
  if (state.submitting || isActive()) return;
  state.submitting = true; showError(''); renderControls();
  try {
    const result = await api('/api/jobs', { method: 'POST', body: JSON.stringify(payload) });
    if (!result.id || typeof result.id !== 'string') throw new Error('The server did not return a generation ID.');
    state.pendingRestoreId = null; updateJobUrl(result.id); state.lastInspection = '';
    const runModes = payload.mode === 'compare' ? modes : [payload.mode];
    state.job = { ...payload, id: result.id, status: 'queued', runs: runModes.map((mode) => ({ mode, status: 'queued', events: [], evidence: [], decisions: [], researchDecisions: [], directions: [], files: [], previewUrl: null, error: null })) };
    state.hydratedJobId = null; state.inspected = null;
    if (payload.kind === 'prepare') { state.preparationJob = state.job; $('preparation-answer').value = ''; }
    $('starter-panel').open = false; renderJob();
    if (payload.kind === 'prepare') $('preparation-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (error) { state.pendingProduction = null; throw error; }
  finally { state.submitting = false; renderControls(); }
  await pollJob();
}

async function requestPreparation(payload, response) {
  const preparation = { templateId: payload.templateId, workspaceId: payload.workspaceId, brief: payload.brief, cultureBrief: payload.baseCultureBrief || payload.cultureBrief, kind: 'prepare', intendedKind: payload.intendedKind || payload.kind || 'build', mode: 'baseline' };
  for (const key of ['audienceId', 'parentJobId', 'parentMode', 'targetSelector']) if (payload[key]) preparation[key] = payload[key];
  if (response) Object.assign(preparation, { preparationJobId: payload.id, preparationResponse: response });
  await requestJob(preparation);
}

async function continuePreparedProduction() {
  const job = state.preparationJob; const pending = state.pendingProduction;
  if (!pending || state.submitting || state.polling || state.restoring || isActive() || state.job?.id !== job?.id) return;
  if (job.status !== 'completed') { if (terminalStatuses.has(job.status)) state.pendingProduction = null; return; }
  if (preparationResult(job)?.status !== 'ready') return;
  state.pendingProduction = null;
  if (!preparationMatches(job, pending)) { showError('The creative context changed. Prepare the current brief before production.'); return; }
  try { await requestJob({ ...pending, cultureBrief: job.baseCultureBrief || job.cultureBrief, preparationJobId: job.id }); }
  catch (error) { showError(error.message); }
}

async function answerPreparation(response) {
  if (isActive() || state.submitting || state.restoring || preparationResult()?.status !== 'needs_input') return;
  const source = state.preparationJob;
  try {
    const current = { ...source, cultureBrief: readCultureBrief(), baseCultureBrief: undefined, templateId: state.selectedTemplate?.id, workspaceId: state.workspace?.id, audienceId: $('production-audience').value || undefined, brief: source.intendedKind === 'revise' ? $('revision-brief').value.trim() || source.brief : $('brief').value.trim() };
    if (!preparationMatches(source, current)) throw new Error('The brief or cultural context changed. Prepare the current brief before answering.');
    await requestPreparation(source, response);
  } catch (error) { showError(error.message); }
}

async function prepareCurrentBrief() {
  if (isActive() || state.submitting || state.restoring || !state.selectedTemplate) return;
  const reason = readiness('baseline'); if (reason) { showError(reason); return; }
  state.pendingProduction = null;
  try {
    state.submitting = true; renderControls(); const workspace = await ensureWorkspace();
    const payload = { templateId: state.selectedTemplate.id, brief: $('brief').value.trim(), mode: 'baseline', kind: 'build', workspaceId: workspace.id, cultureBrief: readCultureBrief(), audienceId: $('production-audience').value || undefined };
    state.submitting = false; await requestPreparation(payload);
  } catch (error) { showError(error.message); }
  finally { state.submitting = false; renderControls(); }
}

async function submitProduction(kind, extra = {}) {
  if (isActive() || state.submitting || state.restoring || !state.selectedTemplate) return;
  const brief = kind === 'revise' ? $('revision-brief').value.trim() : $('brief').value.trim(); const mode = extra.mode || currentMode(); const reason = readiness(mode);
  if (reason) { showError(reason); return; }
  if (!brief) { showError('Write a brief to generate a design.'); $('brief').focus(); return; }
  try {
    state.submitting = true; showError(''); renderControls();
    const workspace = await ensureWorkspace();
    const payload = { templateId: state.selectedTemplate.id, brief, mode, kind, workspaceId: workspace.id, cultureBrief: readCultureBrief(), ...extra };
    const audienceId = $('production-audience').value;
    if (audienceId) payload.audienceId = audienceId;
    if (kind === 'build' && state.selectedDirection) Object.assign(payload, { planJobId: state.selectedDirection.planJobId, planMode: state.selectedDirection.planMode, directionId: state.selectedDirection.directionId });
    if (kind === 'build' && $('study-images').checked && !$('study-images-field').hidden) payload.required = ['generated-image'];
    state.submitting = false;
    if (preparationMatches(state.preparationJob, payload) && preparationResult(state.preparationJob)?.status === 'ready') await requestJob({ ...payload, preparationJobId: state.preparationJob.id });
    else { state.pendingProduction = payload; await requestPreparation(payload); }
  } catch (error) { showError(error.message); }
  finally { state.submitting = false; renderDirections(); renderControls(); }
}

async function cancelGeneration() {
  if (!isActive() || state.cancelling) return;
  const id = state.job.id; state.cancelling = true; renderControls();
  try {
    const job = await api(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    if (state.job?.id === id && job?.id === id && Array.isArray(job.runs)) { state.job = job; renderJob(); }
    toast('Stop requested. The updated agent status will appear when available.');
    await pollJob();
  } catch (error) { showError(error.message); }
  finally { state.cancelling = false; renderControls(); }
}

async function downloadRun(mode, button) {
  if (!state.job || button.disabled) return;
  const id = state.job.id; button.disabled = true;
  try {
    const result = await api(`/api/jobs/${encodeURIComponent(id)}/runs/${encodeURIComponent(mode)}/download`);
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = node('a'); link.href = objectUrl; link.download = `mousa-${state.job.templateId || 'site'}-${mode}.json`; link.hidden = true; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    toast('Generated files downloaded as JSON.');
  } catch (error) { showError(`Could not download files: ${error.message}`); }
  finally { renderRun(mode); }
}

function selectTab(tab, focus = false) {
  if (tab === 'diff' && $('tab-diff').hidden) tab = 'events';
  state.activeTab = tab;
  for (const name of inspectionTabs) {
    const selected = name === tab; const button = $(`tab-${name}`);
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; $(`panel-${name}`).hidden = !selected;
  }
  $('evidence-note').hidden = tab !== 'evidence';
  if (focus) $(`tab-${tab}`).focus();
  if (tab === 'diff') loadRunDiff();
}

$('generation-form').addEventListener('submit', startGeneration);
$('prepare-button').addEventListener('click', prepareCurrentBrief);
$('preparation-submit').addEventListener('click', () => { const text = $('preparation-answer').value.trim(); if (text) answerPreparation({ type: 'references', text }); });
$('preparation-delegate').addEventListener('click', () => answerPreparation({ type: 'delegate' }));
$('preparation-skip').addEventListener('click', () => answerPreparation({ type: 'skip' }));
$('preparation-answer').addEventListener('input', renderControls);
$('cancel-button').addEventListener('click', cancelGeneration);
$('brief').addEventListener('input', renderControls);
document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener('change', () => { state.modeInitialized = true; if (state.selectedDirection && input.value !== state.selectedDirection.planMode) { state.selectedDirection = null; renderDirections(); } showError(''); renderControls(); }));
$('refresh-status').addEventListener('click', async () => { await refreshStatus(true); if (!state.templates.length) await loadTemplates(); await loadWorkspaces(); await restorePendingJob(); if (needsJobPoll()) { clearTimeout(state.jobTimer); await pollJob(); } });
$('starter-frame').addEventListener('load', () => { if ($('starter-frame').hasAttribute('src')) $('starter-empty').hidden = true; });
document.querySelectorAll('[data-download]').forEach((button) => button.addEventListener('click', () => downloadRun(button.dataset.download, button)));
document.querySelectorAll('[data-refresh]').forEach((button) => button.addEventListener('click', () => { const frame = $(`${button.dataset.refresh}-frame`); if (frame.dataset.currentUrl) frame.src = frame.dataset.currentUrl; }));
document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
  button.addEventListener('keydown', (event) => {
    const tabs = inspectionTabs.filter((name) => !$(`tab-${name}`).hidden); const index = tabs.indexOf(button.dataset.tab);
    let next;
    if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
    if (event.key === 'ArrowLeft') next = tabs[(index + tabs.length - 1) % tabs.length];
    if (event.key === 'Home') next = tabs[0];
    if (event.key === 'End') next = tabs.at(-1);
    if (next) { event.preventDefault(); selectTab(next, true); }
  });
});
$('open-settings').addEventListener('click', () => { $('demo-token').value = state.token; $('settings-dialog').showModal(); $('demo-token').focus(); });
$('close-settings').addEventListener('click', () => { $('settings-dialog').close(); $('demo-token').value = ''; });
$('settings-dialog').addEventListener('cancel', () => { $('demo-token').value = ''; });
$('settings-dialog').addEventListener('click', (event) => { if (event.target === $('settings-dialog')) { const rect = $('settings-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { $('settings-dialog').close(); $('demo-token').value = ''; } } });
$('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault(); state.token = $('demo-token').value.trim(); $('demo-token').value = ''; $('settings-dialog').close(); showError(''); renderStatus(); toast(state.token ? 'Access token applied for this page.' : 'Access token cleared.');
  await refreshStatus(); await loadWorkspaces(); await restorePendingJob(); if (needsJobPoll()) { clearTimeout(state.jobTimer); await pollJob(); }
});
$('clear-token').addEventListener('click', async () => { state.token = ''; $('demo-token').value = ''; renderStatus(); toast('Access token cleared from memory.'); await refreshStatus(); });
window.addEventListener('beforeunload', () => { clearTimeout(state.jobTimer); clearTimeout(state.statusTimer); state.token = ''; });

async function updateStatusPeriodically() {
  await refreshStatus();
  state.statusTimer = setTimeout(updateStatusPeriodically, 30000);
}

function validSelector(value) {
  return /^#[A-Za-z_][A-Za-z0-9_-]{0,119}$/.test(value);
}

function completedRun(mode) {
  return state.job?.runs?.find((run) => run.mode === mode && run.status === 'completed' && run.previewUrl);
}

function importedResearchFor(input) {
  if (Object.hasOwn(input, 'importedResearch')) {
    if (!input.importedResearch || typeof input.importedResearch !== 'object' || Array.isArray(input.importedResearch)) throw new Error('Imported research must contain a valid research bundle.');
    return { ...JSON.parse(JSON.stringify(input.importedResearch)), provenance: 'caller-provided-unverified' };
  }
  const hasEvidence = Object.hasOwn(input, 'evidence');
  const hasResearch = Object.hasOwn(input, 'researchDecisions');
  const hasWebSources = Object.hasOwn(input, 'webSources');
  if (!hasEvidence && !hasResearch && !hasWebSources) return null;
  if (hasEvidence && !Array.isArray(input.evidence)) throw new Error('Imported evidence must be an array.');
  if (hasResearch && !Array.isArray(input.researchDecisions)) throw new Error('Imported research decisions must be an array.');
  if (hasWebSources && !Array.isArray(input.webSources)) throw new Error('Imported web sources must be an array.');
  return {
    provenance: 'caller-provided-unverified',
    evidence: JSON.parse(JSON.stringify(input.evidence || [])),
    researchDecisions: JSON.parse(JSON.stringify(input.researchDecisions || [])),
    webSources: JSON.parse(JSON.stringify(input.webSources || [])),
  };
}

function normalizeCultureBrief(input = {}) {
  const brand = input.brand && typeof input.brand === 'object' ? input.brand : {};
  const audiences = Array.isArray(input.audiences) ? input.audiences.slice(0, 3).map((group, index) => ({
    id: typeof group.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(group.id) ? group.id : `audience-${index + 1}`,
    label: String(group.label || '').slice(0, 100),
    references: (Array.isArray(group.references) ? group.references : typeof group.references === 'string' ? group.references.split(/\r?\n/) : []).filter((value) => typeof value === 'string').map((value) => value.trim().slice(0, 180)).filter(Boolean).slice(0, 6),
    ...(typeof group.location === 'string' && group.location.trim() ? { location: group.location.trim().slice(0, 200) } : {}),
  })) : [];
  const protectedFiles = Array.isArray(brand.protectedFiles) ? brand.protectedFiles.filter((value) => typeof value === 'string').slice(0, 12) : ['app.js'];
  const protectedSnippets = Array.isArray(brand.protectedSnippets) ? brand.protectedSnippets.filter((value) => value && typeof value.path === 'string' && typeof value.text === 'string').map(({ path, text }) => ({ path, text })).slice(0, 12) : [];
  const extensions = {};
  if (input.creativeContext && typeof input.creativeContext === 'object' && !Array.isArray(input.creativeContext)) extensions.creativeContext = JSON.parse(JSON.stringify(input.creativeContext));
  if (Array.isArray(input.researchDecisions)) extensions.researchDecisions = JSON.parse(JSON.stringify(input.researchDecisions));
  if (Array.isArray(input.webSources)) extensions.webSources = JSON.parse(JSON.stringify(input.webSources));
  const importedResearch = importedResearchFor(input);
  if (importedResearch) extensions.importedResearch = importedResearch;
  return { brand: { notes: typeof brand.notes === 'string' ? brand.notes.slice(0, 2500) : '', protectedFiles, protectedSnippets }, audiences, ...extensions };
}

function applyCultureBrief(input, { source = 'custom', templateId = state.selectedTemplate?.id || null } = {}) {
  const context = normalizeCultureBrief(input);
  state.contextSource = source;
  state.contextTemplateId = templateId;
  state.defaultContextSnapshot = source === 'starter-default' ? JSON.stringify(context) : null;
  $('context-origin-note').hidden = true;
  $('context-origin-note').textContent = '';
  state.cultureExtensions = { ...(context.creativeContext ? { creativeContext: context.creativeContext } : {}), ...(context.researchDecisions ? { researchDecisions: context.researchDecisions } : {}), ...(context.webSources ? { webSources: context.webSources } : {}), ...(context.importedResearch ? { importedResearch: context.importedResearch } : {}) };
  state.audiences = context.audiences;
  state.protectedExtras = context.brand.protectedFiles.filter((path) => !['index.html', 'styles.css', 'app.js'].includes(path));
  $('brand-notes').value = context.brand.notes;
  $('protected-snippets').value = context.brand.protectedSnippets.length ? JSON.stringify(context.brand.protectedSnippets, null, 2) : '';
  for (const checkbox of document.querySelectorAll('.protected-files input')) checkbox.checked = context.brand.protectedFiles.includes(checkbox.value);
  renderAudienceEditors();
}

function readCultureBrief() {
  let protectedSnippets = [];
  const raw = $('protected-snippets').value.trim();
  if (raw) {
    try { protectedSnippets = JSON.parse(raw); } catch { throw new Error('Protected text snippets must be valid JSON.'); }
    if (!Array.isArray(protectedSnippets) || protectedSnippets.length > 12 || protectedSnippets.some((entry) => !entry || typeof entry.path !== 'string' || typeof entry.text !== 'string' || !entry.path || !entry.text || entry.text.length > 8000)) throw new Error('Protected snippets must contain at most 12 {path, text} entries; each text must be at most 8,000 characters.');
    protectedSnippets = protectedSnippets.map(({ path, text }) => ({ path, text }));
  }
  for (const [index, audience] of state.audiences.entries()) { if (!audience.label.trim()) throw new Error(`Name audience ${index + 1}, or remove the unused audience.`); if (audience.references.length > 6 || audience.references.some((reference) => reference.length > 180)) throw new Error(`Audience ${index + 1} may contain up to 6 references, each at most 180 characters.`); }
  return normalizeCultureBrief({ brand: { notes: $('brand-notes').value, protectedFiles: [...document.querySelectorAll('.protected-files input:checked')].map((input) => input.value).concat(state.protectedExtras || []), protectedSnippets }, audiences: state.audiences, ...state.cultureExtensions });
}

function renderAudienceEditors() {
  $('audience-editors').replaceChildren();
  state.audiences.forEach((group, index) => {
    const editor = node('section', 'audience-editor');
    const heading = node('div', 'audience-editor-heading');
    const title = node('strong', '', `Audience ${index + 1}`); const remove = node('button', 'audience-remove', 'Remove'); remove.type = 'button'; remove.addEventListener('click', () => { state.audiences = state.audiences.filter((item) => item !== group); renderAudienceEditors(); }); heading.append(title, remove); editor.append(heading);
    for (const field of [{ key: 'label', label: 'Audience name', placeholder: 'e.g. independent cinema enthusiasts', max: 100 }, { key: 'references', label: 'Cultural references · one work or person per line', placeholder: 'Films, books, music, places…', max: 3200 }, { key: 'location', label: 'Location · optional', placeholder: 'e.g. London', max: 200 }]) {
      const label = node('label', 'context-label', field.label);
      const input = node(field.key === 'references' ? 'textarea' : 'input'); input.placeholder = field.placeholder; input.maxLength = field.max; input.value = field.key === 'references' ? group.references.join('\n') : group[field.key] || '';
      if (field.key === 'references') input.rows = 3; else { input.type = 'text'; input.autocomplete = 'off'; }
      input.addEventListener('input', () => { group[field.key] = field.key === 'references' ? input.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) : input.value; if (field.key === 'label') renderAudienceChoices(); });
      label.append(input); editor.append(label);
    }
    $('audience-editors').append(editor);
  });
  $('audience-count').textContent = `${state.audiences.length} ${state.audiences.length === 1 ? "audience" : "audiences"}`;
  renderAudienceChoices(); renderControls();
}

function renderAudienceChoices() {
  const selected = $('production-audience').value;
  $('production-audience').replaceChildren();
  const all = node('option', '', 'Entire brief'); all.value = ''; $('production-audience').append(all);
  state.audiences.forEach((group, index) => { const option = node('option', '', group.label || `Audience ${index + 1}`); option.value = group.id; $('production-audience').append(option); });
  if (state.audiences.some((group) => group.id === selected)) $('production-audience').value = selected;
}

function workspacePayload() {
  if (!state.selectedTemplate) throw new Error('Choose a starter template first.');
  return { name: $('workspace-name').value.trim() || `${state.selectedTemplate.name} workspace`, templateId: state.selectedTemplate.id, brief: $('brief').value.trim(), cultureBrief: readCultureBrief(), ...(state.workspace?.version !== undefined ? { version: state.workspace.version } : {}) };
}

function workspaceFeedback(message, error = false) {
  $('workspace-feedback').textContent = message;
  $('workspace-feedback').classList.toggle('error', error);
}

async function loadWorkspaces() {
  if (state.status?.access?.required && !state.token) return;
  try {
    const result = await api('/api/workspaces');
    state.workspaces = Array.isArray(result) ? result : Array.isArray(result.workspaces) ? result.workspaces : [];
    const selected = state.workspace?.id;
    $('workspace-select').replaceChildren();
    const first = node('option', '', 'Open a saved workspace…'); first.value = ''; $('workspace-select').append(first);
    state.workspaces.forEach((workspace) => { if (typeof workspace.id !== 'string') return; const option = node('option', '', workspace.name || workspace.id); option.value = workspace.id; $('workspace-select').append(option); });
    if (selected) $('workspace-select').value = selected;
  } catch (error) { workspaceFeedback(`Could not load workspace list: ${error.message}`, true); }
}

async function ensureWorkspace() {
  const payload = workspacePayload(); state.workspaceBusy = true; renderControls();
  try {
    const result = await api(state.workspace?.id ? `/api/workspaces/${encodeURIComponent(state.workspace.id)}` : '/api/workspaces', { method: state.workspace?.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    const workspace = result.workspace || result;
    if (!workspace.id || typeof workspace.id !== 'string') throw new Error('The server did not return a workspace ID.');
    const loaded = await api(`/api/workspaces/${encodeURIComponent(workspace.id)}`);
    state.workspace = loaded.workspace || loaded; $('workspace-name').value = workspace.name || payload.name;
    if (state.workspace.cultureBrief) applyCultureBrief(state.workspace.cultureBrief, { source: 'workspace' });
    workspaceFeedback('Workspace saved. The cultural brief and product constraints will be used in future generations.');
    await loadWorkspaces(); renderVariants(); return state.workspace;
  } finally { state.workspaceBusy = false; renderControls(); }
}

async function loadWorkspace(id) {
  if (!id || isActive() || state.submitting) return;
  state.pendingRestoreId = null;
  state.workspaceBusy = true; renderControls();
  try {
    const result = await api(`/api/workspaces/${encodeURIComponent(id)}`); const workspace = result.workspace || result;
    const template = state.templates.find((entry) => entry.id === workspace.templateId);
    if (!template) throw new Error('The workspace’s starter template was not found.');
    selectTemplate(template); state.workspace = workspace;
    $('workspace-name').value = workspace.name || ''; $('brief').value = workspace.brief || '';
    applyCultureBrief(workspace.cultureBrief || {}, { source: 'workspace' }); $('workspace-select').value = workspace.id;
    workspaceFeedback('Workspace opened. Continue from a saved variant or start a new generation.'); renderVariants();
  } catch (error) { workspaceFeedback(error.message, true); }
  finally { state.workspaceBusy = false; renderControls(); }
}

function selectedVariant(workspace = state.workspace) {
  return workspace?.selectedVariant || workspace?.selected || workspace?.selection || null;
}

function renderVariants() {
  const variants = Array.isArray(state.workspace?.variants) ? state.workspace.variants : [];
  $('variants-panel').hidden = !variants.length; $('variant-list').replaceChildren();
  const selected = selectedVariant();
  $('variant-selection-state').textContent = selected ? 'Selected version saved' : 'No version selected yet';
  variants.forEach((variant) => {
    if (!variant.jobId || !modes.includes(variant.mode)) return;
    const card = node('article', 'variant-card'); const chosen = selected?.jobId === variant.jobId && selected?.mode === variant.mode; card.classList.toggle('selected', chosen);
    const description = node('div'); description.append(node('strong', '', variant.title || `${labels[variant.mode]} · ${variant.kind === 'revise' ? 'Revision' : 'Generation'}`));
    const audience = state.audiences.find((group) => group.id === variant.audienceId)?.label;
    description.append(node('small', '', [audience, labels[variant.mode], variant.createdAt ? new Date(variant.createdAt).toLocaleDateString('en-US') : ''].filter(Boolean).join(' · ')));
    const actions = node('div', 'variant-actions'); const open = node('button', 'subtle-button', 'Open'); open.type = 'button'; open.disabled = isActive(); open.addEventListener('click', async () => { state.pendingRestoreId = variant.jobId; updateJobUrl(variant.jobId); await restorePendingJob(); });
    const accept = node('button', 'subtle-button', chosen ? 'Selected' : 'Select this variant'); accept.type = 'button'; accept.disabled = chosen || isActive();
    accept.addEventListener('click', async () => { accept.disabled = true; try { const workspaceId = state.workspace.id; await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/select`, { method: 'POST', body: JSON.stringify({ jobId: variant.jobId, mode: variant.mode }) }); const result = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}`); state.workspace = result.workspace || result; renderVariants(); workspaceFeedback('Selected version updated. Previous variants remain in the archive.'); } catch (error) { workspaceFeedback(error.message, true); accept.disabled = false; } });
    actions.append(open, accept); card.append(description, actions); $('variant-list').append(card);
  });
}

async function hydrateJobContext(job) {
  if (!job || state.hydratedJobId === job.id) return;
  // The showcased comparison stays out of its workspace, so new work from it starts a workspace of its own; without the
  // token it is the only record this page may read.
  const readable = !(state.status?.access?.required && !state.token);
  if (job.workspaceId && !isShowcaseJob(job)) {
    try {
      const result = await api(`/api/workspaces/${encodeURIComponent(job.workspaceId)}`);
      if (state.job?.id !== job.id) return;
      state.workspace = result.workspace || result; $('workspace-name').value = state.workspace.name || ''; $('workspace-select').value = state.workspace.id;
      if (job.kind === 'revise') { $('brief').value = job.productBrief || state.workspace.brief || job.brief || ''; $('revision-brief').value = job.revisionRequest || job.brief || ''; }
      if (job.baseCultureBrief || job.cultureBrief) applyCultureBrief(job.baseCultureBrief || job.cultureBrief, { source: 'job', templateId: job.templateId }); else if (state.workspace.cultureBrief) applyCultureBrief(state.workspace.cultureBrief, { source: 'workspace', templateId: state.workspace.templateId });
      renderVariants();
    } catch (error) { workspaceFeedback(`Could not load workspace context: ${error.message}`, true); }
  }
  if (readable && job.planJobId && state.planJob?.id !== job.planJobId) {
    try { const plan = await api(`/api/jobs/${encodeURIComponent(job.planJobId)}`); if (state.job?.id === job.id) state.planJob = plan; } catch { /* The current artifact remains available even if its plan cannot be fetched. */ }
  }
  if (readable && job.preparationJobId && job.kind !== 'prepare' && state.preparationJob?.id !== job.preparationJobId) {
    try { const preparation = await api(`/api/jobs/${encodeURIComponent(job.preparationJobId)}`); if (state.job?.id === job.id && preparation.kind === 'prepare') { state.preparationJob = preparation; renderPreparation(); } } catch { /* A saved site remains available without its preparation record. */ }
  }
  if (state.job?.id === job.id && job.directionId && state.planJob?.id === job.planJobId) {
    const matching = state.planJob.runs?.filter((run) => (!job.planMode || run.mode === job.planMode) && run.directions?.some((direction) => direction.id === job.directionId)) || [];
    if (matching.length === 1) { const run = matching[0]; const direction = run.directions.find((entry) => entry.id === job.directionId); state.selectedDirection = { planJobId: job.planJobId, planMode: run.mode, directionId: direction.id, title: direction.title }; }
    renderDirections();
  }
  if (state.job?.id === job.id) {
    $('production-audience').value = job.audienceId && state.audiences.some((group) => group.id === job.audienceId) ? job.audienceId : '';
    state.hydratedJobId = needsJobPoll() ? null : job.id;
    renderControls();
  }
}

function downloadJson(value, filename) {
  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = node('a'); link.href = objectUrl; link.download = filename; link.hidden = true; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function renderDirections() {
  const plan = state.planJob;
  const entries = (Array.isArray(plan?.runs) ? plan.runs : []).flatMap((run) => (Array.isArray(run.directions) ? run.directions : []).map((direction) => ({ direction, run })));
  $('directions-panel').hidden = state.job?.kind === 'prepare' || (!entries.length && !(plan && ['queued', 'running'].includes(plan.status)));
  $('directions-status').textContent = plan ? statusLabels[plan.status] || plan.status : '';
  $('direction-list').replaceChildren();
  if (!entries.length && plan && !terminalStatuses.has(plan.status)) $('direction-list').append(node('p', 'workflow-hint', 'The agent is preparing the design plan. Directions appear here once saved.'));
  entries.forEach(({ direction, run }, index) => {
    const card = node('article', 'direction-card');
    card.classList.toggle('selected', state.selectedDirection?.planJobId === plan.id && state.selectedDirection?.directionId === direction.id && state.selectedDirection?.planMode === run.mode);
    const heading = node('div', 'record-card-header'); heading.append(node('span', 'direction-index', String(index + 1)), node('span', `event-mode ${run.mode}`, runLabel(run.mode, run))); card.append(heading);
    card.append(node('h3', '', direction.title || 'Design direction'), node('p', '', direction.summary || ''));
    // Taste-led plans: d0 is the model's own default; the host scores every direction by measured Qloo support.
    const scores = run.taste?.directionScores; const score = scores?.scores?.find((entry) => entry.id === direction.id);
    if (direction.basis) card.append(node('p', `direction-basis ${direction.basis}`, direction.basis === 'model-default' ? 'Model default · from its own prediction' : 'From the taste input'));
    if (Number.isFinite(score?.support)) card.append(node('p', `direction-support${scores.recommendedId === direction.id ? ' recommended' : ''}`, `Measured Qloo support ${formatScore(score.support)}${scores.recommendedId === direction.id ? ' · highest of the four' : ''}${score.surpriseAnchors ? ` · ${score.surpriseAnchors} unpredicted anchor${score.surpriseAnchors === 1 ? '' : 's'}` : ''}`));
    const audiences = (Array.isArray(direction.audienceIds) ? direction.audienceIds : []).map((id) => state.audiences.find((group) => group.id === id)?.label || id);
    if (audiences.length) card.append(node('p', 'direction-audiences', audiences.join(' + ')));
    if (Array.isArray(direction.anchors) && direction.anchors.length) {
      const anchors = node('div', 'direction-anchors'); direction.anchors.forEach((anchor) => {
        if (typeof anchor.name === 'string') { anchors.append(node('span', anchor.surprise ? 'surprise' : '', tasteEntityLabel(anchor))); return; }
        const evidence = run.evidence?.find((entry) => entry.id === anchor.evidenceId); const entity = evidence?.results?.find((entry) => entry.entityId === anchor.entityId); anchors.append(node('span', '', `${entity?.name || anchor.entityId || 'Reference'} · ${anchor.evidenceId || 'No evidence specified'}`));
      }); card.append(anchors);
    }
    const details = node('details', 'direction-details'); details.append(node('summary', '', 'Inspect implementation and tradeoffs'));
    for (const device of Array.isArray(direction.devices) ? direction.devices : []) details.append(node('p', '', `${device.layer || 'Device'} · ${device.device || ''}`));
    for (const change of Array.isArray(direction.changes) ? direction.changes : []) details.append(node('p', '', `${change.selector || 'General'} · ${change.change || ''}`));
    for (const tradeoff of Array.isArray(direction.tradeoffs) ? direction.tradeoffs : []) details.append(node('p', 'direction-tradeoff', `Tradeoff: ${tradeoff}`)); card.append(details);
    const choose = node('button', 'subtle-button', card.classList.contains('selected') ? 'Selected direction' : 'Build this direction'); choose.type = 'button'; choose.dataset.directionReady = String(run.status === 'completed' && typeof direction.id === 'string'); choose.disabled = isActive() || state.submitting || state.restoring || state.workspaceBusy || choose.dataset.directionReady !== 'true';
    choose.addEventListener('click', () => {
      state.selectedDirection = { planJobId: plan.id, planMode: run.mode, directionId: direction.id, title: direction.title || direction.id };
      const radio = document.querySelector(`input[name="mode"][value="${run.mode}"]`); if (radio) radio.checked = true;
      if (direction.audienceIds?.length === 1 && state.audiences.some((group) => group.id === direction.audienceIds[0])) $('production-audience').value = direction.audienceIds[0];
      state.modeInitialized = true; renderDirections(); renderControls(); $('start-button').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }); card.append(choose); $('direction-list').append(card);
  });
}

function renderRevision() {
  const completed = (state.job?.runs || []).filter((run) => run.status === 'completed' && run.previewUrl);
  $('revision-panel').hidden = !completed.length; $('inspector-panel').hidden = !completed.length;
  const selected = $('revision-source').value; $('revision-source').replaceChildren();
  completed.forEach((run) => { const option = node('option', '', runLabel(run.mode, run)); option.value = run.mode; $('revision-source').append(option); });
  if (completed.some((run) => run.mode === selected)) $('revision-source').value = selected;
}

function nonce() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function initInspector(mode, fresh = false) {
  const frame = $(`${mode}-frame`);
  if (frame.hidden || !frame.dataset.currentUrl || !frame.contentWindow) return;
  let session = state.inspectorSessions[mode];
  if (fresh || !session || session.url !== frame.dataset.currentUrl) session = state.inspectorSessions[mode] = { nonce: nonce(), url: frame.dataset.currentUrl, ready: false };
  frame.contentWindow.postMessage({ type: 'culture-inspector:init', nonce: session.nonce, enabled: state.inspectorEnabled }, '*');
}

function renderInspector() {
  $('inspect-toggle').setAttribute('aria-pressed', String(state.inspectorEnabled)); $('inspect-toggle').textContent = state.inspectorEnabled ? 'Finish inspection' : 'Select an element in the preview';
  const ready = modes.some((mode) => state.inspectorSessions[mode]?.ready && !$(`${mode}-frame`).hidden);
  $('inspector-status').textContent = state.inspectorEnabled ? ready ? 'Inspection is on. Click an element in the preview to see its actual decision links.' : 'Waiting for the preview inspection connection…' : 'Enable inspection, then click an element in the preview. Site click actions are paused while inspecting.';
  $('inspector-selection').hidden = !state.inspected; $('inspector-selection').replaceChildren(); $('inspector-decisions').replaceChildren();
  if (!state.inspected) return;
  const selected = state.inspected;
  $('inspector-selection').append(node('code', '', selected.selector || 'No stable #id found'), node('span', '', `${labels[selected.mode]} · ${selected.tag}`), node('p', '', selected.text));
  const decisions = state.job?.runs?.find((run) => run.mode === selected.mode)?.decisions || [];
  const matchingSelectors = [selected.selector, ...(selected.ancestors || [])].filter(Boolean);
  const matches = decisions.filter((decision) => Array.isArray(decision.selectors) && decision.selectors.some((selector) => matchingSelectors.includes(selector)));
  if (!matches.length) $('inspector-decisions').append(node('p', 'workflow-hint', selected.selector ? 'No decision is linked to this element. Inspect the general decision records below.' : 'This element has no stable ID. Use an existing #id on the page for a focused revision.'));
  matches.forEach((decision) => { const card = node('div', 'inspector-decision'); card.append(node('strong', '', decision.title || 'Decision'), node('p', '', decision.change || decision.reason || '')); if (!decision.selectors.includes(selected.selector)) card.append(node('small', '', 'Decision linked to the containing section')); if (decision.evidenceIds?.length) card.append(node('small', '', `Evidence · ${decision.evidenceIds.join(', ')}`)); if (Array.isArray(decision.properties) && decision.properties.length) card.append(node('small', '', `Properties · ${decision.properties.join(', ')}`)); $('inspector-decisions').append(card); });
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object' || !['culture-inspector:ready', 'culture-inspector:select'].includes(data.type)) return;
  const mode = modes.find((name) => !$(`${name}-frame`).hidden && event.source === $(`${name}-frame`).contentWindow);
  if (!mode) return;
  if (data.type === 'culture-inspector:ready' && !data.nonce) { initInspector(mode); return; }
  const session = state.inspectorSessions[mode];
  if (!session || data.nonce !== session.nonce) return;
  if (data.type === 'culture-inspector:ready') { session.ready = true; renderInspector(); return; }
  if (!state.inspectorEnabled || (data.selector !== null && (typeof data.selector !== 'string' || !validSelector(data.selector))) || typeof data.tag !== 'string' || typeof data.text !== 'string') return;
  const ancestors = Array.isArray(data.ancestors) ? data.ancestors.slice(0, 8).filter((selector) => typeof selector === 'string' && validSelector(selector)) : [];
  state.inspected = { mode, selector: data.selector, ancestors, tag: data.tag.slice(0, 30), text: data.text.slice(0, 240) };
  $('revision-source').value = mode; $('revision-target').value = data.selector || ''; renderInspector(); renderControls();
});

function renderDiff() {
  const area = $('diff-content'); const mode = $('diff-mode').value;
  const run = state.job?.runs?.find((entry) => entry.mode === mode);
  const diff = run?.diff || state.diffCache.get(`${state.job?.id}:${mode}`);
  if (!diff || !Array.isArray(diff.files)) { emptyLog(area, state.diffLoading ? 'Loading file diffs from the server…' : 'No file diff is available for this generation path yet.', '±'); return; }
  const list = node('div', 'diff-files');
  diff.files.forEach((file) => {
    const details = node('details', 'diff-file'); const summary = node('summary');
    summary.append(node('strong', '', file.path || 'File'), node('span', '', ({ added: 'Added', modified: 'Modified', deleted: 'Deleted' })[file.status] || file.status || 'Diff'));
    details.append(summary); const pre = node('pre', 'diff-lines');
    (Array.isArray(file.lines) ? file.lines : []).forEach((line) => { const type = ['added', 'removed', 'context'].includes(line.type) ? line.type : 'context'; pre.append(node('span', `diff-line ${type}`, `${type === 'added' ? '+' : type === 'removed' ? '−' : ' '} ${String(line.text || '')}`)); });
    details.append(pre); if (file.truncated) details.append(node('p', 'workflow-hint', 'This diff was truncated due to its size. Download the complete file to inspect it.')); list.append(details);
  });
  if (!diff.files.length) emptyLog(area, 'No changed files in the saved diff.', '±'); else area.replaceChildren(list);
}

async function loadRunDiff() {
  const job = state.job; const mode = $('diff-mode').value; const run = job?.runs?.find((entry) => entry.mode === mode);
  if (!job || !run || run.status !== 'completed' || state.diffLoading) { renderDiff(); return; }
  if (run.diff || state.diffCache.has(`${job.id}:${mode}`)) { renderDiff(); return; }
  state.diffLoading = true; renderDiff();
  try { const diff = await api(`/api/jobs/${encodeURIComponent(job.id)}/runs/${mode}/diff`); state.diffCache.set(`${job.id}:${mode}`, diff.diff || diff); }
  catch (error) { if (state.job?.id === job.id) emptyLog($('diff-content'), `Could not load file diff: ${error.message}`, '±'); }
  finally { state.diffLoading = false; if (state.job?.id === job.id && state.diffCache.has(`${job.id}:${mode}`)) renderDiff(); }
}

$('add-audience').addEventListener('click', () => { if (state.audiences.length >= 3) return; let index = 1; while (state.audiences.some((group) => group.id === `audience-${index}`)) index++; state.audiences.push({ id: `audience-${index}`, label: '', references: [], location: '' }); renderAudienceEditors(); });
$('save-workspace').addEventListener('click', async () => { try { await ensureWorkspace(); } catch (error) { workspaceFeedback(error.message, true); } });
$('workspace-select').addEventListener('change', () => loadWorkspace($('workspace-select').value));
$('new-workspace').addEventListener('click', () => { if (isActive()) return; state.workspace = null; state.job = null; state.planJob = null; state.selectedDirection = null; state.preparationJob = null; state.pendingProduction = null; state.inspected = null; state.lastInspection = ''; state.hydratedJobId = null; state.pendingRestoreId = null; updateJobUrl(null); $('workspace-name').value = ''; $('workspace-select').value = ''; applyCultureBrief(state.selectedTemplate?.defaultCultureBrief || {}, { source: 'starter-default' }); if (state.selectedTemplate) $('brief').value = state.selectedTemplate.defaultBrief || ''; renderVariants(); renderJob(); workspaceFeedback('New workspace ready. It will be created when you first save or generate.'); });
$('export-workspace').addEventListener('click', async () => { if (!state.workspace?.id) return; try { const workspace = await ensureWorkspace(); const exported = await api(`/api/workspaces/${encodeURIComponent(workspace.id)}/export`); downloadJson(exported, 'culture-brief.json'); workspaceFeedback('The version’s cultural brief and current workspace draft were exported. Access tokens are excluded.'); } catch (error) { workspaceFeedback(error.message, true); } });
$('import-workspace').addEventListener('click', () => $('workspace-import-file').click());
$('workspace-import-file').addEventListener('change', async () => {
  const file = $('workspace-import-file').files?.[0]; if (!file) return;
  try {
    if (file.size > 200000) throw new Error('The brief file exceeds the 200 KB limit.');
    const imported = JSON.parse(await file.text()); const source = imported.workspaceDraft || imported.context || imported.workspace || imported;
    if (!source || typeof source !== 'object') throw new Error('The brief JSON format could not be read.');
    const contextSource = source.cultureBrief || imported.cultureBrief || (Array.isArray(source.audiences) ? source : null);
    if (!contextSource) throw new Error('No cultureBrief or audiences entry was found in the file.');
    const context = { ...contextSource };
    if (!['evidence', 'researchDecisions', 'webSources', 'importedResearch'].some((key) => Object.hasOwn(context, key)) && Object.hasOwn(imported, 'importedResearch')) context.importedResearch = imported.importedResearch;
    const templateId = source.templateId || source.product?.templateId;
    if (templateId) { const template = state.templates.find((entry) => entry.id === templateId); if (!template) throw new Error('The file’s starter template is not available on this server.'); selectTemplate(template); }
    state.workspace = null; state.job = null; state.planJob = null; state.selectedDirection = null; state.preparationJob = null; state.pendingProduction = null; state.inspected = null; state.lastInspection = ''; state.hydratedJobId = null; state.pendingRestoreId = null; updateJobUrl(null); $('workspace-select').value = '';
    const importedName = source.name || source.product?.name; const importedBrief = source.brief || source.product?.brief;
    if (typeof importedName === 'string') $('workspace-name').value = importedName.slice(0, 100);
    if (typeof importedBrief === 'string') $('brief').value = importedBrief.slice(0, 3500);
    applyCultureBrief(context, { source: 'imported' }); renderVariants(); renderJob(); workspaceFeedback(`${imported.workspaceDraft ? 'Current workspace draft' : 'Brief context'} imported. Save to create a new workspace; imported evidence is not treated as newly verified tool output.`);
  } catch (error) { workspaceFeedback(`Import failed: ${error.message}`, true); }
  finally { $('workspace-import-file').value = ''; }
});
$('plan-button').addEventListener('click', () => { state.selectedDirection = null; renderDirections(); submitProduction('plan'); });
$('clear-direction').addEventListener('click', () => { state.selectedDirection = null; renderDirections(); renderControls(); });
$('revise-button').addEventListener('click', () => { const mode = $('revision-source').value; const targetSelector = $('revision-target').value.trim(); if (!completedRun(mode) || !validSelector(targetSelector)) { showError('A focused revision requires a completed preview and an existing #id.'); return; } submitProduction('revise', { mode, parentJobId: state.job.id, parentMode: mode, targetSelector }); });
for (const id of ['revision-source', 'revision-target', 'revision-brief']) $(id).addEventListener(id === 'revision-source' ? 'change' : 'input', renderControls);
$('inspect-toggle').addEventListener('click', () => { state.inspectorEnabled = !state.inspectorEnabled; modes.forEach((mode) => initInspector(mode)); renderInspector(); });
modes.forEach((mode) => $(`${mode}-frame`).addEventListener('load', () => { initInspector(mode, true); renderInspector(); }));
$('diff-mode').addEventListener('change', loadRunDiff);
applyCultureBrief({}, { source: 'starter-default' });

Promise.allSettled([updateStatusPeriodically(), loadTemplates(), loadSpecimenFonts(), showcaseRequest.then((showcase) => { state.showcase = showcase; })]).then(async () => {
  // Without a link to other work, the page opens on the showcased comparison.
  if (!requestedJobId && !state.pendingRestoreId && !state.job && state.showcase?.sites) state.pendingRestoreId = state.showcase.sites.id;
  await loadWorkspaces(); await restorePendingJob();
});
