import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { buildAuthHeaders } from './auth.js';
import { SmartSuiteError, httpStatusToCode } from './errors.js';
import { Logger } from './logger.js';
import { withRetry } from './utils/retry.js';
import {
  ApplicationDetail,
  ApplicationSummary,
  FieldDefinition,
  BulkCreateResponse,
  BulkUpdateResponse,
  Comment,
  FilterClause,
  ListCommentsResponse,
  ListRecordsRequest,
  ListRecordsResponse,
  SmartSuiteRecord,
  Solution,
  Report,
  DashboardWidget,
  Workspace,
  Automation,
} from './types/smartsuite.js';

/** Widget `params` arrives as a JSON-encoded string; decode it, leaving non-strings untouched. */
function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

interface SchemaEntry {
  schema: ApplicationDetail;
  expiresAt: number;
}

interface ClientConfig {
  baseUrl: string;
  apiKey: string;
  accountId: string;
  requestTimeoutMs: number;
  retryCount: number;
  schemaCacheTtlMs: number;
}

export class SmartSuiteClient {
  private schemaCache = new Map<string, SchemaEntry>();

  constructor(
    private readonly cfg: ClientConfig,
    private readonly logger: Logger,
  ) {}

  /** The workspace slug (ACCOUNT-ID) this client is currently bound to. */
  get accountId(): string {
    return this.cfg.accountId;
  }

  /**
   * Return a client bound to a different workspace (ACCOUNT-ID), reusing the same
   * config, logger, and schema cache. Cheap — used to target a non-primary
   * workspace for a single request. The schema cache is keyed by account+app, so
   * sharing it across workspaces is safe.
   */
  withAccount(accountId: string): SmartSuiteClient {
    if (accountId === this.cfg.accountId) return this;
    const clone = new SmartSuiteClient({ ...this.cfg, accountId }, this.logger);
    clone.schemaCache = this.schemaCache;
    return clone;
  }

