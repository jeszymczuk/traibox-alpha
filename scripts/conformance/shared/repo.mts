import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function posixPath(value: string): string {
  return value.split(sep).join('/');
}

export function repoPath(root: string, path: string): string {
  return resolve(root, path);
}

export function relativeRepoPath(root: string, path: string): string {
  return posixPath(relative(root, path));
}

export function readText(root: string, path: string): string {
  return readFileSync(repoPath(root, path), 'utf8').replaceAll('\r\n', '\n');
}

export function readJson<T>(root: string, path: string): T {
  return JSON.parse(readText(root, path)) as T;
}

export function parseYamlText(text: string, source: string): unknown {
  const document = parseDocument(text, { strict: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`${source}: ${document.errors.map((error) => error.message).join('; ')}`);
  }
  return document.toJS({ maxAliasCount: 0 });
}

export function readYaml(root: string, path: string): unknown {
  return parseYamlText(readText(root, path), path);
}

export function walkFiles(root: string, directory: string, predicate: (path: string) => boolean = () => true): string[] {
  const absoluteDirectory = repoPath(root, directory);
  if (!existsSync(absoluteDirectory)) return [];
  const files: string[] = [];
  const visit = (absolutePath: string) => {
    for (const entry of readdirSync(absolutePath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(absolutePath, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) {
        const path = relativeRepoPath(root, child);
        if (predicate(path)) files.push(path);
      }
    }
  };
  visit(absoluteDirectory);
  return files;
}

export function pathExists(root: string, reference: string): boolean {
  const path = reference.split('#', 1)[0]!;
  return path.length > 0 && existsSync(repoPath(root, path));
}

export function isDirectory(root: string, path: string): boolean {
  return existsSync(repoPath(root, path)) && statSync(repoPath(root, path)).isDirectory();
}

export function fingerprint(...parts: Array<string | number | undefined>): string {
  const normalized = parts.map((part) => String(part ?? '').trim().replace(/\s+/g, ' ')).join('\u0000');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function getAtPath(value: unknown, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}
