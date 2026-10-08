/**
 * The repository as the documentation tools see it: the files git tracks plus the new files it
 * does not ignore, read once and cached, and the parsed Markdown documents.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { IGNORED_DIRS } from './config.mjs';
import { parseMarkdown } from './md.mjs';

export class Repo {
  constructor(root) {
    this.root = root;
    this.cache = new Map();
    this.docs = new Map();
  }

  /** Every file in the working tree that git tracks or would track, as repository-relative paths. */
  files() {
    if (!this.list) {
      const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: this.root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      this.list = [...new Set(out.split('\0'))]
        .filter((p) => p && !IGNORED_DIRS.some((d) => p === d || p.startsWith(`${d}/`)))
        .filter((p) => existsSync(join(this.root, p)))
        .sort();
      this.dirs = new Set();
      for (const p of this.list) for (let d = dirname(p); d !== '.'; d = dirname(d)) this.dirs.add(d);
    }
    return this.list;
  }

  /** The files whose path matches the regular expression. */
  match(re) {
    return this.files().filter((p) => re.test(p));
  }

  /** Every Markdown file. */
  markdown() {
    return this.match(/\.md$/);
  }

  /** A file or directory exists in the working tree (outside ignored directories). */
  exists(path) {
    const p = normalize(path).replace(/\/$/, '');
    if (p.startsWith('..') || IGNORED_DIRS.some((d) => p === d || p.startsWith(`${d}/`))) return false;
    this.files();
    return this.list.includes(p) || this.dirs.has(p) || p === '.';
  }

  /** The text of a file, or null when it does not exist. */
  read(path) {
    if (!this.cache.has(path)) {
      const abs = join(this.root, path);
      this.cache.set(path, existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, 'utf8') : null);
    }
    return this.cache.get(path);
  }

  /** The parsed Markdown document at this path, or null. */
  doc(path) {
    if (!this.docs.has(path)) {
      const text = this.read(path);
      this.docs.set(path, text === null ? null : parseMarkdown(text));
    }
    return this.docs.get(path);
  }

  /** Writes a file (LF line endings) and updates the cache. */
  write(path, text) {
    const abs = join(this.root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    this.cache.set(path, text);
    this.docs.delete(path);
    this.files();
    if (!this.list.includes(path)) {
      this.list.push(path);
      this.list.sort();
      for (let d = dirname(path); d !== '.'; d = dirname(d)) this.dirs.add(d);
    }
  }
}
