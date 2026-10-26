// Whether a recorded comparison kept its two arms apart: the arm the gallery shows as "With Qloo" designed from Qloo's
// measurement, the arm shown as "Without Qloo" from the agent's frozen guess alone, and nothing measured reached the
// second. It reads a run's own folder (its records, the Qloo answers it cached and the session's stream), which holds
// Qloo's answers and so stays off the repository, and the built gallery's entry for what the site shows. Read-only.
//
// The checks, each reported with what it found:
// - records: each arm's taste source, a Qloo profile only in the Qloo arm and no Qloo request counted in the other, one
//   guess in both (identical apart from when each copy was frozen), and a guess-only Design DNA resting on that guess;
// - time: every Qloo answer the run saved came after the last copy of the guess was frozen, and none sits in the
//   guess-only arm;
// - published: the gallery and the blind vote show each arm under the label its own record gives, one Qloo arm a pair;
// - the stream. Claude Code: the guess-only subagent started before anything asked Qloo, was sent nothing after the
//   measurement, never asked Qloo, never named the Qloo arm or a Qloo record, never saw a folder outside its own in what
//   a search returned, and no brief given it after the measurement names a work only Qloo measured; no one else wrote
//   into its folder after the measurement. Codex, which builds the
//   arms in turn: nothing in the guess-only folder changed after its first call to Qloo, and it read no Qloo answer
//   before it. A live try (Kiro): the guess-only session never asked Qloo or named the Qloo arm, Qloo's address or key.
import fs from 'node:fs/promises';
import path from 'node:path';

export const ARM_LABELS = Object.freeze({ 'with-qloo': 'With Qloo', 'without-qloo': 'Without Qloo' });

const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse, () => null);
const exists = file => fs.stat(file).then(() => true, () => false);
const jsonLines = async file => (await fs.readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean)
  .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const slash = text => String(text ?? '').split('\\').join('/').replace(/\/+/gu, '/');
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const named = (text, name) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);
const anchorsOf = dna => (dna?.dna?.devices || dna?.devices || []).flatMap(device => device.anchors || [])
  .map(anchor => (typeof anchor === 'string' ? anchor : anchor?.ref)).filter(Boolean);
// A copy of the guess without the moment it was frozen and the seal over that moment.
const guessOf = prediction => { const { frozenAt, sha256, ...guess } = prediction || {}; return JSON.stringify(guess); };

/** A call that asks Qloo: taste_profile without baseline or dryRun (neither makes a request), taste_ask or qloo_query. */
export function asksQloo(name, input) {
  return (/taste_profile$/u.test(name || '') && !input?.baseline && !input?.dryRun) || /(taste_ask|qloo_query)$/u.test(name || '');
}

// What a guess-only arm may name outside its folder: the plugin, its skills and libraries, the host's own files.
const SHARED = /\/(plugins?|library|skills|\.claude|\.codex|\.kiro|node_modules)\//iu;
/** Whether a path names the Qloo arm, or a Qloo record or answer that is not the guess-only arm's own. */
export function foreignPath(raw) {
  // A URL counts too: a browser opening the Qloo arm's page reads it as surely as a file read does.
  const item = slash(raw);
  if (SHARED.test(item) || /without-qloo/u.test(item)) return false;
  // A relative .mousa/ is the arm's own (a live try's session works inside its arm); one reached through a folder is not.
  return /(^|\/)with-qloo(\/|$)|\/\.mousa\/(cache|taste)\/|profile\.json|compare-report/u.test(item);
}
const pathsIn = value => [...slash(typeof value === 'string' ? value : JSON.stringify(value ?? {})).matchAll(/(?:[A-Za-z]:)?[\w.@ -]*(?:\/[\w.@ -]+)+/gu)].map(match => match[0].trim());

