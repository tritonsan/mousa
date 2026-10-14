// What a recorded session did, step by step, without what it read or wrote: the tools it called in order, the stage or
// question of each Moûsa call, whether a call was refused and with which code, and, where the host's stream records
// time, when. Claude Code's subagents get lanes of their own. File contents, commands, paths and the model's text are
// never kept, so the timeline can be published beside the report.

// The arguments a step may show: which stage, question or action, never a value the agent wrote.
const DETAIL = Object.freeze({
  taste_profile: args => args.dryRun ? 'plan' : args.baseline ? 'baseline' : 'measure',
  design_validate: args => args.stage,
  taste_ask: args => args.question,
  design_capture: args => args.specimen ? 'specimen' : args.round ? `round ${args.round}` : null,
  image: args => args.action,
  materials: args => args.action,
  design_compare: args => args.prepare ? 'prepare' : 'compare',
  design_report: args => args.a ? 'comparison' : 'session',
  qloo_query: args => args.kind,
});
const WORD = /^[A-Za-z][A-Za-z0-9 _:-]{0,40}$/u;
const safe = value => (typeof value === 'string' && WORD.test(value) ? value : null);
// Built-in tools by what they did, so a reader sees reads, writes and shell use rather than host names.
const KINDS = Object.freeze({ Read: 'read', Glob: 'read', Grep: 'read', LS: 'read', Write: 'write', Edit: 'write', MultiEdit: 'write', NotebookEdit: 'write', Bash: 'shell', PowerShell: 'shell',
  Skill: 'skill', Agent: 'agent', Task: 'agent', ToolSearch: 'tool search', TodoWrite: 'plan' });

/** A Moûsa tool's result as its status: refused with its code when the tool answered with an error. */
function outcome(text, isError) {
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* A result that is not JSON is judged by the host's error flag alone. */ }
  if (parsed?.status === 'error') return { status: 'refused', ...(safe(parsed.error?.code) ? { code: parsed.error.code } : {}) };
  return isError ? { status: 'error' } : { status: 'ok' };
}
const resultText = content => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text).join('') : '';

/** One step of a lane; a run of the same built-in tool becomes one step with a count. */
function push(lane, step) {
  const last = lane.steps.at(-1);
  if (last && !step.tool.startsWith('mousa:') && last.tool === step.tool && last.status === step.status && !last.detail && !step.detail) { last.count = (last.count || 1) + 1; return; }
  lane.steps.push(step);
}

function summarize(lanes) {
  const steps = lanes.flatMap(lane => lane.steps);
  const count = predicate => steps.filter(predicate).reduce((sum, step) => sum + (step.count || 1), 0);
  return { lanes: lanes.filter(lane => lane.steps.length),
    totals: { mousa: count(step => step.tool.startsWith('mousa:')), refused: count(step => step.status === 'refused'), reads: count(step => step.tool === 'read'),
      writes: count(step => step.tool === 'write'), shell: count(step => step.tool === 'shell') } };
}

/**
 * A Claude Code stream-json session: assistant tool calls in order, their results by id, the subagent each call came
 * from (parent_tool_use_id) and the message timestamps, counted in seconds from the first.
 */
