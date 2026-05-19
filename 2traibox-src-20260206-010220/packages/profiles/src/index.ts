import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ProfileSchema, type Profile } from './schema.js';

export type { Profile } from './schema.js';

export function parseProfileYaml(rawYaml: string): Profile {
  const parsed = YAML.parse(rawYaml);
  return ProfileSchema.parse(parsed);
}

export function loadProfileFromFile(profilePath: string): Profile {
  const abs = path.isAbsolute(profilePath) ? profilePath : path.join(process.cwd(), profilePath);
  const rawYaml = readFileSync(abs, 'utf8');
  return parseProfileYaml(rawYaml);
}

