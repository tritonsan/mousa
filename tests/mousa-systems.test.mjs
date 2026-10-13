// The design-system adapters on small projects of each kind: Tailwind 4 with an @theme, Tailwind 3 with a config and
// JSX, shadcn/ui's HSL-triplet variables, oklch() colours, a W3C token file and a built folder to capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { checkDnaConformance } from '../plugin/server/culture/taste.mjs';
import { checkLiteralConformance } from '../plugin/server/production/media.mjs';
import { detectDesignSystem, checkDesignSystem, checkFontFiles, reachedPaths, styleFootprint, styleNotes } from '../plugin/server/design/systems.mjs';
import { tailwindTheme, utilityNames } from '../plugin/server/design/tailwind.mjs';
import { colorValues, holdsColor } from '../plugin/server/design/colors.mjs';
import { createDesignTools } from '../plugin/server/design/tools.mjs';
import { encodePng } from '../plugin/server/production/image-files.mjs';

const device = (id, layer, tokens) => ({ id, layer, device: `${layer} device`, tokens: { colors: [], fonts: [], css: [], ids: [], copy: [], images: [], keyframes: [], svg: [], ...tokens } });
const statusOf = (report, id) => report.devices.find(item => item.id === id);

test('colours are read in every notation a design system writes, and matched within what the eye can tell', () => {
  assert.deepEqual(colorValues('oklch(20.8% 0.042 265.755)'), ['#0f172b'], 'Tailwind 4 slate-900');
  assert.ok(holdsColor('oklch(0.208 0.042 265.755)', '#0f172a'), 'its Tailwind 3 hex is the same colour');
  assert.ok(holdsColor('222.2 47.4% 11.2%', '#0f172a'), 'a shadcn/ui HSL triplet');
  assert.ok(holdsColor('hsl(222.2 47.4% 11.2% / 0.8)', '#0f172a'));
  assert.ok(holdsColor('rgb(15 23 42)', '#0f172a') && holdsColor('#0F172A', '#0f172a'));
  assert.ok(!holdsColor('oklch(62.8% 0.2577 29.23)', '#0f172a'), 'red is not slate');
  assert.deepEqual(colorValues('oklab(1 0 0)'), ['#ffffff']);
});

test('Tailwind 4: a DNA colour or family is bound when the @theme holds it and a class names it', () => {
  const files = {
    'index.html': '<body class="bg-mist text-ink"><h1 class="font-display md:hover:text-mist/80">Hi</h1><p class="border-moss">x</p></body>',
    'styles.css': '@import "tailwindcss";\n@theme {\n  --color-mist: oklch(43.6% 0.043 230.6);\n  --color-ink: #1d2a33;\n  --color-sand: #e9dcc4;\n  --font-display: "Jost", sans-serif;\n  @keyframes drift { from { opacity: 0 } to { opacity: 1 } }\n}\n',
  };
  const theme = tailwindTheme(files);
  assert.equal(theme.version, 4);
  assert.deepEqual([...theme.colors.keys()], ['mist', 'ink', 'sand']);
  assert.deepEqual([...theme.fonts.keys()], ['display']);
  assert.ok(utilityNames(files).colors.has('mist') && utilityNames(files).fonts.has('display'));
  const dna = { devices: [device('dna1', 'palette', { colors: ['#3e5c6b', '#1d2a33', '#e9dcc4'] }), device('dna2', 'typography', { fonts: ['Jost'] })] };
  const detected = detectDesignSystem(files);
  assert.equal(detected.system, 'tailwind');
  const report = checkDesignSystem(dna, files, checkDnaConformance(dna, files), detected);
  assert.equal(statusOf(report, 'dna2').status, 'present');
  const palette = statusOf(report, 'dna1');
  assert.equal(palette.status, 'partial', 'sand is in the theme, but no class names it');
  assert.deepEqual(palette.missing.map(item => [item.kind, item.value]), [['theme', '#e9dcc4']]);
  assert.match(palette.missing[0].detail, /the theme holds it as sand, but no class names it/u);
  assert.deepEqual(report.system.bindings.map(item => [item.value, item.name ?? item.declaredAs]), [['#3e5c6b', 'mist'], ['#1d2a33', 'ink'], ['#e9dcc4', ['sand']], ['Jost', 'display']]);
  assert.match(report.limitation, /named by a class/u);
});

