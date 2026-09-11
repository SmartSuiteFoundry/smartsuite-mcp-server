/** P03-P06: create and reconfigure views. */
import { client, ctx, P, sleep, state, record, step, save } from './runner.mjs';
import { handleCreateField, handleCreateFields } from '../../dist/tools/fields.js';
import { handleCreateView, handleUpdateView } from '../../dist/tools/views.write.js';
import { handleListViews, handleDescribeView } from '../../dist/tools/views.js';
import { handleCreateRecords } from '../../dist/tools/records.write.js';
import fs from 'node:fs';

const prior = JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url)));
state.solutionId = prior.solutionId;
const built = prior.results.find((r) => r.evidence?.apps)?.evidence.apps;
Object.assign(state.apps, built);
console.log(`resuming in solution ${state.solutionId}`);

const CT = state.apps['Control Tests'], FD = state.apps['Findings'];
const slugOf = (r) => r.field?.slug ?? r.slug;

// ── setup: the fields these prompts assume the P00 build created ──────────────
console.log('\nsetup: fields for the view prompts');
const mk = async (app, fieldType, label, params={}) => {
  const r = P(await handleCreateField({ applicationId: app, fieldType, label, params, confirm: true }, ctx));
  if (r.error) { console.log(`     ! ${label}: ${r.error.message.slice(0,80)}`); return null; }
  await sleep(700); return slugOf(r);
};
state.fields.ctDue    = await mk(CT, 'datefield', 'Next due date');
state.fields.ctResult = await mk(CT, 'singleselectfield', 'Last result', { choices: [{label:'Pass'},{label:'Fail'},{label:'Not tested'}] });
state.fields.ctTester = await mk(CT, 'textfield', 'Tester');
state.fields.fdDue    = await mk(FD, 'datefield', 'Due date');
state.fields.fdSev    = await mk(FD, 'singleselectfield', 'Severity', { choices: [{label:'Critical'},{label:'High'},{label:'Medium'},{label:'Low'}] });
state.fields.fdOwner  = await mk(FD, 'textfield', 'Owner');
state.fields.fdDesc   = await mk(FD, 'textareafield', 'Description');
state.fields.fdOver   = await mk(FD, 'numberfield', 'Days overdue', { precision: 0 });

// ── P03: new filtered grid with a rolling date window ─────────────────────────
await step('P03', 'New filtered grid with a rolling date window', async () => {
  const r = P(await handleCreateView({ applicationId: CT, label: 'Due in the next 30 days', viewMode: 'grid',
    visibleFields: ['title', state.fields.ctTester, state.fields.ctDue, state.fields.ctResult].filter(Boolean),
    filters: [{ field: state.fields.ctDue, comparison: 'is_within', value: { range: 'next', number: 30, unit: 'day' } }],
    sort: [{ field: state.fields.ctDue, direction: 'asc' }], confirm: true }, ctx));
  if (r.error) return record('P03', 'rolling-window grid view', 'FAIL', r.error.message.slice(0,140));
  state.views.p03 = r.view?.id;
  await sleep(1200);
  const d = P(await handleDescribeView({ applicationId: CT, viewId: state.views.p03 }, ctx));
  const st = JSON.stringify(d.view?.state ?? d.state ?? d);
  const rolling = /is_within|next|relative/i.test(st) && !/20\d\d-\d\d-\d\d/.test(st);
  record('P03', 'rolling-window grid view', rolling ? 'PASS' : 'PARTIAL',
    rolling ? 'filter stored as a relative window, not fixed dates' : 'view created but the filter may be fixed dates — check for a hard-coded date',
    { viewId: state.views.p03, state: st.slice(0, 260) });
  save();
});

