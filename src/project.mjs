import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const extensions = new Set(['.html', '.css', '.js', '.svg', '.json', '.txt']);
export function validateProjectPath(value) {
  if (typeof value !== 'string' || value.length > 180 || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) throw new Error('Invalid project path.');
  const pieces = value.split('/');
  if (!pieces.length || pieces.some(p => !p || p === '..' || p.startsWith('.') || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(p))) throw new Error('Project paths must stay inside the site directory.');
  if (!extensions.has(path.posix.extname(value).toLowerCase())) throw new Error('Only static site files are supported.');
  return value;
}

export class FileProject {
  constructor(directory, limits = {}) { this.directory = path.resolve(directory); this.limits = { maxFiles: 30, maxFileBytes: 160000, maxProjectBytes: 1500000, ...limits }; }
  async listFiles() {
    const result = [];
    const walk = async (directory, prefix = '') => {
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        if (item.isSymbolicLink()) throw new Error('Symbolic links are not supported.');
        const relative = prefix + item.name;
        if (item.isDirectory()) await walk(path.join(directory, item.name), relative + '/');
        else if (item.isFile()) {
          validateProjectPath(relative);
          const stat = await fs.stat(path.join(directory, item.name));
          result.push({ path: relative, size: stat.size });
        }
      }
    };
    await walk(this.directory); return result.sort((a, b) => a.path.localeCompare(b.path));
  }
  async readFile(file) {
    validateProjectPath(file);
    const target = path.join(this.directory, file);
    await this.assertNoSymlinks(file);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > this.limits.maxFileBytes) throw new Error('File too large or invalid.');
    return fs.readFile(target, 'utf8');
  }
  async assertNoSymlinks(file) {
    let cursor = this.directory;
    for (const part of file.split('/')) {
      cursor = path.join(cursor, part);
      try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('Symbolic links are not supported.'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
  async writeFile(file, content) {
    validateProjectPath(file);
    if (typeof content !== 'string' || Buffer.byteLength(content) > this.limits.maxFileBytes) throw new Error('File content is too large.');
    await this.assertNoSymlinks(file);
    const files = await this.listFiles();
    const existing = files.find(f => f.path === file);
    if (!existing && files.length >= this.limits.maxFiles) throw new Error('Project file limit reached.');
    if (files.reduce((n, f) => n + f.size, 0) - (existing?.size || 0) + Buffer.byteLength(content) > this.limits.maxProjectBytes) throw new Error('Project size limit reached.');
    await fs.mkdir(path.dirname(path.join(this.directory, file)), { recursive: true });
    await fs.writeFile(path.join(this.directory, file), content, 'utf8');
    return { path: file, bytes: Buffer.byteLength(content), written: true };
  }
  async exportFiles() {
    const files = {}; for (const file of await this.listFiles()) files[file.path] = await this.readFile(file.path); return files;
  }
  async fingerprint() {
    return crypto.createHash('sha256').update(JSON.stringify(await this.exportFiles())).digest('hex');
  }
}