test('Tailwind 3: the config\'s colours and families, and shadcn/ui\'s variables behind hsl(var()), bind through JSX classes', () => {
  const files = {
    'tailwind.config.js': `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        mist: { DEFAULT: '#3e5c6b', 500: "#8fb0a9" }, // the lake
        primary: 'hsl(var(--primary) / <alpha-value>)',
        brand: require('./brand').accent,
      },
      fontFamily: { display: ['Jost', 'sans-serif'], body: 'Literata, Georgia, serif' },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};`,
    'src/index.css': '@tailwind base;\n@tailwind components;\n:root { --primary: 222.2 47.4% 11.2%; }\n.card { @apply text-mist-500; }',
    'src/App.jsx': 'export default function App() { return <main className="bg-mist font-display hover:bg-primary/90"><p className={`font-body ${x}`}>Hi</p></main>; }',
  };
  const theme = tailwindTheme(files, { resolve: value => value.replace('var(--primary)', '222.2 47.4% 11.2%') });
  assert.equal(theme.version, 3);
  assert.deepEqual(Object.fromEntries(theme.colors), { mist: '#3e5c6b', 'mist-500': '#8fb0a9', primary: 'hsl(222.2 47.4% 11.2% / <alpha-value>)' }, 'an expression it cannot read is left out');
  assert.deepEqual(Object.fromEntries(theme.fonts), { display: 'Jost, sans-serif', body: 'Literata, Georgia, serif' });
  const dna = { devices: [device('dna1', 'palette', { colors: ['#3e5c6b', '#8fb0a9', '#0f172a'] }), device('dna2', 'typography', { fonts: ['Jost', 'Literata'] })] };
  const detected = detectDesignSystem(files);
  assert.deepEqual([detected.system, detected.medium], ['tailwind', 'generic']);
  const report = checkDesignSystem(dna, files, checkLiteralConformance(dna, files), detected);
  assert.equal(statusOf(report, 'dna1').status, 'present', JSON.stringify(statusOf(report, 'dna1').missing));
  assert.equal(statusOf(report, 'dna2').status, 'present', JSON.stringify(statusOf(report, 'dna2').missing));
  const named = Object.fromEntries(report.system.bindings.map(item => [item.value, item.name]));
  assert.deepEqual(named, { '#3e5c6b': 'mist', '#8fb0a9': 'mist-500', '#0f172a': 'primary', Jost: 'display', Literata: 'body' });
});

test('shadcn/ui variables without Tailwind, and oklch colours in a plain stylesheet, are the DNA\'s colours', () => {
  const shadcn = { 'index.html': '<p>Hi</p>', 'styles.css': ':root { --primary: 222.2 47.4% 11.2%; --background: 0 0% 100%; --radius: .5rem; }\nbody { color: hsl(var(--primary)); background: hsl(var(--background)); }' };
  const dna = { devices: [device('dna1', 'palette', { colors: ['#0f172a', '#ffffff'] })] };
  const detected = detectDesignSystem(shadcn);
  assert.equal(detected.system, 'css-vars');
  const report = checkDesignSystem(dna, shadcn, checkDnaConformance(dna, shadcn), detected);
  assert.equal(statusOf(report, 'dna1').status, 'present', JSON.stringify(statusOf(report, 'dna1').missing));
  assert.deepEqual(report.system.bindings.map(item => item.property), ['--primary', '--background']);
  const plain = { 'index.html': '<p>Hi</p>', 'styles.css': 'body { color: oklch(20.8% 0.042 265.755); }' };
  const oneColour = { devices: [device('dna1', 'palette', { colors: ['#0f172a'] })] };
  const literal = checkDnaConformance(oneColour, plain);
  assert.equal(statusOf(literal, 'dna1').status, 'missing', 'the literal check alone looks for the hex');
  assert.equal(statusOf(checkDesignSystem(oneColour, plain, literal, detectDesignSystem(plain)), 'dna1').status, 'present');
});

