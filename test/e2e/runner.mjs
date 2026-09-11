/**
 * Compliance MCP Test Sequence — executable harness.
 *
 * Drives the MCP tool handlers through the sequence in mcp-test-prompt-sequence.html and
 * asserts each prompt's "Pass when" / "Watch for" criteria. Dimension B only: whether the
 * tools do the thing, not whether an assistant would pick them (see PLAN.md).
 *
 * Usage:  node test/e2e/runner.mjs [--only P00,P01] [--keep]
 *   --keep  leave the scratch solution in place for inspection
 */
import { SmartSuiteClient } from '../../dist/smartSuiteClient.js';
import fs from 'node:fs';

const log = { info(){}, warn(){}, error(){}, debug(){} };
const client = new SmartSuiteClient({
  baseUrl: 'https://app.smartsuite.com/api/v1',
  apiKey: process.env.SMARTSUITE_API_KEY,
  accountId: process.env.SMARTSUITE_ACCOUNT_ID,
  requestTimeoutMs: 60000, retryCount: 3, schemaCacheTtlMs: 0,
}, log);
const ctx = {
  // Mirror the real config surface exactly. An incomplete ctx produces phantom failures —
  // omitting allowedSolutions made list_applications throw "Cannot read properties of
  // undefined (reading 'length')", which reads exactly like a server bug and is not one.
  config: { mode: 'admin', accountId: process.env.SMARTSUITE_ACCOUNT_ID, enableSchemaWrite: true,
            enableDelete: true, enableRestore: true, enableSmartDocWrite: true,
            enableCrossWorkspace: false, maxRecords: 100, maxBatchWrites: 25,
            allowedSolutions: [], allowedApplications: [], deniedApplications: [],
            allowedWorkspaces: [] },
  logger: log, client,
};

const P = (r) => JSON.parse(r.content[0].text);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only='))||'').split('=')[1]?.split(',');
const keep = args.includes('--keep');

const results = [];
const state = { solutionId: null, apps: {}, fields: {}, records: {}, views: {}, dashboards: {} };

function record(id, title, status, notes, evidence) {
  results.push({ id, title, status, notes, evidence: evidence ?? null, at: new Date().toISOString() });
  const icon = { PASS:'PASS ', PARTIAL:'PART ', FAIL:'FAIL ', BLOCKED:'BLOCK', 'N/A-A':'N/A-A' }[status] ?? status;
  console.log(`  [${icon}] ${id} ${title}${notes ? ' — ' + notes : ''}`);
}

async function step(id, title, fn) {
  if (only && !only.includes(id)) return;
  const t0 = Date.now();
  console.log(`\n${id}  ${title}`);
  try {
    await fn();
  } catch (e) {
    record(id, title, 'FAIL', `threw: ${String(e.message).slice(0, 160)}`);
  }
  const last = results[results.length - 1];
  if (last) last.seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
}

/**
 * Merge into the results file rather than replacing it — each phase runs as its own process,
 * so a plain write silently discards every earlier phase's results.
 */
function save() {
  const url = new URL('./results.json', import.meta.url);
  let prior = { results: [] };
  try { prior = JSON.parse(fs.readFileSync(url, 'utf8')); } catch { /* first run */ }
  const byId = new Map((prior.results ?? []).map((r) => [r.id, r]));
  for (const r of results) byId.set(r.id, r);
  fs.writeFileSync(url, JSON.stringify({
    runAt: new Date().toISOString(),
    solutionId: state.solutionId ?? prior.solutionId ?? null,
    apps: { ...(prior.apps ?? {}), ...state.apps },
    fields: { ...(prior.fields ?? {}), ...state.fields },
    results: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }, null, 2));
}

export { client, ctx, P, sleep, state, record, step, save, keep };
