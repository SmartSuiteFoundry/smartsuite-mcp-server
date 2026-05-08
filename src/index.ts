#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { SmartSuiteClient } from './smartSuiteClient.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    process.stderr.write(`[smartsuite-mcp] config error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const logger = createLogger(config);
  const client = new SmartSuiteClient(
    {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      accountId: config.accountId,
      requestTimeoutMs: config.requestTimeoutMs,
      retryCount: config.retryCount,
      schemaCacheTtlMs: config.schemaCacheTtlMs,
    },
    logger,
  );

  const server = createServer({ config, logger, client });
  await server.startStdio();
}

main().catch((err) => {
  process.stderr.write(`[smartsuite-mcp] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