test('a W3C design token file is found by its $value leaves, under any name', () => {
  const files = { 'index.html': '<p>x</p>', 'design/brand.json': JSON.stringify({ color: { mist: { $type: 'color', $value: '#3e5c6b' } } }), 'tokens.css': ':root{--color-mist:#3e5c6b;--a:1;--b:2}' };
  assert.equal(detectDesignSystem(files).tokensFile, 'design/brand.json');
  assert.equal(detectDesignSystem({ ...files, 'src/theme.tokens.json': '{}' }).tokensFile, 'src/theme.tokens.json');
});

test('Tailwind motion: a theme animation a class names runs its keyframes, and motion-reduce classes keep motion safe', () => {
  const motionDevice = device('dna1', 'motion', { keyframes: ['light-arrival'] });
  const dna = { devices: [motionDevice] };
  const check = files => checkDesignSystem(dna, files, checkDnaConformance(dna, files), detectDesignSystem(files));
  // As the live Codex session first wrote it: the animation in @theme, its keyframes beside it, and a class.
  const css = '@import "tailwindcss";\n@theme {\n  --color-ink: #172e48;\n  --animate-light-arrival: light-arrival 1.4s ease-out both;\n  @keyframes light-arrival { from { opacity: 0 } to { opacity: 1 } }\n}\n';
  const page = classes => ({ 'index.html': `<main class="text-ink"><h1 class="${classes}">Stay</h1></main>`, 'src/style.css': css });
  const literal = checkDnaConformance(dna, page('animate-light-arrival'));
  assert.deepEqual(statusOf(literal, 'dna1').missing.map(item => item.kind), ['keyframes', 'motion'], 'the literal check sees no animation and no reduced-motion rule');
  const live = check(page('animate-light-arrival motion-reduce:animate-none'));
  assert.equal(statusOf(live, 'dna1').status, 'present', JSON.stringify(statusOf(live, 'dna1').missing));
  assert.deepEqual(live.system.animations, [{ keyframes: 'light-arrival', via: 'animate-light-arrival' }]);
  assert.equal(live.motion.reducedMotion, true);
  assert.deepEqual(statusOf(check(page('animate-light-arrival')), 'dna1').missing.map(item => item.value), ['reduced-motion fallback'], 'motion without a reduced-motion class or rule');
  assert.deepEqual(statusOf(check(page('text-ink')), 'dna1').missing.map(item => item.kind), ['keyframes', 'motion'], 'a theme animation no class names is not in use');
  // An arbitrary value names the keyframes itself, and an endless one needs a pause control.
  const endless = check(page('animate-[light-arrival_6s_ease-in-out_infinite] motion-safe:animate-[light-arrival_6s_ease-in-out_infinite]'));
  assert.deepEqual(statusOf(endless, 'dna1').missing.map(item => [item.kind, item.value]), [['motion', 'pause control']]);
  assert.match(statusOf(endless, 'dna1').missing[0].detail, /animate-\[light-arrival_6s_ease-in-out_infinite\] loops forever/u);
  const paused = { ...page('animate-[light-arrival_6s_ease-in-out_infinite] motion-reduce:animate-none'), 'src/main.js': 'document.querySelector("[data-motion-toggle]")' };
  assert.equal(statusOf(check(paused), 'dna1').status, 'present');
});

