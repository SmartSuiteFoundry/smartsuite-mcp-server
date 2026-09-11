/** P14-P17: AI field agents. */
import { client, ctx, P, sleep, state, record, step, save } from './runner.mjs';
import { handleCreateField, handleUpdateField, handleDescribeField } from '../../dist/tools/fields.js';
import { handleListAutomationCredentials } from '../../dist/tools/automations.js';
import fs from 'node:fs';

const prior = JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url)));
state.solutionId = prior.solutionId;
for (const a of await client.listApplications(state.solutionId)) state.apps[a.name] = a.id;
const FD = state.apps['Findings'];
const slugOf = (r) => r.field?.slug ?? r.slug;
const agentOf = async (slug) => (await client.getApplication(FD, { forceRefresh: true }))
  .structure.find((f) => f.slug === slug)?.params?.ai_agent;
console.log(`resuming in solution ${state.solutionId}`);

const desc = (await client.getApplication(FD, { forceRefresh: true })).structure.find((f) => f.label === 'Description')?.slug;

// ── P14: classification agent that fills itself in ────────────────────────────
await step('P14', 'Classification agent with field references, running automatically', async () => {
  const r = P(await handleCreateField({ applicationId: FD, fieldType: 'singleselectfield',
    label: 'Root cause',
    params: { choices: [{label:'People'},{label:'Process'},{label:'Technology'},{label:'Third party'}] },
    aiPrompt: `Read {{${desc}}} and pick one of: People, Process, Technology, Third party.`,
    confirm: true }, ctx));
  if (r.error) return record('P14', 'AI classification field', 'FAIL', r.error.message.slice(0,140));
  const slug = slugOf(r);
  state.fields.rootCause = slug;
  await sleep(3000);
  const ag = await agentOf(slug);
  if (!ag) return record('P14', 'AI classification field', 'FAIL', 'field created but no ai_agent on it');
  // Real AI fields carry: enabled, instructions, enable_internet_search, run_automatically, model.
  const pills = JSON.stringify(ag.instructions ?? {}).includes(desc);
  record('P14a', 'prompt embeds live field references (pills)', pills ? 'PASS' : 'FAIL',
    pills ? 'description referenced as a pill, not typed text' : 'no field reference found in the instructions doc');
  record('P14b', 'agent set to run automatically', ag.run_automatically === true ? 'PASS' : 'FAIL',
    `ai_agent keys present: ${Object.keys(ag).join(', ')} | run_automatically=${JSON.stringify(ag.run_automatically)}`);
  record('P14c', 'agent has a model credential (without one it cannot run)',
    typeof ag.model === 'string' && ag.model.startsWith('cred:') ? 'PASS' : 'FAIL',
    `model=${JSON.stringify(ag.model)} — real AI fields carry a "cred:<uuid>" reference`);
  save();
});

// ── P15: web research agent ───────────────────────────────────────────────────
await step('P15', 'Web research agent (internet search must actually be on)', async () => {
  const r = P(await handleCreateField({ applicationId: FD, fieldType: 'textareafield',
    label: 'Latest regulatory update',
    aiPrompt: `In two sentences, summarise the most recent guidance relevant to {{${desc}}}, with a source link.`,
    confirm: true }, ctx));
  if (r.error) return record('P15', 'web research agent', 'FAIL', r.error.message.slice(0,140));
  await sleep(2500);
  const ag = await agentOf(slugOf(r));
  record('P15', 'internet search enabled on the field',
    ag?.enable_internet_search === true ? 'PASS' : 'FAIL',
    `enable_internet_search=${JSON.stringify(ag?.enable_internet_search)} — the prompt asks for a source link, so with search off the agent can only invent one`);
  save();
});

// ── P15b: can the caller set these explicitly? ────────────────────────────────
await step('P15b', 'ai_agent settings passed explicitly are honoured', async () => {
  const creds = P(await handleListAutomationCredentials({ solutionId: state.solutionId }, ctx));
  const credList = creds.credentials ?? creds.items ?? [];
  const r = P(await handleCreateField({ applicationId: FD, fieldType: 'textareafield', label: 'Explicit agent settings',
    params: { ai_agent: { run_automatically: true, enable_internet_search: true } },
    aiPrompt: `Summarise {{${desc}}}.`, confirm: true }, ctx));
  if (r.error) return record('P15b', 'explicit ai_agent settings', 'FAIL', r.error.message.slice(0,140));
  await sleep(2500);
  const ag = await agentOf(slugOf(r));
  const ok = ag?.run_automatically === true && ag?.enable_internet_search === true;
  record('P15b', 'explicit ai_agent settings survive the write', ok ? 'PASS' : 'FAIL',
    `run_automatically=${JSON.stringify(ag?.run_automatically)}, enable_internet_search=${JSON.stringify(ag?.enable_internet_search)}; credentials listable: ${credList.length}`);
  save();
});

// ── P16: change an agent's instructions, keep its settings ────────────────────
await step('P16', "Change an agent's prompt without resetting its settings", async () => {
  const slug = state.fields.rootCause;
  if (!slug) return record('P16', 'update agent prompt', 'BLOCKED', 'no AI field from P14');
  // Seed settings the update must preserve.
  await handleUpdateField({ applicationId: FD, slug,
    params: { ai_agent: { run_automatically: true, enable_internet_search: true } }, confirm: true }, ctx);
  await sleep(3000);
  const before = await agentOf(slug);
  const upd = P(await handleUpdateField({ applicationId: FD, slug,
    aiPrompt: `At most three bullets. Classify {{${desc}}} as People, Process, Technology or Third party.`,
    confirm: true }, ctx));
  await sleep(3000);
  const after = await agentOf(slug);
  const changed = JSON.stringify(after?.instructions) !== JSON.stringify(before?.instructions);
  const kept = after?.run_automatically === before?.run_automatically
            && after?.enable_internet_search === before?.enable_internet_search;
  record('P16', 'prompt replaced, other agent settings preserved',
    upd.error ? 'FAIL' : changed && kept ? 'PASS' : 'PARTIAL',
    upd.error ? upd.error.message.slice(0,120)
      : `instructions changed: ${changed}; run_automatically/internet_search preserved: ${kept} (before ${before?.run_automatically}/${before?.enable_internet_search}, after ${after?.run_automatically}/${after?.enable_internet_search})`);
  save();
});

// ── P17: an agent field on a dashboard is only as complete as the agent ───────
await step('P17', 'Chart on an agent field reports its own incompleteness', async () => {
  const slug = state.fields.rootCause;
  const recs = (await client.listRecords(FD, { limit: 50 })).items ?? [];
  const classified = recs.filter((r) => r[slug] != null && r[slug] !== '').length;
  record('P17', 'unclassified records are countable before charting', 'PASS',
    `${classified}/${recs.length} findings classified by the agent — a chart built now would show ${classified}. Whether the assistant SAYS so is dimension A.`);
  record('P17-A', 'assistant discloses the unclassified remainder', 'N/A-A', 'needs a connector session');
  save();
});

console.log('\n--- phase 4 complete ---');
save();
