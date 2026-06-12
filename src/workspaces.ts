import { SmartSuiteClient } from './smartSuiteClient.js';
import { Workspace } from './types/smartsuite.js';
import { Config } from './types/config.js';
import { SmartSuiteError } from './errors.js';

export interface SlimWorkspace {
  id: number;
  slug: string;
  name: string;
  solutionsCount: number | null;
  status: number | null;
  plan: string | null;
  isPrimary: boolean;
  isAllowed: boolean;
}

/** True if a workspace may be targeted given the configured allowlist. The primary is always allowed. */
export function isWorkspaceAllowed(w: Workspace, config: Config): boolean {
  if (w.slug === config.accountId) return true;
  if (config.allowedWorkspaces.length === 0) return true;
  return config.allowedWorkspaces.some(
    (a) => a === w.slug || a.toLowerCase() === w.name.toLowerCase(),
  );
}

export function slimWorkspace(w: Workspace, config: Config): SlimWorkspace {
  return {
    id: w.id,
    slug: w.slug,
    name: w.name,
    solutionsCount: w.metrics?.solutions_count ?? null,
    status: w.status ?? null,
    plan: w.plan?.category ?? w.plan?.id ?? null,
    isPrimary: w.slug === config.accountId,
    isAllowed: isWorkspaceAllowed(w, config),
  };
}

/**
 * Resolves a workspace identifier (slug or name) to its slug and enforces the
 * allowlist. Caches the /accounts/ listing to avoid a lookup on every call.
 */
export class WorkspaceResolver {
  private cache: { items: Workspace[]; expiresAt: number } | null = null;

  constructor(
    private readonly client: SmartSuiteClient,
    private readonly config: Config,
    private readonly ttlMs: number,
  ) {}

  async list(forceRefresh = false): Promise<Workspace[]> {
    const now = Date.now();
    if (!forceRefresh && this.cache && this.cache.expiresAt > now) return this.cache.items;
    const items = await this.client.listAccounts();
    this.cache = { items, expiresAt: now + this.ttlMs };
    return items;
  }

  /** Resolve a slug-or-name to a workspace slug, or throw a SmartSuiteError. */
  async resolveSlug(identifier: string): Promise<string> {
    const id = identifier.trim();
    if (!id) throw new SmartSuiteError('SMARTSUITE_VALIDATION_ERROR', 'workspace must be a non-empty slug or name');

    const items = await this.list();

    let match = items.find((w) => w.slug === id);
    if (!match) {
      const byName = items.filter((w) => w.name.toLowerCase() === id.toLowerCase());
      if (byName.length > 1) {
        throw new SmartSuiteError(
          'SMARTSUITE_VALIDATION_ERROR',
          `Workspace name "${identifier}" is ambiguous (${byName.length} matches); pass the slug instead.`,
        );
      }
      match = byName[0];
    }

    if (!match) {
      throw new SmartSuiteError(
        'SMARTSUITE_NOT_FOUND',
        `Workspace "${identifier}" not found among accessible workspaces. Use smartsuite_list_workspaces to see options.`,
      );
    }

    if (!isWorkspaceAllowed(match, this.config)) {
      throw new SmartSuiteError(
        'SMARTSUITE_PERMISSION_DENIED',
        `Workspace "${match.name}" (${match.slug}) is not permitted by SMARTSUITE_ALLOWED_WORKSPACES.`,
      );
    }

    return match.slug;
  }
}
