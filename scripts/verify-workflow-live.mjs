import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin = process.env.STUDIO_URL || 'http://127.0.0.1:8787';
async function api(path, body) { const response = await fetch(origin + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result; }
await fs.mkdir('output', { recursive: true });
if (process.argv.includes('--plan')) {
  const workspace = await api('/api/workspaces', { name: 'Neighborhood producer · creative directions', templateId: 'local-food', brief: 'An English-language website for a neighborhood food producer. Preserve existing products, prices, search, filters and the sample order list. Make seasonal production visible. Propose three original directions that consider the two sample taste groups and the simple brand character. These references are supplied examples, not researched customer data. Do not invent customers, sales figures or reviews.', cultureBrief: { brand: { notes: 'Gather brand: local, simple, warm and trustworthy. Use an original SVG logo. Preserve product functionality.', protectedFiles: ['app.js'], protectedSnippets: [] }, audiences: [{ id: 'a1', label: 'Quiet discovery', references: ['Paterson', 'Nujabes', 'Muji'] }, { id: 'a2', label: 'Shared discovery', references: ['Chef', 'Khruangbin'] }] } });
  const result = await api('/api/jobs', { workspaceId: workspace.id, kind: 'plan', mode: 'baseline', protocol: 'research' });
  await fs.writeFile('output/workflow-live.json', JSON.stringify({ workspaceId: workspace.id, planJobId: result.id }, null, 2)); console.log(JSON.stringify({ workspaceId: workspace.id, planJobId: result.id }));
} else {
  const saved = JSON.parse(await fs.readFile('output/workflow-live.json', 'utf8'));
  const plan = await api('/api/jobs/' + saved.planJobId);
  if (process.argv.includes('--build')) {
    assert.equal(plan.status, 'completed'); assert.equal(plan.runs[0].directions.length, 3);
    const result = await api('/api/jobs', { workspaceId: saved.workspaceId, kind: 'build', mode: 'baseline', planJobId: plan.id, planMode: 'baseline', directionId: plan.runs[0].directions[0].id, audienceId: 'a1' });
    saved.buildJobId = result.id; await fs.writeFile('output/workflow-live.json', JSON.stringify(saved, null, 2)); console.log(JSON.stringify({ buildJobId: result.id }));
  } else if (process.argv.includes('--revise')) {
    const sourceJobId = saved.buildJobId || 'a97bd14c-19e7-4c66-866d-f7fc3d1bb988';
    const source = await api('/api/jobs/' + sourceJobId); assert.equal(source.status, 'completed');
    const selector = process.argv.find(arg => arg.startsWith('--target='))?.slice(9) || '#craft';
    const result = await api('/api/jobs', { workspaceId: saved.workspaceId, templateId: 'local-food', kind: 'revise', mode: 'baseline', parentJobId: sourceJobId, parentMode: 'baseline', targetSelector: selector, brief: 'Make only the selected section a more distinctive, warm and original visual composition. Preserve existing information and every existing element ID. Keep all copy in English. Do not add customer claims, reviews or technical explanations. Keep all other sections and functionality unchanged.' });
    saved.revisionJobId = result.id; await fs.writeFile('output/workflow-live.json', JSON.stringify(saved, null, 2)); console.log(JSON.stringify({ revisionJobId: result.id, target: selector }));
  } else console.log(JSON.stringify({ plan: { id: plan.id, status: plan.status, error: plan.error, directions: plan.runs[0].directions, events: plan.runs[0].events.slice(-4) }, saved }));
}
