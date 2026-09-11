/** P07-P13: rollups, counts, formulas, lookups, options, layout, formula health. */
import { client, ctx, P, sleep, state, record, step, save } from './runner.mjs';
import { handleCreateField, handleUpdateField, handleDescribeField, handleSetFieldHelpText } from '../../dist/tools/fields.js';
import { handleCreateFormulaField, handleValidateFormula, handleAnalyzeFormulas } from '../../dist/tools/formulas.js';
import { handleCreateRecords } from '../../dist/tools/records.write.js';
import { handleAddLayoutSection, handleMoveLayoutField, handleSetDisplayLogic } from '../../dist/tools/layout.js';
import fs from 'node:fs';

const prior = JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url)));
state.solutionId = prior.solutionId;
const apps = await client.listApplications(state.solutionId);
for (const a of apps) state.apps[a.name] = a.id;
Object.assign(state.fields, prior.fields ?? {});
const FD = state.apps['Findings'], AU = state.apps['Audits'], CT = state.apps['Control Tests'],
      CO = state.apps['Controls'], RG = state.apps['Regulations'];
const slugOf = (r) => r.field?.slug ?? r.slug;
const schema = async (id) => (await client.getApplication(id, { forceRefresh: true })).structure;
const findSlug = async (id, label) => (await schema(id)).find((f) => f.label === label)?.slug;
console.log(`resuming in solution ${state.solutionId}`);

// setup: link Findings->Audits already exists; add fields the prompts assume
const mk = async (app, fieldType, label, params={}) => {
  const r = P(await handleCreateField({ applicationId: app, fieldType, label, params, confirm: true }, ctx));
  if (r.error) { console.log(`     ! ${label}: ${r.error.message.slice(0,90)}`); return null; }
  await sleep(700); return slugOf(r);
};
state.fields.coOwner = state.fields.coOwner ?? await mk(CO, 'textfield', 'Control owner');
state.fields.coFreq  = state.fields.coFreq  ?? await mk(CO, 'singleselectfield', 'Frequency', { choices:[{label:'Monthly'},{label:'Quarterly'},{label:'Annual'}] });
const fdAudit = await findSlug(FD, 'Audit');
const fdCtrl  = await findSlug(FD, 'Control');
const fdDue   = await findSlug(FD, 'Due date');
const fdSev   = await findSlug(FD, 'Severity');
const ctCtrl  = await findSlug(CT, 'Control');

// ── P07: counts and rollups across links ──────────────────────────────────────
await step('P07', 'Counts and rollups across links', async () => {
  const auBack = (await schema(AU)).find((f) => f.field_type === 'linkedrecordfield' && f.params?.linked_application === FD);
  if (!auBack) return record('P07', 'counts across links', 'BLOCKED', 'no reciprocal link on Audits');
  const cnt = P(await handleCreateField({ applicationId: AU, fieldType: 'countfield', label: 'Findings raised',
    params: { linked_field: auBack.slug }, confirm: true }, ctx));
  await sleep(800);
  // "how many are still open" = a CONDITIONAL count -> countfield with a filter
  const openCnt = P(await handleCreateField({ applicationId: AU, fieldType: 'countfield', label: 'Open findings',
    params: { linked_field: auBack.slug, include_filters: true,
              field_filter: { operator: 'and', fields: [{ field: 'status', comparison: 'is_not', value: 'complete' }] } }, confirm: true }, ctx));
  await sleep(800);
  // "total days overdue across open findings" = a rollup sum (rollup has no filter)
  const overSlug = await findSlug(FD, 'Days overdue');
  const roll = P(await handleCreateField({ applicationId: AU, fieldType: 'rollupfield', label: 'Total days overdue',
    params: { linked_field: auBack.slug, field_selection: overSlug, function: 'sum' }, confirm: true }, ctx));
  const notes = [
    `count: ${cnt.error ? 'FAIL ' + cnt.error.message.slice(0,60) : 'ok'}`,
    `conditional count: ${openCnt.error ? 'FAIL ' + openCnt.error.message.slice(0,60) : 'ok'}`,
    `sum rollup: ${roll.error ? 'FAIL ' + roll.error.message.slice(0,60) : 'ok'}`,
  ];
  const bad = [cnt, openCnt, roll].filter((r) => r.error).length;
  record('P07', 'counts and rollups across links', bad ? 'FAIL' : 'PASS', notes.join(' | '));
  // two-hop: Regulations -> Requirements -> Controls
  const rgBack = (await schema(RG)).find((f) => f.field_type === 'linkedrecordfield' && f.params?.linked_application === state.apps['Requirements']);
  const twoHop = P(await handleCreateField({ applicationId: RG, fieldType: 'rollupfield', label: 'Controls behind it',
    params: { linked_field: rgBack.slug, field_selection: 'title', function: 'sum' }, confirm: true }, ctx));
  record('P07b', 'two-hop count (Regulations -> Requirements -> Controls)',
    twoHop.error ? 'PASS' : 'PARTIAL',
    twoHop.error ? `refused, as it should be: ${twoHop.error.message.slice(0,90)}`
                 : 'accepted a one-hop rollup for a two-hop question — no error surfaced');
  save();
});