export function claudeCodeTimeline(lines) {
  const events = lines.filter(line => line && typeof line === 'object');
  const start = Date.parse(events.find(line => line.timestamp)?.timestamp || '');
  const results = new Map();
  for (const line of events.filter(item => item.type === 'user')) for (const part of line.message?.content || []) if (part?.type === 'tool_result') results.set(part.tool_use_id, part);
  const agents = new Map(events.filter(line => line.type === 'system' && line.subtype === 'task_started').map(line => [line.tool_use_id, safe(line.subagent_type) || 'subagent']));
  const lanes = new Map([['main', { id: 'main', label: 'Main session', steps: [] }]]);
  for (const line of events.filter(item => item.type === 'assistant')) {
    const laneId = line.parent_tool_use_id || 'main';
    if (!lanes.has(laneId)) lanes.set(laneId, { id: `agent-${lanes.size}`, label: agents.get(laneId) || 'Subagent', steps: [] });
    const at = Number.isFinite(start) && line.timestamp ? Math.max(0, Math.round((Date.parse(line.timestamp) - start) / 1000)) : null;
    for (const part of line.message?.content || []) {
      if (part?.type !== 'tool_use' || typeof part.name !== 'string') continue;
      const mousa = /^mcp__plugin_mousa_mousa__([a-z_]+)$/u.exec(part.name)?.[1];
      const result = results.get(part.id);
      const args = part.input && typeof part.input === 'object' ? part.input : {};
      if (mousa) {
        push(lanes.get(laneId), { at, tool: `mousa:${mousa}`, ...(safe(DETAIL[mousa]?.(args)) ? { detail: DETAIL[mousa](args) } : {}), ...outcome(resultText(result?.content), result?.is_error) });
      } else {
        const tool = KINDS[part.name] || (part.name.startsWith('mcp__') ? 'other tool' : safe(part.name.toLowerCase()) || 'other tool');
        const detail = part.name === 'Skill' ? safe(args.skill) : part.name === 'Agent' || part.name === 'Task' ? safe(args.subagent_type) : null;
        push(lanes.get(laneId), { at, tool, ...(detail ? { detail } : {}), status: result?.is_error ? 'error' : 'ok' });
      }
    }
  }
  return summarize([...lanes.values()]);
}

/** A Codex exec --json session: its completed items in order. Codex's stream records no time. */
export function codexTimeline(lines) {
  const lane = { id: 'main', label: 'Codex session', steps: [] };
  for (const line of lines) {
    if (line?.type !== 'item.completed' || !line.item) continue;
    const item = line.item;
    if (item.type === 'mcp_tool_call' && item.server === 'mousa' && typeof item.tool === 'string') {
      const text = resultText(item.result?.content);
      push(lane, { at: null, tool: `mousa:${item.tool}`, ...(safe(DETAIL[item.tool]?.(item.arguments || {})) ? { detail: DETAIL[item.tool](item.arguments || {}) } : {}),
        ...(item.error ? { status: 'error' } : outcome(text, item.status === 'failed')) });
    } else if (item.type === 'command_execution') push(lane, { at: null, tool: 'shell', status: item.status === 'failed' || (item.exit_code && item.exit_code !== 0) ? 'error' : 'ok' });
    else if (item.type === 'file_change') push(lane, { at: null, tool: 'write', status: item.status === 'failed' ? 'error' : 'ok' });
    else if (item.type === 'mcp_tool_call') push(lane, { at: null, tool: 'other tool', status: item.error ? 'error' : 'ok' });
  }
  return summarize([lane]);
}

/** A Kiro run of scripts/run-mobile-example-live.mjs: its recorded calls, each with the second it started at. */
export function kiroTimeline(calls) {
  const lane = { id: 'main', label: 'Kiro session', steps: [] };
  for (const call of Array.isArray(calls) ? calls : []) {
    const title = typeof call?.title === 'string' ? call.title : '';
    const mousa = /^Running: @mousa\/([a-z_]+)/u.exec(title)?.[1];
    const tool = mousa ? `mousa:${mousa}` : call.kind === 'read' || /^Reading\b/u.test(title) ? 'read' : call.kind === 'edit' || /^(?:Writing|Editing|Creating)\b/u.test(title) ? 'write' : 'other tool';
    push(lane, { at: Number.isFinite(call.at) ? call.at : null, tool, status: call.status === 'failed' ? 'error' : 'ok' });
  }
  return summarize([lane]);
}

/** Parse a JSON-lines stream, skipping lines that are not JSON. */
export function jsonLines(text) {
  return String(text || '').split(/\r?\n/u).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}