// ── P04: reconfigure an existing view without cloning it ──────────────────────
await step('P04', 'Reconfigure an existing view (must not create a copy)', async () => {
  const seed = P(await handleCreateView({ applicationId: FD, label: 'Overdue Findings', viewMode: 'grid',
    filters: [{ field: state.fields.fdOver, comparison: 'is_greater_than', value: 0 }], confirm: true }, ctx));
  if (seed.error) return record('P04', 'reconfigure a view', 'BLOCKED', `seed view failed: ${seed.error.message.slice(0,100)}`);
  const id = seed.view?.id;
  await sleep(1000);
  const before = P(await handleListViews({ applicationId: FD }, ctx));
  const beforeCount = (before.views ?? before.items ?? []).length;

  const upd = P(await handleUpdateView({ applicationId: FD, viewId: id,
    sort: [{ field: state.fields.fdOver, direction: 'desc' }],
    groupBy: [{ field: state.fields['Findings.Audit'] ?? 'title' }],
    visibleFields: ['title', state.fields.fdOwner, state.fields.fdDue, state.fields.fdOver].filter(Boolean),
    confirm: true }, ctx));
  await sleep(1200);
  const after = P(await handleListViews({ applicationId: FD }, ctx));
  const afterCount = (after.views ?? after.items ?? []).length;
  const d = P(await handleDescribeView({ applicationId: FD, viewId: id }, ctx));
  const st = JSON.stringify(d.view?.state ?? d.state ?? d);
  const keptFilter = st.includes(state.fields.fdOver) && /is_greater_than/.test(st);
  const sorted = /"direction":"desc"/.test(st);
  const status = upd.error ? 'FAIL' : (afterCount === beforeCount && keptFilter && sorted) ? 'PASS' : 'PARTIAL';
  record('P04', 'reconfigure a view in place', status,
    upd.error ? upd.error.message.slice(0,120)
      : `views ${beforeCount}->${afterCount} (no clone: ${afterCount===beforeCount}), original filter kept: ${keptFilter}, desc sort applied: ${sorted}`,
    { viewId: id });
  save();
});

// ── P05: calendar bound to a date field (the classic blank-calendar trap) ─────
await step('P05', 'Calendar view with its date field actually bound', async () => {
  const r = P(await handleCreateView({ applicationId: FD, label: 'Remediation deadlines', viewMode: 'calendar',
    confirm: true }, ctx));
  if (r.error) return record('P05', 'calendar view', 'FAIL', r.error.message.slice(0,140));
  await sleep(1200);
  const d = P(await handleDescribeView({ applicationId: FD, viewId: r.view?.id }, ctx));
  const st = JSON.stringify(d.view?.state ?? d.state ?? d);
  const bound = state.fields.fdDue && st.includes(state.fields.fdDue);
  record('P05', 'calendar bound to a date field', bound ? 'PASS' : 'FAIL',
    bound ? 'due-date field is bound; calendar will render records'
          : 'calendar created with NO date field bound — opens blank while the tool reports success (the documented trap)',
    { viewId: r.view?.id, state: st.slice(0, 300) });
  save();
});

// ── P06: re-stack a kanban ────────────────────────────────────────────────────
await step('P06', 'Re-stack a kanban onto a different field', async () => {
  const seed = P(await handleCreateView({ applicationId: FD, label: 'Findings board', viewMode: 'kanban', confirm: true }, ctx));
  if (seed.error) return record('P06', 're-stack kanban', 'BLOCKED', `seed board failed: ${seed.error.message.slice(0,110)}`);
  const id = seed.view?.id;
  await sleep(1000);
  const d0 = P(await handleDescribeView({ applicationId: FD, viewId: id }, ctx));
  const st0 = JSON.stringify(d0.view?.state ?? d0.state ?? d0);
  const upd = P(await handleUpdateView({ applicationId: FD, viewId: id,
    groupBy: [{ field: state.fields.fdSev }],
    filters: [{ field: 'status', comparison: 'is_not', value: 'complete' }], confirm: true }, ctx));
  await sleep(1200);
  const d1 = P(await handleDescribeView({ applicationId: FD, viewId: id }, ctx));
  const st1 = JSON.stringify(d1.view?.state ?? d1.state ?? d1);
  const stacked = state.fields.fdSev && st1.includes(state.fields.fdSev);
  record('P06', 're-stack kanban onto severity', upd.error ? 'FAIL' : stacked ? 'PASS' : 'PARTIAL',
    upd.error ? upd.error.message.slice(0,130)
      : `stack-by now references severity: ${stacked}; board created with a stack field initially: ${/group/i.test(st0)}`,
    { viewId: id, after: st1.slice(0, 260) });
  save();
});

console.log('\n--- phase 2 complete ---');
save();