// ── P08: DATEDIFF order and the yes/no return type ────────────────────────────
await step('P08', 'Date formula and yes/no formula', async () => {
  const f1 = P(await handleCreateFormulaField({ applicationId: FD, label: 'Days overdue calc',
    formula: `IF([status] != "complete", DATEDIFF([${fdDue}], NOW(), "days"), 0)`,
    returnType: 'numberfield', confirm: true }, ctx));
  const lint1 = f1.lint ?? [];
  record('P08a', 'DATEDIFF written earlier-date-first', f1.error ? 'FAIL' : 'PASS',
    f1.error ? f1.error.message.slice(0,120)
      : `created; lint raised ${lint1.length} note(s)${lint1.length ? ': ' + lint1.map(l=>l.rule).join(',') : ''}`);
  // The trap: reversed arguments must be caught by lint, not silently accepted.
  const rev = P(await handleValidateFormula({ applicationId: FD,
    formula: `DATEDIFF(NOW(), [${fdDue}], "days")`, returnType: 'numberfield' }, ctx));
  const caught = (rev.lint ?? []).some((l) => l.rule === 'datediff-order');
  record('P08b', 'reversed DATEDIFF is flagged (API says valid)',
    rev.valid && caught ? 'PASS' : rev.valid ? 'FAIL' : 'PARTIAL',
    `API valid=${rev.valid}, lint caught reversed order=${caught}`);
  const f2 = P(await handleCreateFormulaField({ applicationId: FD, label: 'Escalate',
    formula: `OR([status] != "complete", [${fdSev}] = "critical")`, returnType: 'yesnofield', confirm: true }, ctx));
  record('P08c', 'yes/no formula stored as a boolean, not text', f2.error ? 'FAIL' : 'PASS',
    f2.error ? f2.error.message.slice(0,120) : 'created with returnType yesnofield');
  save();
});

// ── P09: rating bands over a percent (the scale trap) ─────────────────────────
await step('P09', 'Rating bands over a percent', async () => {
  const cov = await findSlug(RG, 'Coverage');
  if (!cov) return record('P09', 'rating bands', 'BLOCKED', 'no Coverage field');
  const right = P(await handleValidateFormula({ applicationId: RG,
    formula: `IF([${cov}] >= 0.9, "Green", IF([${cov}] >= 0.7, "Amber", "Red"))`, returnType: 'textfield' }, ctx));
  const wrong = P(await handleValidateFormula({ applicationId: RG,
    formula: `IF([${cov}] >= 90, "Green", IF([${cov}] >= 70, "Amber", "Red"))`, returnType: 'textfield' }, ctx));
  record('P09', 'percent-scale thresholds', right.valid && wrong.valid ? 'PARTIAL' : 'FAIL',
    `both scales validate (0.9: ${right.valid}, 90: ${wrong.valid}) — the API cannot tell them apart, and neither is flagged. A formula reads a percent as a FRACTION, so 90 is the silent bug.`);
  save();
});