test('Tailwind 3 motion: an animation and keyframes in the config, named by a page\'s classes', () => {
  const config = `module.exports = { theme: { extend: {
      animation: { drift: 'drift 9s ease-in-out infinite', rise: 'rise 1s ease-out both' },
      keyframes: { drift: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } }, rise: { from: { opacity: '0' }, to: { opacity: '1' } } },
    } } };`;
  const files = { 'tailwind.config.js': config, 'src/index.css': '@tailwind base;\n@tailwind utilities;',
    'index.html': '<main class="motion-safe:animate-rise"><span class="motion-safe:animate-drift">~</span><button data-motion-toggle>Pause</button></main>' };
  const theme = tailwindTheme(files);
  assert.deepEqual([...theme.animations.keys(), ...theme.keyframes], ['drift', 'rise', 'drift', 'rise']);
  const dna = { devices: [device('dna1', 'motion', { keyframes: ['drift', 'rise'] })] };
  const detected = detectDesignSystem(files);
  assert.deepEqual([detected.system, detected.medium], ['tailwind', 'web']);
  const literal = checkDnaConformance(dna, files);
  assert.equal(statusOf(literal, 'dna1').status, 'missing', 'no CSS defines or runs them');
  const report = checkDesignSystem(dna, files, literal, detected);
  assert.equal(statusOf(report, 'dna1').status, 'present', JSON.stringify(statusOf(report, 'dna1').missing));
  assert.deepEqual(report.system.animations, [{ keyframes: 'drift', via: 'animate-drift', infinite: true }, { keyframes: 'rise', via: 'animate-rise' }]);
  // Without the pause button, the endless drift asks for one.
  const unpaused = { ...files, 'index.html': files['index.html'].replace('<button data-motion-toggle>Pause</button>', '') };
  assert.deepEqual(statusOf(checkDesignSystem(dna, unpaused, checkDnaConformance(dna, unpaused), detected), 'dna1').missing.map(item => item.value), ['pause control']);
  // Component sources are checked as text, which finds the names in the config already.
  const jsx = { ...files, 'src/App.jsx': 'export default () => <main className="motion-safe:animate-rise" />;' };
  assert.equal(statusOf(checkLiteralConformance(dna, jsx), 'dna1').status, 'present');
});

