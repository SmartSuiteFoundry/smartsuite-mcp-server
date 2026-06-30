import fs from 'node:fs';
import path from 'node:path';
import { SmartSuiteError } from '../errors.js';
import { MigrationMappings, SchemaDiff } from './types.js';

/** Sanitize a project name into a safe single path segment (no traversal). */
export function projectSlug(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new SmartSuiteError('SMARTSUITE_VALIDATION_ERROR', 'project name must contain at least one alphanumeric character');
  return slug;
}

/** Absolute directory for a migration project under the configured base dir. */
export function projectDir(baseDir: string, name: string): string {
  return path.join(baseDir, '.smartsuite-migrations', projectSlug(name));
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

const MAPPINGS_FILE = 'mappings.json';
const DIFF_FILE = 'diff.json';

export function mappingsPath(baseDir: string, name: string): string {
  return path.join(projectDir(baseDir, name), MAPPINGS_FILE);
}

export function diffPath(baseDir: string, name: string): string {
  return path.join(projectDir(baseDir, name), DIFF_FILE);
}

export function loadMappings(baseDir: string, name: string): MigrationMappings | null {
  const p = mappingsPath(baseDir, name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as MigrationMappings;
  } catch (e) {
    throw new SmartSuiteError('SMARTSUITE_API_ERROR', `Could not read mappings for project "${name}": ${(e as Error).message}`);
  }
}

export function saveMappings(baseDir: string, name: string, mappings: MigrationMappings): string {
  const dir = projectDir(baseDir, name);
  ensureDir(dir);
  const p = path.join(dir, MAPPINGS_FILE);
  fs.writeFileSync(p, JSON.stringify(mappings, null, 2) + '\n');
  return p;
}

export function loadDiff(baseDir: string, name: string): SchemaDiff | null {
  const p = diffPath(baseDir, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as SchemaDiff;
}

export function saveDiff(baseDir: string, name: string, diff: SchemaDiff): string {
  const dir = projectDir(baseDir, name);
  ensureDir(dir);
  const p = path.join(dir, DIFF_FILE);
  fs.writeFileSync(p, JSON.stringify(diff, null, 2) + '\n');
  return p;
}
