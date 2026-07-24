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

  /**
   * Fetch a single automation by id. Uses the GetAutomation RPC, which — unlike ListAutomations —
   * still succeeds when a solution contains an action type that breaks the bulk JSON serializer
   * (e.g. the AI "ai-custom-prompt" action makes ListAutomations 500 for the whole solution).
   */
  async getAutomation(automationId: string, solutionId: string): Promise<Automation | null> {
    const res = await this.requestUrl<{ automation?: Automation }>(
      'POST',
      `${this.rpcOrigin}/smartsuite.automation_engine.engine.Automations/GetAutomation`,
      { automation_id: automationId, solution_id: solutionId },
    );
    return res?.automation ?? null;
  }

  /** Origin for the engine RPCs (host root, not the /api/v1 REST base). */
  private get rpcOrigin(): string {
    return new URL(this.cfg.baseUrl).origin;
  }

  /**
   * Account-wide automation run usage and plan, from the limits-engine RPC.
   * Returns { plan_category, limit, usage, enforceLimit }.
   */
  async getLimits(): Promise<{ plan_category?: string; limit?: number; usage?: number; enforceLimit?: boolean }> {
    return this.requestUrl('POST', `${this.rpcOrigin}/smartsuite.limits_engine.engine.Limits/GetLimits`, {});
  }

  /** List the integration credentials configured for a solution's automations. */
  async listAutomationCredentials(solutionId: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.requestUrl<{ credentials?: Array<Record<string, unknown>> }>(
      'POST',
      `${this.rpcOrigin}/smartsuite.automation_engine.engine.Automations/ListCredentials`,
      { solution_id: solutionId },
    );
    return res?.credentials ?? [];
  }

  /** Resolve a trigger's full schema (label, inputs+options, outputs, exposed fields, condition fields). */
  async describeAutomationTrigger(trigger: unknown, solutionId: string): Promise<Record<string, unknown>> {
    const res = await this.requestUrl<{ trigger?: Record<string, unknown> }>(
      'POST',
      `${this.rpcOrigin}/smartsuite.automation_engine.engine.Automations/DynamicTriggerDescription`,
      { trigger, solution_id: solutionId },
    );
    return res?.trigger ?? (res as Record<string, unknown>);
  }

  /** Resolve an action's full schema (label, inputs+options, authentication). */
  async describeAutomationAction(action: unknown, solutionId: string): Promise<Record<string, unknown>> {
    const res = await this.requestUrl<{ action?: Record<string, unknown> }>(
      'POST',
      `${this.rpcOrigin}/smartsuite.automation_engine.engine.Automations/DynamicActionDescription`,
      { action, solution_id: solutionId },
    );
    return res?.action ?? (res as Record<string, unknown>);
  }

  /**
   * Create an automation. Body is `{automation:{solution_id, label, trigger, action_groups, ...}}`.
   * `automatic_description` and `timezone` are optional (verified 2026-06-14). Returns `{automation_id, first_created}`.
   */
  async createAutomation(automation: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.requestUrl(
      'POST',
      `${this.rpcOrigin}/smartsuite.automation_engine.engine.Automations/CreateAutomation`,
      { automation },
    );
  }

  /**
   * Update an automation. The body's `automation` must carry `automation_id`, `solution_id`, and the
   * existing `first_created`, alongside the full trigger + action_groups. Returns `{last_updated, system_status}`.
   */
  async updateAutomation(automation: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.requestUrl(
      'POST',
      `${this.rpcOrigin}/smartsuite.automation_engine.engine.Automations/UpdateAutomation`,
      { automation },
    );
  }

  /** Delete an automation by id (scoped to its solution). Returns `{}` on success. */
  async deleteAutomation(automationId: string, solutionId: string): Promise<void> {
    await this.requestUrl(
      'POST',
      `${this.rpcOrigin}/smartsuite.automation_engine.engine.Automations/DeleteAutomation`,
      { automation_id: automationId, solution_id: solutionId },
    );
  }

  /** List the members available to a solution (used by automations for assignees/credentials). */
  async listSolutionMembers(solutionId: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.requestUrl<{ members?: Array<Record<string, unknown>> }>(
      'POST',
      `${this.rpcOrigin}/smartsuite.automation_engine.engine.Automations/ListSolutionTeamsAndMembers`,
      { solution_id: solutionId },
    );
    return res?.members ?? [];
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

  /** Create a solution. Minimal body {name}; server fills slug, default logo, and private permissions. */
  async createSolution(body: Record<string, unknown>): Promise<Solution> {
    return this.request<Solution>('POST', '/solutions/', body);
  }

  /** Create a table (application). `structure` is required by the API; [] auto-creates the default title field. */
  async createApplication(body: Record<string, unknown>): Promise<ApplicationDetail> {
    return this.request<ApplicationDetail>('POST', '/applications/', { structure: [], ...body });
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
    opts: { autoFillLayout?: boolean } = {},
  ): Promise<unknown> {
    const result = await this.request<unknown>('POST', `/applications/${applicationId}/add_field/`, {
      field: { ...field, is_new: true },
      field_position: { prev_sibling_slug: prevSiblingSlug },
      // Place the new field in the record-view layout (otherwise it exists but isn't displayed).
      auto_fill_structure_layout: opts.autoFillLayout !== false,
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

  /** Restore a soft-deleted field back into an application. POST /applications/{id}/restore_field/ {slug}. */
  async restoreField(applicationId: string, slug: string): Promise<unknown> {
    const result = await this.request<unknown>('POST', `/applications/${applicationId}/restore_field/`, { slug });
    this.clearSchemaCache(applicationId);
    return result;
  }

  /** List soft-deleted fields across a solution. POST /applications/deleted_fields/ → bare array of {slug,label,field_type,params}. */
  async listDeletedFields(solutionId: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.request<Array<Record<string, unknown>>>('POST', '/applications/deleted_fields/', { solution_id: solutionId });
    return Array.isArray(res) ? res : [];
  }

  /** List soft-deleted applications in a solution. POST /applications/deleted_applications/ → bare array. */
  async listDeletedApplications(solutionId: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.request<Array<Record<string, unknown>>>('POST', '/applications/deleted_applications/', { solution_id: solutionId });
    return Array.isArray(res) ? res : [];
  }

  /**
   * Replace an application's record-view layout. PATCH /applications/{id}/ with the full
   * `structure_layout` (read-modify-write — send the whole object so nothing is dropped).
   * Returns the updated ApplicationDetail.
   */
  async updateApplicationLayout(applicationId: string, structureLayout: unknown): Promise<ApplicationDetail> {
    const result = await this.request<ApplicationDetail>('PATCH', `/applications/${applicationId}/`, { structure_layout: structureLayout });
    this.clearSchemaCache(applicationId);
    return result;
  }

  /** Update application-level attributes (e.g. name, record_term). PATCH /applications/{id}/. */
  async updateApplication(applicationId: string, patch: Record<string, unknown>): Promise<ApplicationDetail> {
    const result = await this.request<ApplicationDetail>('PATCH', `/applications/${applicationId}/`, patch);
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

  /** Restore a soft-deleted record from the trash. POST /applications/{id}/records/{recordId}/restore/. */
  async restoreRecord(applicationId: string, recordId: string): Promise<SmartSuiteRecord> {
    return this.request<SmartSuiteRecord>('POST', `/applications/${applicationId}/records/${recordId}/restore/`, {});
  }

  /**
   * List soft-deleted records across a solution's trash. POST /deleted-records/paginated/.
   * Solution-scoped (spans all applications). Returns { count, records, next_cursor }.
   */
  async listDeletedRecords(
    solutionId: string,
    opts: { pageSize?: number; fields?: string[]; cursor?: string } = {},
  ): Promise<{ count: number; records: Array<Record<string, unknown>>; next_cursor: string | null }> {
    const body: Record<string, unknown> = { solution_id: solutionId, page_size: opts.pageSize ?? 100 };
    if (opts.fields?.length) body['fields'] = opts.fields;
    if (opts.cursor) body['cursor'] = opts.cursor;
    return this.request('POST', '/deleted-records/paginated/', body);
  }

  async bulkCreateRecords(
    applicationId: string,
    records: Record<string, unknown>[],
  ): Promise<BulkCreateResponse> {
    // The bulk-create endpoint returns a bare array of the created records (not a
    // {successful_items, failed_items} envelope like bulk-update). Normalize to the envelope.
    const res = await this.request<BulkCreateResponse | SmartSuiteRecord[]>('POST', `/applications/${applicationId}/records/bulk/`, {
      items: records,
    });
    if (Array.isArray(res)) return { successful_items: res, failed_items: [] };
    return { successful_items: res?.successful_items ?? [], failed_items: res?.failed_items ?? [] };
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

  /** Fetch a single dashboard widget by ID. */
  async getWidget(widgetId: string): Promise<DashboardWidget> {
    const w = await this.request<DashboardWidget>('GET', `/dashboard/widgets/${widgetId}/`);
    return { ...w, params: parseMaybeJson(w.params) };
  }

  /** Create a dashboard widget. `params` may be passed as an object (the server accepts it). */
  async createWidget(body: Record<string, unknown>): Promise<DashboardWidget> {
    const w = await this.request<DashboardWidget>('POST', '/dashboard/widgets/', body);
    return { ...w, params: parseMaybeJson(w.params) };
  }

  /** Patch a dashboard widget (layout, name, params, etc.). Returns the updated widget. */
  async updateWidget(widgetId: string, patch: Record<string, unknown>): Promise<DashboardWidget> {
    const w = await this.request<DashboardWidget>('PATCH', `/dashboard/widgets/${widgetId}/`, patch);
    return { ...w, params: parseMaybeJson(w.params) };
  }

  /** Delete a dashboard widget by ID. */
  async deleteWidget(widgetId: string): Promise<void> {
    await this.request<void>('DELETE', `/dashboard/widgets/${widgetId}/`);
  }

  // ── Reports (forms, views, dashboards) ───────────────────────────────────────

  /** Suggest a default (deduped) report label for an application. */
  async generateReportLabel(applicationId: string, label: string): Promise<string> {
    const res = await this.request<{ label?: string }>('POST', '/reports/generate_label/', { application: applicationId, label });
    return res?.label ?? label;
  }

  /** Check whether a report label is unique within an application. */
  async validateReportLabel(applicationId: string, label: string): Promise<boolean> {
    const res = await this.request<{ is_unique?: boolean }>('POST', '/reports/validate_label/', { application: applicationId, label });
    return res?.is_unique ?? false;
  }

  /** Create a report. A minimal body ({application, solution, label, view_mode}) is accepted; the server fills defaults. */
  async createReport(body: Record<string, unknown>): Promise<Report> {
    return this.request<Report>('POST', '/reports/', body);
  }

  /** Fetch a single report by ID. */
  async getReport(reportId: string): Promise<Report> {
    return this.request<Report>('GET', `/reports/${reportId}/`);
  }

  /** Patch a report (e.g. form_state). Uses return_data=false → empty 200 body. */
  async updateReport(reportId: string, patch: Record<string, unknown>): Promise<void> {
    await this.request<void>('PATCH', `/reports/${reportId}/?return_data=false`, patch);
  }

  /** Delete a report by ID. */
  async deleteReport(reportId: string): Promise<void> {
    await this.request<void>('DELETE', `/reports/${reportId}/`);
  }

  /**
   * Submit a form — creates a record through the form's submission pipeline
   * (applying form logic), exactly as a user filling out the form would.
   * `values` are keyed by field slug, using the same value shapes as record create.
   */
  async submitForm(formId: string, values: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>('POST', `/forms/internal/${formId}/create_record/`, values);
  }

  // ── My Work (assigned tasks) ──────────────────────────────────────────────────

  /**
   * Fetch the authenticated user's My Work items. `resolved=false` (unresolved/open)
   * returns a bare array; `resolved=true` returns an envelope { items, count } where
   * `count` holds per-period totals. Both are normalized to { items, count? } here.
   * `period` (today|this_week|this_month|previous_month|last_year) filters the items.
   */
  async getMyWork(
    resolved: boolean,
    period?: string,
  ): Promise<{ items: Array<Record<string, unknown>>; count?: Record<string, number> }> {
    const path = resolved ? '/my-work/resolved/' : '/my-work/unresolved/';
    const qs = period ? `?period=${encodeURIComponent(period)}` : '';
    const res = await this.request<unknown>('GET', `${path}${qs}`);
    if (Array.isArray(res)) return { items: res as Array<Record<string, unknown>> };
    const env = (res ?? {}) as { items?: Array<Record<string, unknown>>; count?: Record<string, number> };
    return { items: env.items ?? [], count: env.count };
  }

  /** Update a My Work item's status and/or due date. Returns the updated item. */
  async updateMyWork(itemId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('PATCH', `/my-work/${itemId}/`, patch);
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
