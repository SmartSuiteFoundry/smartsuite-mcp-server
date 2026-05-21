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
  BulkCreateResponse,
  BulkUpdateResponse,
  Comment,
  FilterClause,
  ListCommentsResponse,
  ListRecordsRequest,
  ListRecordsResponse,
  SmartSuiteRecord,
  Solution,
  View,
  ViewDetail,
} from './types/smartsuite.js';

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

  // ── Internal request helper ────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.cfg.baseUrl}${path}`;
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
        const json = await res.json() as T;
        return json;
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
    const cached = this.schemaCache.get(applicationId);
    if (!opts.forceRefresh && cached && cached.expiresAt > now) {
      return cached.schema;
    }
    const schema = await this.request<ApplicationDetail>('GET', `/applications/${applicationId}/`);
    this.schemaCache.set(applicationId, {
      schema,
      expiresAt: now + this.cfg.schemaCacheTtlMs,
    });
    return schema;
  }

  clearSchemaCache(applicationId?: string): void {
    if (applicationId) {
      this.schemaCache.delete(applicationId);
    } else {
      this.schemaCache.clear();
    }
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

  async getApplication(applicationId: string): Promise<ApplicationDetail> {
    return this.getApplicationSchema(applicationId);
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

  // ── Views ──────────────────────────────────────────────────────────────────

  async listViews(applicationId: string): Promise<View[]> {
    const res = await this.request<View[] | { results?: View[]; data?: View[] }>(
      'GET',
      `/applications/${applicationId}/views/`,
    );
    if (Array.isArray(res)) return res;
    return (res as { results?: View[] }).results ?? (res as { data?: View[] }).data ?? [];
  }

  async getView(applicationId: string, viewId: string): Promise<ViewDetail> {
    return this.request<ViewDetail>('GET', `/applications/${applicationId}/views/${viewId}/`);
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