// A search or listing that walks folders reads the Qloo arm without naming it unless it stays inside the guess-only one.
const WALKS = /\b(e|f)?grep\s+[^|;&]*-\w*[rR]|\b(rg|find|tree)\b|\bls\s+[^|;&]*-\w*R|-Recurse\b|\bdir\s+\/s\b/u;
function walksOutside({ name, input = {} }) {
  const inside = value => /without-qloo/u.test(slash(value)) || SHARED.test(slash(value));
  if (name === 'Grep') return !inside(input.path);
  if (name === 'Glob') return !inside(input.path) && !/^(\.\/)?compare\/without-qloo\//u.test(slash(input.pattern));
  if (/^(Bash|PowerShell)$/u.test(name)) return WALKS.test(input.command || '') && (!inside(input.command) || /(^|[\s'"/])\.\.(\/|$|[\s'"])/u.test(slash(input.command)));
  return false;
}
const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/u;
// A redirection writes a file; one of a stream into another (2>&1) or into nothing (2>/dev/null) does not, and quoted
// text is an argument, such as a grep pattern for '<input[^>]*>'. A parent's read-only fact check with both was once
// taken for a write into the guess-only arm.
const WRITE_VERBS = /Set-Content|Out-File|Add-Content|New-Item|Copy-Item|Move-Item|Remove-Item|WriteAllText|writeFileSync|apply_patch|\b(cp|mv|rm|tee|touch)\b|\bsed\s+-i|(?<![\d&>])>{1,2}\s*(?!&|\/dev\/null\b)[^\s|&;]/u;
const writes = command => WRITE_VERBS.test(String(command || '').replace(/'[^']*'|"(?:[^"\\]|\\.)*"/gu, '""'));

/** The records of both arms: their sources, the shared guess, the anchors of each Design DNA. */
export function recordChecks({ qloo, guess, shared = null }) {
  const problems = [];
  if (qloo.input?.source !== 'qloo-profile') problems.push(`the With Qloo arm's taste input is ${qloo.input?.source || 'missing'}`);
  if (guess.input?.source !== 'model-assumption') problems.push(`the Without Qloo arm's taste input is ${guess.input?.source || 'missing'}`);
  if (!qloo.profile) problems.push('the With Qloo arm holds no Qloo profile');
  if (guess.profile) problems.push('the Without Qloo arm holds a Qloo profile');
  if (guess.requests > 0) problems.push(`the Without Qloo arm counted ${guess.requests} Qloo requests`);
  if (!qloo.prediction || !guess.prediction || guessOf(qloo.prediction) !== guessOf(guess.prediction)) problems.push('the arms do not hold the same frozen guess');
  const guessRefs = new Set((guess.input?.entities || []).map(entity => entity.ref));
  const measuredRefs = new Set((qloo.input?.entities || []).filter(entity => entity.source === 'qloo').map(entity => entity.ref));
  const guessAnchors = anchorsOf(guess.dna), outside = guessAnchors.filter(ref => !guessRefs.has(ref));
  if (outside.length) problems.push(`the Without Qloo Design DNA cites ${outside.length} refs its guess does not hold`);
  const qlooAnchors = anchorsOf(qloo.dna);
  return { problems, facts: {
    sources: `${qloo.input?.source || '-'} / ${guess.input?.source || '-'}`,
    requests: `${qloo.requests} / ${guess.requests}${shared === null ? '' : ` (a live try counts its requests once, in step one's file: ${shared}; the Qloo arm reads them again from its copy of the answers)`}`,
    guessAnchors: `${guessAnchors.length}, ${outside.length} outside its guess`,
    qlooAnchors: `${qlooAnchors.filter(ref => measuredRefs.has(ref)).length} of ${qlooAnchors.length} on measured works`,
  } };
}

/** Every Qloo answer the run saved against the moments the guess was frozen. */
export function timeChecks({ predictions, answers }) {
  const problems = [];
  const frozen = predictions.map(prediction => Date.parse(prediction?.frozenAt)).filter(Number.isFinite);
  if (!frozen.length) return { problems: ['no copy of the guess says when it was frozen'], facts: {} };
  const sealed = Math.max(...frozen);
  const undated = answers.filter(answer => !Number.isFinite(answer.savedAt));
  const early = answers.filter(answer => answer.savedAt < sealed);
  const inGuess = answers.filter(answer => answer.inGuess);
  if (!answers.length) problems.push('the run holds no Qloo answer');
  if (undated.length) problems.push(`${undated.length} Qloo answers carry no date`);
  if (early.length) problems.push(`${early.length} Qloo answers were saved before the guess was frozen: ${early.map(answer => answer.file).join(', ')}`);
  if (inGuess.length) problems.push(`the Without Qloo arm holds ${inGuess.length} Qloo answers`);
  const first = Math.min(...answers.map(answer => answer.savedAt).filter(Number.isFinite));
  return { problems, facts: { time: `${predictions.length} copies of the guess, last frozen ${new Date(sealed).toISOString()}; ${answers.length} Qloo answers, the first saved ${Number.isFinite(first) ? `${Math.round((first - sealed) / 1000)} s after` : '-'}; ${inGuess.length} in the Without Qloo arm` } };
}

/** What the site shows: each played arm and each voted arm under the label its own record gives. */
export function publishedChecks(entry, record) {
  const problems = [];
  if (!entry || !record) return { problems: ['the built gallery holds no entry for this pair'], facts: {} };
  for (const item of entry.play || []) {
    const want = ARM_LABELS[String(item.path || '').split('/')[1]];
    if (want && item.label !== want) problems.push(`the gallery plays ${item.path} as "${item.label}"`);
  }
  const arms = record.arms || [];
  for (const arm of arms) {
    const qloo = arm.taste === 'qloo';
    if (qloo !== (arm.label === ARM_LABELS['with-qloo']) || qloo !== /(^|\/)with-qloo$/u.test(arm.folder || '')) problems.push(`the record shows ${arm.folder} (${arm.taste}) as "${arm.label}"`);
  }
  if (arms.filter(arm => arm.taste === 'qloo').length !== 1) problems.push(`the pair has ${arms.filter(arm => arm.taste === 'qloo').length} Qloo arms`);
  return { problems, facts: { published: [...(entry.play || []).map(item => `${item.label}=${item.path.split('/')[1]}`), ...arms.map(arm => `${arm.label}=${arm.folder} (${arm.taste})`)].join(', ') } };
}

/** A Claude Code comparison: the parent starts a guess-only subagent and a Qloo subagent. */
export function claudeCodeChecks(lines, { measuredOnly = [], brief = '' } = {}) {
  const problems = [];
  const blocks = lines.flatMap((message, at) => (message.message?.content || []).map(block => ({ block, at, parent: message.parent_tool_use_id || null })));
  const calls = blocks.filter(item => item.block.type === 'tool_use');
  const agents = calls.filter(item => item.block.name === 'Agent' && !item.parent);
  const guessAgents = agents.filter(item => /baseline/u.test(item.block.input?.subagent_type || ''));
  if (!guessAgents.length) return { problems: ['no guess-only subagent in the stream'], facts: {} };
  const guessIds = new Set(guessAgents.map(item => item.block.id));
  const firstAsk = calls.find(item => asksQloo(item.block.name, item.block.input));
  const askedBy = item => (!item ? '-' : !item.parent ? 'the parent' : guessIds.has(item.parent) ? 'the guess-only arm' : 'the Qloo arm');
  if (firstAsk && guessAgents.some(item => item.at > firstAsk.at)) problems.push('the guess-only arm was started after a call to Qloo');
  // Each call's result, by the call's id: which agent a start made, and what a search returned.
  const results = new Map(blocks.filter(item => item.block.type === 'tool_result').map(item => [item.block.tool_use_id, item.block.content]));
  const resultText = id => { const content = results.get(id); return typeof content === 'string' ? content : JSON.stringify(content ?? ''); };
  // The names a parent may address the guess-only subagent by: its start's id, the name it was given and the agentId
  // its start returned. A message reaches it only if sent to one of those, or to a recipient that cannot be told apart.
  const guessNames = new Set(guessAgents.flatMap(item => [item.block.id, item.block.input?.name, /agentId[^A-Za-z0-9]*([A-Za-z0-9_-]{6,})/u.exec(resultText(item.block.id))?.[1]]).filter(Boolean));
  const sends = calls.filter(item => /SendMessage/u.test(item.block.name) && !item.parent && (!firstAsk || item.at > firstAsk.at))
    .filter(item => { const to = item.block.input?.to; return !to || guessNames.has(String(to)) || !guessAgents.some(agent => results.has(agent.block.id)); });
  if (sends.length) problems.push(`the parent sent ${sends.length} messages to the guess-only arm after the call to Qloo`);
  const others = calls.filter(item => !guessIds.has(item.parent) && firstAsk && item.at > firstAsk.at).filter(({ block: { name, input = {} } }) =>
    (WRITE_TOOLS.test(name) && /without-qloo/u.test(slash(input.file_path || input.notebook_path)))
    || (/^(Bash|PowerShell)$/u.test(name) && /without-qloo/u.test(slash(input.command)) && writes(input.command)));
  if (others.length) problems.push(`${others.length} writes into the Without Qloo arm by others after the call to Qloo`);
  const own = calls.filter(item => guessIds.has(item.parent)).map(item => item.block);
  const asks = own.filter(call => asksQloo(call.name, call.input));
  const foreign = [...new Set(own.flatMap(call => pathsIn(call.input)).filter(foreignPath))];
  const walks = own.filter(walksOutside);
  // A walk saw the Qloo arm when what it returned names it; one whose result is not in the stream counts as having seen it.
  const exposed = walks.filter(call => !results.has(call.id) || pathsIn(resultText(call.id)).some(foreignPath));
  if (asks.length) problems.push(`the guess-only arm asked Qloo ${asks.length} times`);
  if (foreign.length) problems.push(`the guess-only arm named ${foreign.join(', ')}`);
  if (exposed.length) problems.push(`the guess-only arm walked folders outside its own and saw them: ${exposed.map(call => call.name).join(', ')}`);
  // A brief given before anything asked Qloo cannot carry a measured name: a match there is a word it shares with a title,
  // such as "inside" and the game INSIDE. A brief given after the measurement is read for every work only Qloo measured.
  const prompt = guessAgents.filter(item => firstAsk && item.at > firstAsk.at).map(item => item.block.input?.prompt || '').join('\n');
  const told = measuredOnly.filter(name => named(prompt, name) && !named(brief, name));
  if (told.length) problems.push(`the guess-only arm's brief names measured works: ${told.join(', ')}`);
  return { problems, facts: {
    order: `guess-only arm started at stream line ${guessAgents.map(item => item.at).join(',')}, the first call to Qloo at ${firstAsk?.at ?? '-'} by ${askedBy(firstAsk)}`,
    guessArm: `${own.length} calls: ${asks.length} to Qloo, ${foreign.length} naming the Qloo arm or its records, ${walks.length} walking outside its folder (${exposed.length} seeing anything outside it); a brief after the measurement names ${told.length} measured works`,
    others: `${sends.length} messages sent to the guess-only arm, ${others.length} writes into its folder by others after the call to Qloo`,
  } };
}

/** A Codex comparison: one agent builds the guess-only arm, then measures and builds the Qloo arm. */
export function codexChecks(lines, { lastGuessEdit = null, measuredAt = null } = {}) {
  const problems = [];
  const items = lines.map(line => line.item).filter(Boolean);
  const firstAsk = items.findIndex(item => item.type === 'mcp_tool_call' && asksQloo(item.tool, item.arguments));
  const writesGuess = item => (item.type === 'file_change' && (item.changes || []).some(change => /without-qloo/u.test(slash(change.path))))
    || (item.type === 'command_execution' && /without-qloo/u.test(slash(item.command)) && writes(item.command));
  const later = firstAsk < 0 ? [] : items.filter((item, at) => at > firstAsk && item.status !== 'in_progress' && writesGuess(item));
  if (later.length) problems.push(`${later.length} writes into the Without Qloo arm after the first call to Qloo`);
  // The plugin's own files sit in Codex's plugin cache, a folder also called cache: only the project's answers count.
  const reads = items.slice(0, firstAsk < 0 ? items.length : firstAsk).filter(item => item.type === 'command_execution' && item.status !== 'in_progress'
    && (pathsIn(item.command).some(file => !SHARED.test(file) && /profile\.json|\/\.mousa\/cache\//u.test(file)) || /qloo\.com|X-Api-Key/iu.test(item.command || '')));
  if (reads.length) problems.push(`${reads.length} commands before the first call to Qloo read a Qloo answer`);
  if (Number.isFinite(lastGuessEdit) && Number.isFinite(measuredAt) && lastGuessEdit > measuredAt) problems.push('a Without Qloo design file changed after the first Qloo answer');
  return { problems, facts: {
    order: `first call to Qloo at item ${firstAsk}; ${later.length} writes into the Without Qloo arm after it; ${reads.length} Qloo answers read before it`,
    ...(Number.isFinite(lastGuessEdit) && Number.isFinite(measuredAt) ? { lastGuessEdit: `${((measuredAt - lastGuessEdit) / 1000).toFixed(1)} s before the first Qloo answer` } : {}),
  } };
}

/** A live try's guess-only Kiro session; the server already starts it with no Qloo key and the other arm denied. */
export function kiroChecks(lines) {
  const problems = [];
  const calls = lines.map(line => line.data?.update).filter(update => update?.sessionUpdate === 'tool_call');
  const asks = calls.filter(call => asksQloo(call._meta?.kiro?.toolName || call.title, call.rawInput));
  const foreign = [...new Set(calls.flatMap(call => pathsIn(call.rawInput)).filter(foreignPath))];
  const endpoint = calls.filter(call => /hackathon\.api\.qloo\.com|QLOO_API_KEY|X-Api-Key/iu.test(JSON.stringify(call.rawInput || {})));
  if (asks.length) problems.push(`the guess-only session asked Qloo ${asks.length} times`);
  if (foreign.length) problems.push(`the guess-only session named ${foreign.join(', ')}`);
  if (endpoint.length) problems.push('the guess-only session named Qloo\'s address or key');
  return { problems, facts: { guessArm: `${calls.length} calls: ${asks.length} to Qloo, ${foreign.length} naming the Qloo arm or its records, ${endpoint.length} naming Qloo's address or key` } };
}

async function filesUnder(dir, keep, found = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name === 'node_modules') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await filesUnder(file, keep, found);
    else if (keep(file, entry.name)) found.push(file);
  }
  return found;
}

/**
 * One comparison: `root` is its run folder (session.jsonl and project/, or a live try's folder with sessions/), and
 * `gallery` the built gallery folder that holds its entry. Returns null for a run that is not a pair.
 */
export async function checkComparison({ id, root, gallery, tryRun = false }) {
  const project = path.join(root, 'project');
  const folders = { qloo: path.join(project, 'compare', 'with-qloo'), guess: path.join(project, 'compare', 'without-qloo') };
  if (!(await exists(folders.qloo)) || !(await exists(folders.guess))) return null;
  const arms = {};
  for (const [key, folder] of Object.entries(folders)) {
    const read = name => readJson(path.join(folder, '.mousa', `${name}.json`));
    arms[key] = { input: await read('taste/input'), profile: await exists(path.join(folder, '.mousa', 'taste', 'profile.json')), prediction: await read('taste/prediction'),
      requests: (await read('usage'))?.qlooRequests ?? 0, dna: await read('design/dna') };
  }
  const predictions = (await Promise.all([path.join(project, '.mousa'), path.join(folders.qloo, '.mousa'), path.join(folders.guess, '.mousa')]
    .map(dir => readJson(path.join(dir, 'taste', 'prediction.json'))))).filter(Boolean);
  const cached = await filesUnder(project, file => /\.json$/u.test(file) && slash(file).includes('/cache/qloo/'));
  const answers = await Promise.all(cached.map(async file => ({ file: slash(path.relative(project, file)), savedAt: Date.parse((await readJson(file))?.savedAt), inGuess: file.startsWith(folders.guess) })));
  const shared = tryRun ? (await readJson(path.join(project, '.mousa', 'usage.json')))?.qlooRequests ?? 0 : null;
  const parts = [recordChecks({ ...arms, shared }), timeChecks({ predictions, answers }),
    publishedChecks(await readJson(path.join(gallery, id, 'entry.json')), await readJson(path.join(gallery, id, 'report', 'record.json')))];
  if (tryRun) parts.push(kiroChecks(await jsonLines(path.join(root, 'sessions', 'without-qloo.jsonl'))));
  else {
    const lines = await jsonLines(path.join(root, 'session.jsonl'));
    if (lines.some(message => message.type === 'assistant' || message.type === 'user')) {
      // The works only Qloo measured, which the guess-only arm's brief must not name unless the person's brief does.
      const ownNames = new Set((arms.guess.input?.entities || []).map(entity => String(entity.name || '').toLowerCase()));
      const measuredOnly = (arms.qloo.input?.entities || []).filter(entity => entity.source === 'qloo' && !entity.predictedByModel && !ownNames.has(String(entity.name || '').toLowerCase()))
        .map(entity => String(entity.name || '')).filter(name => name.length >= 4);
      parts.push(claudeCodeChecks(lines, { measuredOnly, brief: await fs.readFile(path.join(root, 'brief.md'), 'utf8').catch(() => '') }));
    } else {
      // Tool-agnostic: the guess-only arm's design files, against the moment the first Qloo answer existed.
      const designs = await filesUnder(folders.guess, file => !slash(path.relative(folders.guess, file)).startsWith('.mousa/'));
      const times = await Promise.all(designs.map(file => fs.stat(file).then(stat => stat.mtimeMs)));
      const dated = answers.map(answer => answer.savedAt).filter(Number.isFinite);
      parts.push(codexChecks(lines, { lastGuessEdit: times.length ? Math.max(...times) : null, measuredAt: dated.length ? Math.min(...dated) : null }));
    }
  }
  const problems = parts.flatMap(part => part.problems);
  return { id, ok: !problems.length, problems, facts: Object.assign({}, ...parts.map(part => part.facts)) };
}
