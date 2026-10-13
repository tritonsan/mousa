const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

const starterStyles = `
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202320;background:#fff;font-synthesis:none;line-height:1.55}
*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button,a,input,select{touch-action:manipulation}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}a{color:inherit}header,main,footer{width:min(1100px,calc(100% - 40px));margin:auto}header{padding:22px 0;display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #ddd}header a{text-decoration:none;font-weight:700}nav{display:flex;gap:18px}main{padding:40px 0}h1{font-size:clamp(2rem,5vw,3rem);line-height:1.15;margin:12px 0 18px;letter-spacing:-.04em}h2{font-size:1.3rem;line-height:1.3}p{max-width:75ch}button{border:1px solid #242824;background:#242824;color:#fff;padding:10px 16px;border-radius:4px}button.secondary{background:#fff;color:#242824}button:hover{filter:brightness(.9)}:focus-visible{outline:3px solid #65835d;outline-offset:3px}.eyebrow{font-size:.8rem;text-transform:uppercase;letter-spacing:.12em;color:#5c625c}.intro{max-width:790px}.notice{font-size:.875rem;color:#555;border:1px solid #ddd;background:#f7f7f6;padding:12px 16px;margin:24px 0 30px}.controls{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;margin:24px 0 16px}label{display:grid;gap:6px;font-size:.9rem}input,select{width:100%;padding:11px;border:1px solid #aaa;border-radius:4px;background:#fff;color:#202320}.result-count{font-size:.85rem;color:#555}.catalog{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:18px 0 40px}.card{border:1px solid #d7dad5;border-radius:4px;padding:22px;display:flex;flex-direction:column;gap:10px}.card h3{font-size:1.12rem;line-height:1.35;margin:0}.card p{font-size:.9rem;margin:0;color:#555}.card .category{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#626962}.card .meta{font-size:.82rem}.card .price{font-weight:650;margin-top:auto;padding-top:14px}.card button{margin-top:8px}.empty{padding:30px;border:1px dashed #aaa;grid-column:1/-1}.selection{border-top:1px solid #ddd;padding-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:40px}.selection h2{margin-top:0}.selected-items{list-style:none;margin:0;padding:0}.selected-items li{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 0;border-bottom:1px solid #e2e2df}.selected-items button{padding:5px 10px;font-size:.8rem}.selection-total{font-weight:600}.request-form{display:grid;gap:14px}.request-form p{margin:0;color:#555;font-size:.875rem}.request-form button{justify-self:start}.form-message{min-height:24px;margin:12px 0;color:#3d5934}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}footer{border-top:1px solid #ddd;padding:22px 0 32px;font-size:.82rem;color:#555}.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:12px 18px;border:1px solid #aaa;background:#fff;box-shadow:0 3px 18px #0002;border-radius:4px;z-index:10;max-width:calc(100% - 32px)}.toast:empty{display:none}@media(max-width:720px){.catalog{grid-template-columns:repeat(2,minmax(0,1fr))}.controls{grid-template-columns:1fr 1fr}.controls label:first-child{grid-column:1/-1}.selection{grid-template-columns:1fr;gap:24px}header{align-items:center}nav{gap:12px;font-size:.85rem}}@media(max-width:440px){.catalog{grid-template-columns:1fr}header,main,footer{width:calc(100% - 32px)}main{padding-top:28px}.controls{grid-template-columns:1fr}.controls label:first-child{grid-column:auto}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

const starterScript = `
'use strict';
const config = JSON.parse(document.getElementById('site-data').textContent);
const selected = new Set();
const byId = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat('en-US', {style:'currency',currency:'TRY',maximumFractionDigits:0}).format(value);
function element(tag, className, text) { const node = document.createElement(tag); if(className) node.className = className; if(text !== undefined) node.textContent = text; return node; }
const categories = [...new Set(config.items.map((item) => item.category))];
categories.forEach((category) => { const option = element('option', '', category); option.value = category; byId('category').append(option); });
function toast(message) { byId('toast').textContent = message; clearTimeout(toast.timer); toast.timer = setTimeout(() => { byId('toast').textContent = ''; }, 2800); }
function renderCatalog() {
  const query = byId('search').value.toLocaleLowerCase('en-US').trim();
  const category = byId('category').value;
  const filtered = config.items.filter((item) => (!category || item.category === category) && [item.name,item.description,item.category].join(' ').toLocaleLowerCase('en-US').includes(query));
  const sort = byId('sort').value;
  if(sort === 'name') filtered.sort((a,b) => a.name.localeCompare(b.name,'en-US'));
  if(sort === 'price') filtered.sort((a,b) => a.price-b.price);
  byId('catalog').replaceChildren();
  byId('result-count').textContent = filtered.length + ' / ' + config.items.length + ' options';
  if(!filtered.length) byId('catalog').append(element('p','empty','No options match your search. Try adjusting the filters.'));
  filtered.forEach((item) => {
    const card = element('article','card');
    card.append(element('span','category',item.category),element('h3','',item.name),element('p','',item.description),element('p','meta',item.meta),element('p','price',item.price === null ? item.priceLabel : money(item.price) + (config.priceSuffix || '')));
    const button = element('button','',selected.has(item.id) ? 'Selected · remove' : config.addLabel);
    button.type = 'button'; button.setAttribute('aria-pressed',String(selected.has(item.id))); button.addEventListener('click',() => { if(selected.has(item.id)){ selected.delete(item.id); toast('Removed from your selection.'); }else{ selected.add(item.id); toast(config.addMessage); } renderCatalog(); renderSelection(); });
    card.append(button); byId('catalog').append(card);
  });
}
function renderSelection() {
  byId('selected-items').replaceChildren();
  const items = config.items.filter((item) => selected.has(item.id));
  byId('selection-count').textContent = String(items.length);
  if(!items.length) byId('selected-items').append(element('li','','You have not selected anything yet.'));
  items.forEach((item) => { const row = element('li'); row.append(element('span','',item.name)); const remove = element('button','secondary','Remove'); remove.type = 'button'; remove.setAttribute('aria-label','Remove ' + item.name + ' from your selection'); remove.addEventListener('click',() => { selected.delete(item.id); renderCatalog(); renderSelection(); }); row.append(remove); byId('selected-items').append(row); });
  const priced = items.every((item) => Number.isFinite(item.price));
  byId('selection-total').textContent = items.length ? (priced ? 'Sample total: ' + money(items.reduce((sum,item) => sum + item.price,0)) + (config.priceSuffix || '') : items.length + ' options added to your list.') : '';
}
byId('search').addEventListener('input',renderCatalog);
byId('category').addEventListener('change',renderCatalog);
byId('sort').addEventListener('change',renderCatalog);
byId('request-form').addEventListener('submit',(event) => { event.preventDefault(); if(!selected.size){ byId('form-message').textContent = 'Select at least one option to continue.'; byId('catalog').scrollIntoView({block:'start',behavior:'smooth'}); return; } byId('form-message').textContent = config.formSuccess; byId('request-form').reset(); });
renderCatalog(); renderSelection();
`;

function buildFiles(data) {
  const safeData = JSON.stringify(data).replace(/</g, '\\u003c');
  return {
    'index.html': `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(data.description)}"><title>${escapeHtml(data.brand)} · Starter site</title><link rel="stylesheet" href="styles.css"><script defer src="app.js"></script></head>
