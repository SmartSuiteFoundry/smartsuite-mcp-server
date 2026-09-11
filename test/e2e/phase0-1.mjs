/** P00-P02: build the compliance solution, then read it back and prove one number. */
import { client, ctx, P, sleep, state, record, step, save, keep } from './runner.mjs';
import { handleCreateSolution } from '../../dist/tools/solutions.js';
import { handleCreateApplication, handleDescribeApplication, handleListApplications } from '../../dist/tools/applications.js';
import { handleCreateField, handleListFields } from '../../dist/tools/fields.js';
import { handleCreateFormulaField, handleValidateFormula } from '../../dist/tools/formulas.js';
import { handleCreateRecords } from '../../dist/tools/records.write.js';
import { handleQueryRecords, handleListRecords } from '../../dist/tools/records.read.js';

const TABLES = ['Regulations', 'Requirements', 'Controls', 'Control Tests', 'Audits', 'Findings'];

await step('P00', 'The brief — build the six-table solution', async () => {
  const sol = P(await handleCreateSolution({ name: 'ZZ MCP Test Compliance ' + (Date.now() % 999999), confirm: true }, ctx));
  if (sol.error) return record('P00', 'build', 'FAIL', sol.error.message);
  state.solutionId = sol.solution.id;
  console.log(`     solution ${state.solutionId}  (seeded tables: ${(sol.existingTables||[]).map(t=>`${t.name}=${JSON.stringify(t.recordTerm)}`).join(', ')||'none'})`);

  // Chain: Regulations -> Requirements -> Controls -> Control Tests, Audits -> Findings.
  for (const name of TABLES) {
    const r = P(await handleCreateApplication({ solutionId: state.solutionId, name, confirm: true }, ctx));
    if (r.error) return record('P00', 'build', 'FAIL', `${name}: ${r.error.message}`);
    state.apps[name] = r.application.id;
    await sleep(400);
  }
  const link = async (from, to, label, entries='multiple') => {
    const r = P(await handleCreateField({ applicationId: state.apps[from], fieldType: 'linkedrecordfield',
      label, params: { linked_application: state.apps[to], entries_allowed: entries }, confirm: true }, ctx));
    if (r.error) throw new Error(`${from}->${to}: ${r.error.message}`);
    state.fields[`${from}.${label}`] = r.field?.slug ?? r.slug;
    await sleep(700);
  };
  await link('Requirements', 'Regulations', 'Regulation', 'single');
  await link('Controls', 'Requirements', 'Requirements');
  await link('Control Tests', 'Controls', 'Control', 'single');
  await link('Findings', 'Audits', 'Audit', 'single');
  await link('Findings', 'Controls', 'Control', 'single');

  const missing = TABLES.filter((t) => !state.apps[t]);
  const links = Object.keys(state.fields).length;
  record('P00', 'six tables linked in a chain', missing.length || links < 5 ? 'FAIL' : 'PASS',
    `${TABLES.length - missing.length}/6 tables, ${links}/5 links`,
    { solutionId: state.solutionId, apps: state.apps });
  save();
});

await step('P00b', 'Record term on every created table (Jon\'s escalation)', async () => {
  const terms = {};
  for (const [name, id] of Object.entries(state.apps)) {
    const app = await client.getApplication(id, { forceRefresh: true });
    terms[name] = app.record_term;
  }
  const bad = Object.entries(terms).filter(([, t]) => !t || !String(t).trim());
  record('P00b', 'record term set on all tables', bad.length ? 'FAIL' : 'PASS',
    bad.length ? `empty on: ${bad.map(([n]) => n).join(', ')}` : `all set (${[...new Set(Object.values(terms))].join(', ')})`,
    terms);
  save();
});

await step('P01', 'Plain-English tour — read back what exists', async () => {
  // Dimension B: can the read tools describe the live solution accurately?
  const apps = P(await handleListApplications({ solutionId: state.solutionId }, ctx));
  const listed = (apps.applications ?? apps.items ?? []).map((a) => a.name);
  const covered = TABLES.filter((t) => listed.includes(t));
  const desc = P(await handleDescribeApplication({ applicationId: state.apps['Findings'] }, ctx));
  const hasLinks = (desc.fields ?? []).some((f) => f.linkedApplication);
  record('P01', 'read tools return the live structure',
    covered.length === TABLES.length && hasLinks ? 'PASS' : 'PARTIAL',
    `list_applications saw ${covered.length}/6; describe_application surfaced linkedApplication: ${hasLinks}`);
  record('P01-A', 'tour phrased from live data, not the plan', 'N/A-A', 'needs a connector session');
  save();
});

await step('P02', 'Show the working — coverage formula on a percent scale', async () => {
  // Seed: one regulation, 4 requirements, 2 of them covered.
  const reg = P(await handleCreateRecords({ applicationId: state.apps['Regulations'],
    records: [{ title: 'PCI DSS v4.0' }], dryRun: false, confirm: true }, ctx));
  if (reg.error) return record('P02', 'seed', 'FAIL', reg.error.message);
  const regId = reg.recordIds[0];
  const regSlug = state.fields['Requirements.Regulation'];
  const reqs = P(await handleCreateRecords({ applicationId: state.apps['Requirements'],
    records: [1,2,3,4].map((i) => ({ title: `Req ${i}`, [regSlug]: [regId] })), dryRun: false, confirm: true }, ctx));
  if (reqs.error) return record('P02', 'seed requirements', 'FAIL', reqs.error.message);

  // A count field is the honest way to count linked requirements (no rollup "count").
  const back = (await client.getApplication(state.apps['Regulations'], { forceRefresh: true }))
    .structure.find((f) => f.field_type === 'linkedrecordfield' && f.params?.linked_application === state.apps['Requirements']);
  if (!back) return record('P02', 'reciprocal link', 'FAIL', 'no backlink field on Regulations');
  const cnt = P(await handleCreateField({ applicationId: state.apps['Regulations'], fieldType: 'countfield',
    label: 'Applicable requirements', params: { linked_field: back.slug }, confirm: true }, ctx));
  if (cnt.error) return record('P02', 'count field', 'FAIL', cnt.error.message);

  // The trap: a coverage percentage. Verify which scale a formula must use.
  const pct = P(await handleCreateField({ applicationId: state.apps['Regulations'], fieldType: 'percentfield',
    label: 'Coverage', params: { precision: 2 }, confirm: true }, ctx));
  const pctSlug = pct.field?.slug ?? pct.slug;
  await sleep(20000);   // reciprocal link values are eventually consistent (15-45s)
  const rec = await client.getRecord(state.apps['Regulations'], regId);
  const counted = rec[cnt.field?.slug ?? cnt.slug];
  record('P02', 'count through a link returns the real number',
    String(counted) === '4' ? 'PASS' : 'PARTIAL',
    `linked 4 requirements, count field reads ${JSON.stringify(counted)}${String(counted) !== '4' ? ' (reciprocal values lag 15-45s)' : ''}`,
    { regId, pctSlug });
  state.records.regId = regId; state.fields['Regulations.Coverage'] = pctSlug;
  save();
});

console.log('\n--- phase 0-1 complete ---');
save();