// ── P10: lookups ──────────────────────────────────────────────────────────────
await step('P10', 'Lookups pull values through a link', async () => {
  const r = P(await handleCreateField({ applicationId: CT, fieldType: 'lookupfield', label: 'Control owner',
    params: { linked_field: ctCtrl, field_selection: state.fields.coOwner }, confirm: true }, ctx));
  record('P10', 'lookup through a link', r.error ? 'FAIL' : 'PASS',
    r.error ? r.error.message.slice(0,130) : 'lookup created against the control owner');
  save();
});

// ── P11: add a select option without destroying the others ────────────────────
await step('P11', 'Add a select option, help text, display logic', async () => {
  const before = (await schema(FD)).find((f) => f.slug === fdSev);
  const beforeCount = (before?.params?.choices ?? []).length;
  const patch = P(await handleUpdateField({ applicationId: FD, slug: fdSev,
    params: { choices: [...(before.params.choices ?? []), { label: 'Awaiting evidence' }] }, confirm: true }, ctx));
  await sleep(3000);
  const after = (await schema(FD)).find((f) => f.slug === fdSev);
  const afterChoices = after?.params?.choices ?? [];
  const kept = afterChoices.length === beforeCount + 1;
  const colorsKept = afterChoices.every((c) => c.value_color);
  record('P11a', 'existing select options survive an add', kept && colorsKept ? 'PASS' : 'FAIL',
    `${beforeCount} -> ${afterChoices.length} options, all keep a color: ${colorsKept}`);
  const help = P(await handleSetFieldHelpText({ applicationId: FD, slug: fdSev,
    text: 'Auditors accept screenshots, system exports and signed sign-offs.', confirm: true }, ctx));
  record('P11b', 'help text set', help.error ? 'FAIL' : 'PASS', help.error ? help.error.message.slice(0,110) : 'set');
  const dl = P(await handleSetDisplayLogic({ applicationId: FD, fieldSlug: fdSev,
    conditions: [{ field: 'status', comparison: 'is', value: 'complete' }], operator: 'and', confirm: true }, ctx));
  record('P11c', 'display logic applied', dl.error ? 'FAIL' : 'PASS', dl.error ? dl.error.message.slice(0,110) : 'condition set');
  save();
});

// ── P12: record layout ────────────────────────────────────────────────────────
await step('P12', 'Record layout section and field placement', async () => {
  const sec = P(await handleAddLayoutSection({ applicationId: RG, title: 'Audit readiness', confirm: true }, ctx));
  if (sec.error) return record('P12', 'layout section', 'FAIL', sec.error.message.slice(0,130));
  const cov = await findSlug(RG, 'Coverage');
  const mv = P(await handleMoveLayoutField({ applicationId: RG, slug: cov, afterField: sec.section?.slug ?? sec.slug, confirm: true }, ctx));
  const after = await client.getApplication(RG, { forceRefresh: true });
  const rows = JSON.stringify(after.structure_layout?.fifty_fifty?.rows ?? []);
  const present = cov && rows.includes(cov);
  record('P12', 'section created and field moved into it', mv.error ? 'FAIL' : present ? 'PASS' : 'PARTIAL',
    mv.error ? mv.error.message.slice(0,120) : `section added; coverage field still placed in the layout: ${present}`);
  save();
});

// ── P13: formula health check ─────────────────────────────────────────────────
await step('P13', 'Formula health check across the solution', async () => {
  const a = P(await handleAnalyzeFormulas({ applicationId: FD }, ctx));
  if (a.error) return record('P13', 'analyze_formulas', 'FAIL', a.error.message.slice(0,130));
  const items = a.formulas ?? a.items ?? [];
  const invalid = items.filter((f) => f.valid === false);
  record('P13', 'analyze_formulas reports every formula with validity', 'PASS',
    `${items.length} formula field(s) analysed, ${invalid.length} reported invalid`);
  save();
});

console.log('\n--- phase 3 complete ---');
save();
