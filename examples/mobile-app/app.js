// Renders Ramble's walks from data/walks.json into its four screens: the list with its filters, the chosen walk and
// the walk in progress. The facts live in the data file, the interface copy in index.html and every value in the tokens.
const state = { walks: [], filter: 'all', selected: null, stop: 0 };
const $ = id => document.getElementById(id);
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const FILTERS = { all: () => true, short: walk => walk.minutes < 60, 'step-free': walk => walk.stepFree };
const meta = walk => `${walk.distanceKm} km · ${walk.minutes} min · ${walk.stops.length} stops`;

function renderList() {
  const shown = state.walks.filter(FILTERS[state.filter]);
  $('walk-count').textContent = `${shown.length} of ${state.walks.length}`;
  const list = $('walk-list');
  list.replaceChildren();
  for (const walk of shown) {
    const card = make('button', 'walk-card');
    card.type = 'button';
    card.dataset.walk = walk.id;
    card.append(make('span', 'walk-name', walk.name), make('span', 'walk-meta', `${walk.district} · ${meta(walk)}`));
    if (walk.stepFree) card.append(make('span', 'badge', 'Step-free'));
    card.addEventListener('click', () => { state.selected = walk; renderDetail(); location.hash = 'screen-detail'; });
    const item = make('li');
    item.append(card);
    list.append(item);
  }
  for (const chip of document.querySelectorAll('.chip')) chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.filter));
}

function renderDetail() {
  const walk = state.selected;
  $('detail-title').textContent = walk.name;
  $('detail-district').textContent = `${walk.district} · starts at ${walk.start}`;
  $('detail-summary').textContent = walk.summary;
  const stats = $('detail-stats');
  stats.replaceChildren();
  for (const [label, value] of [['Distance', `${walk.distanceKm} km`], ['Time', `${walk.minutes} min`], ['Access', walk.stepFree ? 'Step-free' : 'Has steps']]) {
    const item = make('div');
    item.append(make('dt', '', label), make('dd', '', value));
    stats.append(item);
  }
  const stops = $('detail-stops');
  stops.replaceChildren(...walk.stops.map(stop => make('li', '', stop.name)));
  renderWalk();
}

function renderWalk() {
  const walk = state.selected, stop = walk.stops[state.stop];
  $('walk-title').textContent = walk.name;
  $('walk-progress').textContent = `Stop ${state.stop + 1} of ${walk.stops.length}`;
  $('walk-route').replaceChildren(...walk.stops.map((item, index) => {
    const dot = make('li');
    dot.dataset.state = index < state.stop ? 'done' : index === state.stop ? 'current' : 'next';
    dot.setAttribute('aria-label', `${item.name}${index === state.stop ? ', current stop' : ''}`);
    return dot;
  }));
  $('stop-name').textContent = stop.name;
  $('stop-note').textContent = stop.note;
  $('next-stop').textContent = state.stop === walk.stops.length - 1 ? 'Finish walk' : 'Next stop';
}

function start(data) {
  state.walks = data.walks;
  state.selected = data.walks[0];
  const times = data.walks.map(walk => walk.minutes);
  $('benefit-routes').textContent = `${data.walks.length} routes of ${Math.min(...times)} to ${Math.max(...times)} minutes`;
  for (const chip of document.querySelectorAll('.chip')) chip.addEventListener('click', () => { state.filter = chip.dataset.filter; renderList(); });
  $('start-walk').addEventListener('click', () => { state.stop = 0; renderWalk(); });
  $('next-stop').addEventListener('click', () => {
    if (state.stop < state.selected.stops.length - 1) { state.stop += 1; renderWalk(); } else { state.stop = 0; renderWalk(); location.hash = 'screen-walks'; }
  });
  renderList();
  renderDetail();
}

fetch('data/walks.json')
  .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
  .then(start)
  .catch(() => { $('walk-count').textContent = 'The walks could not be loaded. Open the app through a local server.'; });
