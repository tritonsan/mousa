import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeCultureBrief } from './design-artifacts.mjs';

function text(value, label, max, required = true) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) || (required && !value.trim())) throw new Error(`${label} must be valid text.`);
  return value.trim();
}

export class WorkspaceStore {
  constructor(config, templates) { this.directory = path.join(config.dataDir, 'workspaces'); this.templates = templates; this.items = new Map(); this.saves = new Map(); }
  async initialize() {
    await fs.mkdir(this.directory, { recursive: true });
    for (const name of await fs.readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      try { const item = JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')); if (item.id + '.json' === name && this.templates.some(t => t.id === item.templateId)) this.items.set(item.id, item); } catch { /* incomplete local metadata is not a workspace */ }
    }
  }
  get(id) { const item = this.items.get(id); if (!item) throw Object.assign(new Error('Workspace not found.'), { status: 404 }); return structuredClone(item); }
  list() { return [...this.items.values()].map(({ id, name, templateId, updatedAt, version }) => ({ id, name, templateId, updatedAt, version })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async save(item) {
    const snapshot = JSON.stringify(item, null, 2);
    const pending = (this.saves.get(item.id) || Promise.resolve()).catch(() => {}).then(async () => {
      const file = path.join(this.directory, item.id + '.json'); await fs.writeFile(file + '.tmp', snapshot); await fs.rename(file + '.tmp', file);
    });
    this.saves.set(item.id, pending); await pending; return structuredClone(item);
  }
  async upsert(input, id) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A workspace object is required.');
    const source = input.context || input.workspace || input;
    const previous = id ? this.get(id) : null;
    if (!id && this.items.size >= 40) throw Object.assign(new Error('Workspace limit reached.'), { status: 429 });
    if (previous && input.version !== undefined && input.version !== previous.version) throw Object.assign(new Error('The workspace has changed. Reload its latest version.'), { status: 409 });
    const templateId = source.templateId || source.product?.templateId || previous?.templateId;
    if (!this.templates.some(t => t.id === templateId)) throw new Error('Choose a valid starter site.');
    const brief = text(source.brief ?? source.product?.brief ?? previous?.brief, 'Brief', 3500);
    if (brief.length < 10) throw new Error('The brief must contain at least 10 characters.');
    const name = text(source.name ?? source.product?.name ?? previous?.name ?? this.templates.find(t => t.id === templateId).name, 'Workspace name', 120);
    const context = source.cultureBrief ?? ((source.brand || source.audiences || source.creativeContext || source.researchDecisions || source.webSources || source.importedResearch) ? { brand: source.brand, audiences: source.audiences, creativeContext: source.creativeContext, researchDecisions: source.researchDecisions, webSources: source.webSources, evidence: source.evidence, importedResearch: source.importedResearch } : previous?.cultureBrief || {});
    const cultureBrief = normalizeCultureBrief(context, { templateId, brief });
    const now = new Date().toISOString();
    const item = { id: previous?.id || crypto.randomUUID(), name, templateId, brief, cultureBrief, createdAt: previous?.createdAt || now, updatedAt: now, version: (previous?.version || 0) + 1, selectedVariant: previous?.selectedVariant || null };
    this.items.set(item.id, item); return this.save(item);
  }
  async select(id, selection) { const item = this.get(id); item.selectedVariant = selection; item.updatedAt = new Date().toISOString(); item.version++; this.items.set(id, item); return this.save(item); }
}