<body><header><a href="#" aria-label="${escapeHtml(data.brand)} home">${escapeHtml(data.brand)}</a><nav aria-label="Main navigation"><a href="#catalog-section">${escapeHtml(data.catalogLabel)}</a><a href="#selection-section">My selections (<span id="selection-count">0</span>)</a></nav></header>
<main><section class="intro"><span class="eyebrow">${escapeHtml(data.category)}</span><h1>${escapeHtml(data.headline)}</h1><p>${escapeHtml(data.description)}</p><a href="#catalog-section">${escapeHtml(data.catalogLink)} →</a></section>
<p class="notice">Starter template · All brand, product, price and schedule information is sample data. This page has not yet been generated with Qloo. Selections stay on this page; no real orders, payments or reservations are made.</p>
<section id="catalog-section" aria-labelledby="catalog-heading"><h2 id="catalog-heading">${escapeHtml(data.catalogLabel)}</h2><div class="controls"><label>Search<input id="search" type="search" placeholder="${escapeHtml(data.searchPlaceholder)}" autocomplete="off"></label><label>Category<select id="category"><option value="">All options</option></select></label><label>Sort by<select id="sort"><option value="default">Catalog order</option><option value="name">Name</option>${data.items.some((item) => item.price !== null) ? '<option value="price">Price: low to high</option>' : ''}</select></label></div><p id="result-count" class="result-count" role="status"></p><div id="catalog" class="catalog"></div></section>
<section id="selection-section" class="selection" aria-labelledby="selection-heading"><div><h2 id="selection-heading">${escapeHtml(data.selectionTitle)}</h2><ul id="selected-items" class="selected-items"></ul><p id="selection-total" class="selection-total"></p></div><form id="request-form" class="request-form"><h2>${escapeHtml(data.formTitle)}</h2><p>${escapeHtml(data.formDescription)}</p><label>Your name<input name="name" autocomplete="given-name" maxlength="80" required></label><label>Email<input name="email" type="email" autocomplete="email" maxlength="180" required></label><button type="submit">${escapeHtml(data.formButton)}</button><p id="form-message" class="form-message" role="status"></p></form></section></main>
<footer>${escapeHtml(data.brand)} · Sample starter site. Form submissions are not sent to a server and disappear on refresh.</footer><div id="toast" class="toast" role="status" aria-live="polite"></div><script type="application/json" id="site-data">${safeData}</script></body></html>`,
    'styles.css': starterStyles,
    'app.js': starterScript,
  };
}

const definitions = [
  {
    id: 'local-food', name: 'Local food', category: 'Food & retail', description: 'Product catalog, category filters and a sample order list.',
    defaultBrief: 'Gather is a sample brand bringing together food from small producers. My audience enjoys independent cinema, hiking and cooking with friends at home. Design an original, easy-to-use store for this audience while preserving the product information and shopping interactions. Prioritize mobile use. Draw on cultural references without copying them directly, and explain your design decisions. Write all site content, interface labels and design explanations in English.',
    content: { brand: 'Gather', category: 'Local food', headline: 'Choose for the table. Share together.', description: 'Explore a small food catalog, find the products you need and build your own order list.', catalogLabel: 'Products', catalogLink: 'Browse products', searchPlaceholder: 'Search products or ingredients', addLabel: 'Add to list', addMessage: 'Product added to your sample order list.', selectionTitle: 'Your order list', formTitle: 'Complete your list', formDescription: 'This form is a local shopping demo. No order is placed and no email is sent.', formButton: 'Complete sample order', formSuccess: 'Sample order step complete. No real order was placed and your details were not saved.', items: [
      { id: 'olive-oil', name: 'Virgin olive oil', category: 'Table essentials', description: 'A sample product for everyday cooking and cold dishes.', meta: '500 ml · Glass bottle', price: 420 },
      { id: 'tomato', name: 'Sun-dried tomatoes', category: 'Table essentials', description: 'For salads and breakfast plates.', meta: '200 g · Jar', price: 160 },
      { id: 'tahini', name: 'Tahini', category: 'Breakfast', description: 'A simple option for sweet and savory recipes.', meta: '300 g · Jar', price: 180 },
      { id: 'jam', name: 'Fig jam', category: 'Breakfast', description: 'For breakfast and small dessert plates.', meta: '250 g · Jar', price: 150 },
      { id: 'pasta', name: 'Handmade noodles', category: 'Pantry', description: 'A practical pantry staple for weeknight dinners.', meta: '400 g · Pack', price: 190 },
      { id: 'lentil', name: 'Green lentils', category: 'Pantry', description: 'For soups, salads and one-pot meals.', meta: '500 g · Pack', price: 110 },
    ] },
  },
  {
    id: 'indie-game', name: 'Indie game', category: 'Games & launches', description: 'Game features, experience filters and a local wishlist.',
    defaultBrief: 'Echo Atlas is a fictional exploration game in which players collect the sounds of an abandoned city and bring its spaces back to life. My audience loves Outer Wilds, Studio Ghibli films and ambient music. Design a launch site that preserves the identity of the game and brings discovery into the web experience. Keep the existing game features; do not invent awards, reviews or sales figures. Preserve the local wishlist flow. Write all site content, interface labels and design explanations in English.',
    content: { brand: 'Echo Atlas', category: 'Independent exploration game', headline: 'Find the lost sounds of a city.', description: 'Echo Atlas is a fictional exploration game in which listening to your surroundings opens new paths. Explore its core mechanics and save the experiences that interest you.', catalogLabel: 'Explore the game', catalogLink: 'Discover experiences', searchPlaceholder: 'Search mechanics or experiences', addLabel: 'Add to my wishlist', addMessage: 'Experience added to your local wishlist.', selectionTitle: 'Your exploration list', formTitle: 'Save your interest', formDescription: 'A local wishlist demo for a fictional game. No game platform or mailing list registration is created.', formButton: 'Complete sample wishlist', formSuccess: 'Local wishlist step complete. No real game registration or email subscription was created.', items: [
      { id: 'listen', name: 'Listen to the city', category: 'Exploration', description: 'Follow traces of sound to discover new routes.', meta: 'Single player · Sound-led exploration', price: null, priceLabel: 'Core mechanic' },
      { id: 'map', name: 'Draw your own atlas', category: 'Exploration', description: 'Place the sounds you find on your map and connect them.', meta: 'Mapping · Open routes', price: null, priceLabel: 'Core mechanic' },
      { id: 'restore', name: 'Bring spaces to life', category: 'Puzzles', description: 'Combine fragments of sound to unlock closed spaces.', meta: 'Environmental puzzles', price: null, priceLabel: 'Core mechanic' },
      { id: 'echo', name: 'Echo chamber', category: 'Puzzles', description: 'A sample game area combining rhythm and navigation.', meta: 'Fictional level · Puzzles', price: null, priceLabel: 'Sample level' },
      { id: 'rooftop', name: 'Rooftop walk', category: 'Atmosphere', description: 'See the city from above and explore your chosen route at your own pace.', meta: 'Fictional level · Free exploration', price: null, priceLabel: 'Sample level' },
      { id: 'archive', name: 'Sound archive', category: 'Atmosphere', description: 'Organize your recordings and piece together the story of the city.', meta: 'Collection · Story', price: null, priceLabel: 'Core mechanic' },
    ] },
  },
  {
    id: 'boutique-hotel', name: 'Boutique hotel', category: 'Hospitality', description: 'Room discovery, filters and a sample booking request.',
    defaultBrief: 'Stillwater is a fictional boutique hotel in a small coastal town. My audience is interested in architecture, photography, slow travel and jazz. Design a trustworthy, culturally distinctive hospitality site while preserving the existing room information and booking request flow. Do not claim real availability, star ratings or reviews. Prioritize accessibility and mobile readability. Write all site content, interface labels and design explanations in English.',
    content: { brand: 'Stillwater', category: 'Boutique stays', headline: 'A stay at your own pace.', description: 'Compare sample rooms, find options that suit your needs and try the local booking request flow.', catalogLabel: 'Room options', catalogLink: 'Compare rooms', searchPlaceholder: 'Search room features', addLabel: 'Add to comparison', addMessage: 'Room added to your comparison list.', priceSuffix: ' / night', selectionTitle: 'Rooms you are comparing', formTitle: 'Booking request', formDescription: 'This form is a local demo. It does not check dates or availability and does not create a reservation.', formButton: 'Complete sample request', formSuccess: 'Booking request demo complete. No real reservation was made and your details were not saved.', items: [
      { id: 'standard', name: 'Courtyard room', category: 'Standard', description: 'A simple room overlooking the courtyard.', meta: '2 guests · 22 m² · Double bed', price: 2800 },
      { id: 'twin', name: 'Twin room', category: 'Standard', description: 'A sample option for guests who prefer separate beds.', meta: '2 guests · 24 m² · Two single beds', price: 2800 },
      { id: 'terrace', name: 'Terrace room', category: 'With terrace', description: 'A room with its own outdoor seating area.', meta: '2 guests · 28 m² · Private terrace', price: 3600 },
      { id: 'garden', name: 'Garden room', category: 'With terrace', description: 'A ground-floor room with outdoor seating.', meta: '2 guests · 26 m² · Garden access', price: 3300 },
      { id: 'studio', name: 'Studio suite', category: 'Suites', description: 'A spacious room with a separate sitting area.', meta: '3 guests · 38 m² · Sitting area', price: 4400 },
      { id: 'family', name: 'Family suite', category: 'Suites', description: 'A sample two-part suite for guests traveling together.', meta: '4 guests · 48 m² · Two spaces', price: 5200 },
    ] },
  },
  {
    id: 'record-store', name: 'Record store', category: 'Music & retail', description: 'Sample record catalog, genre filters and a shopping list.',
    defaultBrief: '33 RPM is a fictional record store focused on discovery. My audience is interested in jazz, electronic music, analog photography and independent bookstores. Design an original store with the feel of a collection while preserving the sample album information and shopping interactions. Draw inspiration from cultural references without using real artists\' images, album covers or fabricated quotes. Write all site content, interface labels and design explanations in English.',
    content: { brand: '33 RPM', category: 'Records & music', headline: 'Discover your next listen.', description: 'Browse a sample catalog of fictional albums. Filter by genre and add the records you want to hear to your list.', catalogLabel: 'Record catalog', catalogLink: 'Explore the catalog', searchPlaceholder: 'Search albums or genres', addLabel: 'Add to cart', addMessage: 'Record added to your sample cart.', selectionTitle: 'Your sample cart', formTitle: 'Complete your selection', formDescription: 'The albums in this catalog are fictional. This form completes only a local shopping demo; no payment is taken.', formButton: 'Complete sample cart', formSuccess: 'Sample cart complete. No payment, order or email was sent.', items: [
      { id: 'afterhours', name: 'After Hours / Coast Trio', category: 'Jazz', description: 'A fictional album for an acoustic trio.', meta: '12-inch · 33 RPM · Sample release', price: 780 },
      { id: 'bluewindow', name: 'Blue Window / Harbor Quartet', category: 'Jazz', description: 'A fictional quartet recording with a relaxed tempo.', meta: '12-inch · 33 RPM · Sample release', price: 820 },
      { id: 'parallel', name: 'Parallel Lines / Signal 03', category: 'Electronic', description: 'A fictional electronic album built around rhythm.', meta: '12-inch · 45 RPM · Sample release', price: 690 },
      { id: 'threshold', name: 'Threshold / Field Notes', category: 'Electronic', description: 'A fictional work composed of layered sounds.', meta: '12-inch · 33 RPM · Sample release', price: 740 },
      { id: 'morning', name: 'Morning Objects / Fieldwork', category: 'Ambient', description: 'A fictional ambient album for slow listening.', meta: '12-inch · 33 RPM · Sample release', price: 710 },
      { id: 'shoreline', name: 'Shoreline / Quiet Assembly', category: 'Ambient', description: 'A fictional work based on field recordings.', meta: '12-inch · 33 RPM · Sample release', price: 760 },
    ] },
  },
  {
    id: 'fashion-brand', name: 'Clothing brand', category: 'Fashion & retail', description: 'Product collection, category filters and a sample cart.',
    defaultBrief: 'Threadline is a fictional clothing brand offering simple pieces for everyday use. My audience is interested in modern architecture, contemporary dance, design museums and electronic music. Design a coherent, accessible collection site while preserving product information, prices and the cart flow. Do not infer personality or income from tastes, or add fabricated sustainability certifications or performance claims. Write all site content, interface labels and design explanations in English.',
    content: { brand: 'Threadline', category: 'Everyday clothing', headline: 'Pieces for the way you move.', description: 'Compare products in the sample collection, filter by category and build your own selection.', catalogLabel: 'Collection', catalogLink: 'View the collection', searchPlaceholder: 'Search products or materials', addLabel: 'Add to cart', addMessage: 'Product added to your sample cart.', selectionTitle: 'Your sample cart', formTitle: 'Complete your selection', formDescription: 'A local shopping demo without size or stock checks. No payment is taken and no real order is placed.', formButton: 'Complete sample purchase', formSuccess: 'Shopping demo complete. No real order was placed or payment taken.', items: [
      { id: 'tshirt', name: 'Straight-cut T-shirt', category: 'Tops', description: 'A simple sample piece for everyday wear.', meta: 'Cotton · Sample sizes S–XL', price: 650 },
      { id: 'shirt', name: 'Pocket shirt', category: 'Tops', description: 'A long-sleeved style suitable for layering.', meta: 'Cotton · Sample sizes S–XL', price: 1400 },
      { id: 'trouser', name: 'Relaxed trousers', category: 'Bottoms', description: 'A straight-leg style with simple pockets.', meta: 'Cotton blend · Sample sizes S–XL', price: 1800 },
      { id: 'short', name: 'Everyday shorts', category: 'Bottoms', description: 'A simple sample style for lighter wear.', meta: 'Cotton · Sample sizes S–XL', price: 950 },
      { id: 'tote', name: 'Canvas tote', category: 'Accessories', description: 'An open-compartment bag for everyday essentials.', meta: 'Canvas · One size', price: 450 },
      { id: 'cap', name: 'Plain cap', category: 'Accessories', description: 'A simple sample accessory with an adjustable fit.', meta: 'Cotton · Adjustable', price: 550 },
    ] },
  },
  {
    id: 'creative-workshop', name: 'Creative workshop', category: 'Education & events', description: 'Workshop schedule, discipline filters and a sample registration request.',
    defaultBrief: 'Open Workshop is a fictional workshop program covering different creative disciplines. My audience enjoys illustration, analog photography, crafts, experimental music and small cultural venues. Design a site with its own visual language that makes participation easy while preserving program descriptions and the registration request flow. Do not add claims about real capacity, instructor credentials or outcomes. Make the program easy to scan on mobile. Write all site content, interface labels and design explanations in English.',
    content: { brand: 'Open Workshop', category: 'Creative workshops', headline: 'Experiment together. Find your own method.', description: 'Explore the sample workshop program, filter options by your interests and save the sessions you want to join.', catalogLabel: 'Workshop program', catalogLink: 'Explore the program', searchPlaceholder: 'Search workshops or disciplines', addLabel: 'Add to my program', addMessage: 'Workshop added to your sample program.', selectionTitle: 'Your selected workshops', formTitle: 'Participation request', formDescription: 'Dates and capacities are not real. This form shows only a local registration flow; it does not register you for an event.', formButton: 'Complete sample registration', formSuccess: 'Participation request demo complete. No real registration was created and personal details were not saved.', items: [
      { id: 'collage', name: 'Paper collage', category: 'Visual arts', description: 'Experiment with composition using simple materials.', meta: 'Sample session · 2 hours · Beginner', price: 700 },
      { id: 'print', name: 'Single-color printing', category: 'Visual arts', description: 'Explore printing through shape and negative space.', meta: 'Sample session · 3 hours · Beginner', price: 950 },
      { id: 'photo', name: 'Photography walk', category: 'Photography', description: 'Look for light, rhythm and framing in your surroundings.', meta: 'Sample session · 2 hours · All levels', price: 600 },
      { id: 'zine', name: 'Photography zine', category: 'Photography', description: 'Design a small publication from your own photographs.', meta: 'Sample session · 3 hours · All levels', price: 800 },
      { id: 'sound', name: 'Sketching with sound', category: 'Sound', description: 'Turn everyday sounds into small arrangements.', meta: 'Sample session · 2 hours · Beginner', price: 750 },
      { id: 'rhythm', name: 'Rhythm experiments', category: 'Sound', description: 'A group session exploring shared rhythm and listening.', meta: 'Sample session · 2 hours · Beginner', price: 650 },
    ] },
  },
];

export const templates = definitions.map(({ content, ...metadata }) => ({ ...metadata, files: buildFiles(content) }));

export function getTemplate(id) {
  return templates.find((template) => template.id === id) || null;
}
