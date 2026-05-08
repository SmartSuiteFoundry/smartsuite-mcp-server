import { Logger } from '../logger.js';

export interface AuditEvent {
  tool: string;
  accountId: string;
  applicationId?: string;
  recordId?: string;
  recordIds?: string[];
  mode: string;
  fieldSlugs?: string[];
  success: boolean;
  errorCode?: string | null;
}

export function writeAudit(logger: Logger, event: AuditEvent): void {
  logger.info('audit', {
    timestamp: new Date().toISOString(),
    source: 'smartsuite-mcp',
    ...event,
  });
}