test('a font URL is followed from the stylesheet that holds it, and one that reaches no file is reported', async () => {
  assert.deepEqual(reachedPaths('fonts/a.woff2', 'src/style.css'), ['src/fonts/a.woff2']);
  assert.deepEqual(reachedPaths('../fonts/a.woff2?v=2', 'src/style.css'), ['fonts/a.woff2']);
  assert.deepEqual(reachedPaths('/fonts/a.woff2', 'src/style.css'), ['fonts/a.woff2', 'public/fonts/a.woff2', 'static/fonts/a.woff2'], 'the site root, or a folder a build serves as it is');
  assert.deepEqual([reachedPaths('https://cdn.example/a.woff2', 'a.css'), reachedPaths('../../a.woff2', 'src/a.css')], [[], []]);

  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-fontfile-'));
  try {
    await mkdir(path.join(project, 'public', 'fonts'), { recursive: true });
    await writeFile(path.join(project, 'public', 'fonts', 'jost-latin-wght-normal.woff2'), 'x');
    const fonts = [{ family: 'Jost', files: ['fonts/jost-latin-wght-normal.woff2'] }];
    const dna = { devices: [device('dna1', 'typography', { fonts: ['Jost'] })] };
    const site = url => ({ 'index.html': '<p>Hi</p>', 'src/style.css': `@font-face{font-family:'Jost';src:url('${url}') format('woff2')}\nbody{font-family:'Jost',sans-serif}` });
    const report = async url => checkFontFiles(checkDnaConformance(dna, site(url), { fonts }), dna, site(url), project, fonts);
    // As in the live Vite session: the font sits in public/fonts, and the site serves it as /fonts/….
    assert.equal(statusOf(await report('/fonts/jost-latin-wght-normal.woff2'), 'dna1').status, 'present');
    assert.equal(statusOf(await report('../public/fonts/jost-latin-wght-normal.woff2'), 'dna1').status, 'present');
    const wrong = await report('fonts/jost-latin-wght-normal.woff2');
    assert.equal(statusOf(wrong, 'dna1').status, 'partial', 'the file name is right, and the path from src/ reaches nothing');
    assert.match(statusOf(wrong, 'dna1').missing[0].detail, /src\/style\.css loads Jost from fonts\/jost-latin-wght-normal\.woff2, which reaches src\/fonts\/jost-latin-wght-normal\.woff2/u);
    assert.equal(wrong.score, 0.5);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('the check compares a Tailwind restyle with how the session found the project, and notes styling that left its classes', () => {
  const start = styleFootprint({ 'index.html': '<main class="bg-white p-6 text-slate-900"><h1 class="font-display text-4xl">Hi</h1></main>', 'src/style.css': '@import "tailwindcss";\n@theme { --color-brand: #4f39f6; }' });
  assert.deepEqual(start, { system: 'tailwind', stylesheets: ['src/style.css'], handWritten: 0, classes: 5 }, 'theme entries are not hand-written styling');
  const rules = Array.from({ length: 12 }, (_, index) => `.block-${index}{display:grid;gap:1rem;padding:2rem;color:var(--color-brand)}`).join('');
  const css = `@import "tailwindcss";\n@theme { --color-brand: #132e55; }\n@font-face{font-family:'Jost';src:url('/fonts/jost.woff2')}\n@keyframes glow { from { opacity: 0 } to { opacity: 1 } }\na:hover{color:red}${rules}`;
  const now = styleFootprint({ 'index.html': '<main class="block-1"><h1 class="font-display">Hi</h1></main>', 'src/style.css': css });
  assert.deepEqual([now.handWritten, now.classes], [49, 2], 'font faces and keyframes are left out, and a selector is not a declaration');
  assert.match(styleNotes(start, now)[0], /had 0 hand-written CSS declarations when the session began and has 49 now/u);
  assert.deepEqual(styleNotes(start, { ...now, handWritten: 40 }), [], 'a few rules for what no class can say are fine');
  assert.deepEqual(styleNotes({ ...start, system: 'css-vars' }, now), [], 'a stylesheet project is styled in CSS');
});

test('a framework project is captured from its own build folder', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-root-'));
  try {
    await mkdir(path.join(project, 'dist', 'assets'), { recursive: true });
    await mkdir(path.join(project, 'src'), { recursive: true });
    await writeFile(path.join(project, 'src', 'App.jsx'), 'export default () => <main className="bg-mist" />;');
    await writeFile(path.join(project, 'dist', 'index.html'), '<!doctype html><main>Built</main>');
    const served = [];
    const tools = createDesignTools({ project: async () => project, browser: async () => ({ available: true }), capture: async ({ baseUrl, views, outDir, prefix }) => {
      served.push(baseUrl);
      return views.map(view => {
        const file = path.join(outDir, `${prefix}-${view.id}.png`);
        return { id: `${prefix}-${view.id}`, view: view.id, width: view.width, height: 20, bytes: 1, file };
      });
    } });
    // The capture stand-in writes no PNG, so the pictures are written beside it.
    const write = async () => { for (const view of ['desktop', 'mobile']) await writeFile(path.join(project, '.mousa', 'captures', `r1-${view}.png`), encodePng(2, 2, Buffer.alloc(16, 200))); };
    await mkdir(path.join(project, '.mousa', 'captures'), { recursive: true });
    await write();
    await assert.rejects(tools.handle('design_capture', {}), error => error.code === 'CAPTURE_INVALID' && /specimen:true/u.test(error.message), 'a JSX project has no page of its own');
    await assert.rejects(tools.handle('design_capture', { root: 'build' }), error => error.code === 'CAPTURE_INVALID' && /Run the project's build first/u.test(error.message));
    const result = await tools.handle('design_capture', { root: 'dist' });
    assert.equal(result.content.filter(item => item.type === 'image').length, 2);
    assert.equal(served.length, 1);
  } finally { await rm(project, { recursive: true, force: true }); }
});