  // ── Internal request helper ────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.requestUrl<T>(method, `${this.cfg.baseUrl}${path}`, body);
  }

  /** Like request(), but takes a full URL — used for endpoints outside the /api/v1 REST base (e.g. the automation-engine RPC). */
  private async requestUrl<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    const path = url;
    const headers = buildAuthHeaders(this.cfg.apiKey, this.cfg.accountId);

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.cfg.requestTimeoutMs);

        let res: Response;
        try {
          res = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          });
        } catch (err) {
          clearTimeout(timer);
          if (err instanceof Error && err.name === 'AbortError') {
            throw new SmartSuiteError('SMARTSUITE_TIMEOUT', `Request timed out: ${method} ${path}`);
          }
          throw new SmartSuiteError('SMARTSUITE_API_ERROR', `Network error: ${(err as Error).message}`);
        }
        clearTimeout(timer);

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const code = httpStatusToCode(res.status);
          this.logger.warn('api error', { status: res.status, path, body: text.slice(0, 500) });
          throw new SmartSuiteError(code, `SmartSuite API error ${res.status}: ${text.slice(0, 200)}`, undefined, res.status);
        }

        if (res.status === 204) return undefined as T;
        // Some endpoints (e.g. add_field/change_field) return 200 with an empty body.
        const text = await res.text();
        if (!text) return undefined as T;
        return JSON.parse(text) as T;
      },
      { maxAttempts: this.cfg.retryCount + 1 },
    );
  }

  // ── Schema cache ───────────────────────────────────────────────────────────

  async getApplicationSchema(
    applicationId: string,
    opts: { forceRefresh?: boolean } = {},
  ): Promise<ApplicationDetail> {
    const now = Date.now();
    const cacheKey = `${this.cfg.accountId}:${applicationId}`;
    const cached = this.schemaCache.get(cacheKey);
    if (!opts.forceRefresh && cached && cached.expiresAt > now) {
      return cached.schema;
    }
    const schema = await this.request<ApplicationDetail>('GET', `/applications/${applicationId}/`);
    this.schemaCache.set(cacheKey, {
      schema,
      expiresAt: now + this.cfg.schemaCacheTtlMs,
    });
    return schema;
  }

  clearSchemaCache(applicationId?: string): void {
    if (applicationId) {
      // Keys are `${accountId}:${applicationId}`; clear this app across any workspace.
      for (const key of this.schemaCache.keys()) {
        if (key.endsWith(`:${applicationId}`)) this.schemaCache.delete(key);
      }
    } else {
      this.schemaCache.clear();
    }
  }

  // ── Workspaces (accounts) ────────────────────────────────────────────────────

  /** List every workspace the authenticated API key can access (GET /accounts/). */
  async listAccounts(): Promise<Workspace[]> {
    const res = await this.request<Workspace[] | { results?: Workspace[]; data?: Workspace[] }>('GET', '/accounts/');
    if (Array.isArray(res)) return res;
    return (res as { results?: Workspace[] }).results ?? (res as { data?: Workspace[] }).data ?? [];
  }

  // ── Automations ──────────────────────────────────────────────────────────────

  /**
   * List automations for a solution. Automations use the automation-engine RPC
   * (POST to the host root, not the /api/v1 REST base) and are scoped per solution.
   */
  async listAutomations(solutionId: string): Promise<Automation[]> {
    const origin = new URL(this.cfg.baseUrl).origin;
    const url = `${origin}/smartsuite.automation_engine.engine.Automations/ListAutomations`;
    const res = await this.requestUrl<Automation[] | { automations?: Automation[] }>(
      'POST',
      url,
      { solution_id: solutionId },
    );
    if (Array.isArray(res)) return res;
    return (res as { automations?: Automation[] }).automations ?? [];
  }

  // ── Solutions ──────────────────────────────────────────────────────────────

  async listSolutions(): Promise<Solution[]> {
    const res = await this.request<Solution[] | { results?: Solution[]; data?: Solution[] }>('GET', '/solutions/');
    if (Array.isArray(res)) return res;
    return (res as { results?: Solution[]; data?: Solution[] }).results
      ?? (res as { results?: Solution[]; data?: Solution[] }).data
      ?? [];
  }

  async getSolution(solutionId: string): Promise<Solution> {
    return this.request<Solution>('GET', `/solutions/${solutionId}/`);
  }

  // ── Applications ───────────────────────────────────────────────────────────

  async listApplications(solutionId?: string): Promise<ApplicationSummary[]> {
    const path = solutionId
      ? `/applications/?solution=${solutionId}`
      : '/applications/';
    const res = await this.request<ApplicationSummary[] | { results?: ApplicationSummary[]; data?: ApplicationSummary[] }>('GET', path);
    if (Array.isArray(res)) return res;
    return (res as { results?: ApplicationSummary[] }).results
      ?? (res as { data?: ApplicationSummary[] }).data
      ?? [];
  }

  async getApplication(
    applicationId: string,
    opts: { forceRefresh?: boolean } = {},
  ): Promise<ApplicationDetail> {
    return this.getApplicationSchema(applicationId, opts);
  }

  // ── Fields (schema writes) ───────────────────────────────────────────────────

  /**
   * Validate a formula expression without persisting anything.
   * Body wraps a (possibly minimal) field definition; only `params.formula` is
   * required. Returns `{valid, safe, warnings}` on success. The API returns HTTP
   * 400 with `{message, code}` for an invalid formula — we translate that into a
   * structured result instead of throwing so callers can show the message.
   */
  async validateFormula(
    applicationId: string,
    field: FieldDefinition,
  ): Promise<{ valid: boolean; safe?: boolean; warnings?: unknown[]; message?: string; code?: string }> {
    const url = `${this.cfg.baseUrl}/applications/${applicationId}/validate_formula/`;
    const headers = buildAuthHeaders(this.cfg.apiKey, this.cfg.accountId);
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ field }) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) {
      return {
        valid: json['valid'] === true,
        safe: json['safe'] as boolean | undefined,
        warnings: (json['warnings'] as unknown[]) ?? [],
      };
    }
    return {
      valid: false,
      message: (json['message'] as string) ?? `Validation failed (HTTP ${res.status})`,
      code: json['code'] as string | undefined,
    };
  }

  /** Add a new field. `prevSiblingSlug` positions it immediately after an existing field. */
  async addField(
    applicationId: string,
    field: FieldDefinition,
    prevSiblingSlug: string,
  ): Promise<unknown> {
    const result = await this.request<unknown>('POST', `/applications/${applicationId}/add_field/`, {
      field,
      field_position: { prev_sibling_slug: prevSiblingSlug },
    });
    this.clearSchemaCache(applicationId);
    return result;
  }

  /** Edit an existing field. Body is the full field definition (not wrapped). */
  async changeField(applicationId: string, field: FieldDefinition): Promise<unknown> {
    const result = await this.request<unknown>(
      'PUT',
      `/applications/${applicationId}/change_field/?set_is_migrating=1`,
      field,
    );
    this.clearSchemaCache(applicationId);
    return result;
  }

  /** Delete a field by slug. */
  async deleteField(applicationId: string, slug: string): Promise<unknown> {
    const result = await this.request<unknown>('POST', `/applications/${applicationId}/delete_field/`, { slug });
    this.clearSchemaCache(applicationId);
    return result;
  }

  // ── Records ────────────────────────────────────────────────────────────────

  async listRecords(
    applicationId: string,
    params: {
      filter?: FilterClause;
      sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
      ids?: string[];
      offset?: number;
      limit?: number;
    } = {},
  ): Promise<ListRecordsResponse> {
    const offset = params.offset ?? 0;
    const body: ListRecordsRequest = {
      filter: params.filter,
      sort: params.sort,
      ids: params.ids,
    };
    // Strip undefined keys
    if (!body.filter) delete body.filter;
    if (!body.sort) delete body.sort;
    if (!body.ids) delete body.ids;

    const limitParam = params.limit ? `&limit=${params.limit}` : '';
    return this.request<ListRecordsResponse>(
      'POST',
      `/applications/${applicationId}/records/list/?offset=${offset}${limitParam}`,
      body,
    );
  }

  async getRecord(applicationId: string, recordId: string): Promise<SmartSuiteRecord> {
    return this.request<SmartSuiteRecord>('GET', `/applications/${applicationId}/records/${recordId}/`);
  }

  async createRecord(applicationId: string, fields: Record<string, unknown>): Promise<SmartSuiteRecord> {
    return this.request<SmartSuiteRecord>('POST', `/applications/${applicationId}/records/`, fields);
  }

  async updateRecord(
    applicationId: string,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<SmartSuiteRecord> {
    return this.request<SmartSuiteRecord>('PATCH', `/applications/${applicationId}/records/${recordId}/`, fields);
  }

  async deleteRecord(applicationId: string, recordId: string): Promise<void> {
    await this.request<void>('DELETE', `/applications/${applicationId}/records/${recordId}/`);
  }

  async bulkCreateRecords(
    applicationId: string,
    records: Record<string, unknown>[],
  ): Promise<BulkCreateResponse> {
    return this.request<BulkCreateResponse>('POST', `/applications/${applicationId}/records/bulk/`, {
      items: records,
    });
  }

  async bulkUpdateRecords(
    applicationId: string,
    records: Array<Record<string, unknown>>,
  ): Promise<BulkUpdateResponse> {
    return this.request<BulkUpdateResponse>('PATCH', `/applications/${applicationId}/records/bulk/`, {
      items: records,
    });
  }

  async bulkDeleteRecords(applicationId: string, recordIds: string[]): Promise<void> {
    await this.request<void>('DELETE', `/applications/${applicationId}/records/bulk/`, {
      items: recordIds.map((id) => ({ id })),
    });
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  async listComments(applicationId: string, recordId: string): Promise<Comment[]> {
    const res = await this.request<ListCommentsResponse | Comment[]>(
      'GET',
      `/applications/${applicationId}/records/${recordId}/comments/`,
    );
    if (Array.isArray(res)) return res;
    const r = res as ListCommentsResponse;
    return r.data ?? r.results ?? r.items ?? [];
  }

  async createComment(
    applicationId: string,
    recordId: string,
    text: string,
  ): Promise<Comment> {
    return this.request<Comment>(
      'POST',
      `/applications/${applicationId}/records/${recordId}/comments/`,
      { message: text },
    );
  }

  // ── Views & Dashboards (reports) ─────────────────────────────────────────────

  /**
   * List all reports (views + dashboards) for an application.
   * GET /reports/?application=<id> returns a bare array; each element is a view
   * or dashboard distinguished by `view_mode`.
   */
  async listReports(applicationId: string): Promise<Report[]> {
    const res = await this.request<Report[] | { results?: Report[]; data?: Report[] }>(
      'GET',
      `/reports/?application=${applicationId}`,
    );
    if (Array.isArray(res)) return res;
    return (res as { results?: Report[] }).results ?? (res as { data?: Report[] }).data ?? [];
  }

  /**
   * List the widgets on one tab of a dashboard report.
   * GET /dashboard/widgets/?report=<reportId>&tab=<tabId> returns a bare array.
   * Each widget's `params` arrives as a JSON-encoded string; we parse it so
   * consumers get a usable object.
   */
  async listDashboardWidgets(reportId: string, tabId: string): Promise<DashboardWidget[]> {
    const res = await this.request<DashboardWidget[] | { results?: DashboardWidget[]; data?: DashboardWidget[] }>(
      'GET',
      `/dashboard/widgets/?report=${reportId}&tab=${tabId}`,
    );
    const arr = Array.isArray(res)
      ? res
      : ((res as { results?: DashboardWidget[] }).results ?? (res as { data?: DashboardWidget[] }).data ?? []);
    return arr.map((w) => ({ ...w, params: parseMaybeJson(w.params) }));
  }

  // ── Files ──────────────────────────────────────────────────────────────────

  /**
   * Resolve a Filestack handle to a signed CDN download URL.
   * The API returns a 302 redirect; we capture the Location header directly
   * rather than following it so we return the URL without downloading the file.
   */
  async getFileUrl(fileHandle: string): Promise<string> {
    const url = new URL(`${this.cfg.baseUrl}/shared-files/${fileHandle}/get_url/`);

    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'Authorization': `Token ${this.cfg.apiKey}`,
          'ACCOUNT-ID': this.cfg.accountId,
        },
      };

      const req = https.request(options, (res) => {
        res.resume(); // consume body so the socket is released
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers['location'];
          if (location) return resolve(location);
        }
        reject(new SmartSuiteError(
          'SMARTSUITE_API_ERROR',
          `Expected redirect for file handle ${fileHandle}, got HTTP ${res.statusCode}`,
          undefined,
          res.statusCode,
        ));
      });

      req.setTimeout(this.cfg.requestTimeoutMs, () => {
        req.destroy();
        reject(new SmartSuiteError('SMARTSUITE_TIMEOUT', `Timed out resolving file handle ${fileHandle}`));
      });

      req.on('error', (err) => reject(new SmartSuiteError('SMARTSUITE_API_ERROR', err.message)));
      req.end();
    });
  }

  /**
   * Upload a file from the local filesystem to a SmartSuite file field.
   * Uses multipart/form-data as required by the recordfiles endpoint.
   */
  async uploadFile(
    applicationId: string,
    recordId: string,
    fieldSlug: string,
    filePath: string,
    filename?: string,
  ): Promise<unknown> {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new SmartSuiteError('SMARTSUITE_VALIDATION_ERROR', `File not found: ${resolvedPath}`);
    }

    const fileBuffer = fs.readFileSync(resolvedPath);
    const fileName = filename ?? path.basename(resolvedPath);

    const formData = new FormData();
    formData.append('files', new Blob([fileBuffer]), fileName);

    const url = `${this.cfg.baseUrl}/recordfiles/${applicationId}/${recordId}/${fieldSlug}/`;

    // Omit Content-Type so fetch sets it automatically with the multipart boundary.
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.cfg.apiKey}`,
        'ACCOUNT-ID': this.cfg.accountId,
      },
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SmartSuiteError(
        httpStatusToCode(res.status),
        `File upload failed (${res.status}): ${text.slice(0, 200)}`,
        undefined,
        res.status,
      );
    }

    return res.json();
  }
}
