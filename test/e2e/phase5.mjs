/** P18-P23: dashboard widgets. */
import { client, ctx, P, sleep, state, record, step, save } from './runner.mjs';
import { handleCreateDashboard, handleUpdateDashboard, handleAddDashboardWidget,
         handleUpdateDashboardWidget, handleRemoveDashboardWidget,
         handleNormalizeDashboardWidgets } from '../../dist/tools/dashboards.write.js';
import { handleDescribeDashboard, handleListDashboards } from '../../dist/tools/views.js';
import fs from 'node:fs';

const prior = JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url)));
state.solutionId = prior.solutionId;
for (const a of await client.listApplications(state.solutionId)) state.apps[a.name] = a.id;
const FD = state.apps['Findings'], AU = state.apps['Audits'];
console.log(`resuming in solution ${state.solutionId}`);

// Overlap test: two widgets collide if their column and pixel spans both intersect.
const box = (w) => ({ x: w.position?.x ?? 0, y: w.position?.y ?? 0,
                      w: w.size?.width ?? 0, h: w.size?.height ?? 0 });
const overlaps = (A, B) => {
  const a = box(A), b = box(B);
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
};
const geom = (w) => w ? `${box(w).x},${box(w).y} ${box(w).w}x${box(w).h}` : 'n/a';
const sameBox = (a, b) => a && b && JSON.stringify(box(a)) === JSON.stringify(box(b));
const widgetsOf = async (id, tabId) => {
  const d = P(await handleDescribeDashboard({ applicationId: FD, dashboardId: id, includeWidgets: true }, ctx));
  if (d.error) { console.log('     ! describe_dashboard: ' + d.error.message.slice(0, 90)); return []; }
  // widgetsByTab is an ARRAY of {tabId, tabName, widgets[]} — not an object keyed by tab id.
  const byTab = d.widgetsByTab ?? d.dashboard?.widgetsByTab ?? [];
  const groups = Array.isArray(byTab) ? byTab : [];
  return tabId ? (groups.find((g) => g.tabId === tabId)?.widgets ?? [])
               : groups.flatMap((g) => g.widgets ?? []);
};
const dashboardOf = async (id) => {
  const d = P(await handleDescribeDashboard({ applicationId: FD, dashboardId: id, includeWidgets: true }, ctx));
  return d.error ? null : (d.dashboard ?? d);
};

// ── setup: a dashboard with a Board tab ───────────────────────────────────────
const dash = P(await handleCreateDashboard({ applicationId: FD, label: 'Compliance Overview ' + String(Date.now() % 99999),
  tabs: [{ name: 'Board' }, { name: 'Team' }, { name: 'Auditors' }], confirm: true }, ctx));
if (dash.error) { record('P18', 'setup dashboard', 'BLOCKED', dash.error.message.slice(0,140)); save(); process.exit(0); }
const DID = dash.dashboard?.id ?? dash.id;
const tabs = dash.dashboard?.tabs ?? dash.tabs ?? [];
const boardTab = (tabs[0]?.id) ?? undefined;
console.log(`dashboard ${DID}, tabs: ${tabs.map(t=>`${t.name}(${t.id})`).join(', ')}`);
await sleep(1500);

// ── P18: countdown + progress, placed without overlap ────────────────────────
await step('P18', 'Add a countdown and a progress bar without overlapping', async () => {
  const made = [];
  for (const [type, label] of [['countdown-widget','Next external audit'], ['progress-widget','Overall coverage']]) {
    const extra = type === 'countdown-widget'
      ? { target_date: '2027-03-15', target_time: '09:00', display_days: true, display_hours: true, display_minutes: true }
      : {};
    const r = P(await handleAddDashboardWidget({ dashboardId: DID, tabId: boardTab, widgetType: type,
      name: label, ...(Object.keys(extra).length ? { params: extra } : {}), confirm: true }, ctx));
    if (r.error) { record(`P18-${type}`, `add ${type}`, 'FAIL', r.error.message.slice(0,120)); continue; }
    made.push(r.widget?.id ?? r.id);
    await sleep(900);
  }
  const ws = await widgetsOf(DID, boardTab);
  let collisions = 0;
  for (let i=0;i<ws.length;i++) for (let j=i+1;j<ws.length;j++) if (overlaps(ws[i], ws[j])) collisions++;
  record('P18', 'countdown + progress placed without overlap', made.length === 2 && collisions === 0 ? 'PASS' : made.length < 2 ? 'FAIL' : 'PARTIAL',
    `${made.length}/2 widgets added; ${collisions} overlapping pair(s) among ${ws.length} on the tab`,
    { widgets: ws.map(w=>({ type: w.type, ...box(w) })) });
  state.dashboards = { DID, boardTab, made };
  save();
});

// ── P19: change a card in place (same size and position) ─────────────────────
await step('P19', "Change a card's filter and colour without moving it", async () => {
  const add = P(await handleAddDashboardWidget({ dashboardId: DID, tabId: boardTab,
    widgetType: 'summary-card-widget', name: 'Failing Controls', confirm: true }, ctx));
  if (add.error) return record('P19', 'update a card in place', 'BLOCKED', add.error.message.slice(0,130));
  const wid = add.widget?.id ?? add.id;
  await sleep(1200);
  const before = (await widgetsOf(DID, boardTab)).find((w) => (w.id) === wid);
  const upd = P(await handleUpdateDashboardWidget({ widgetId: wid,
    color: '#F1273F', confirm: true }, ctx));
  await sleep(1200);
  const after = (await widgetsOf(DID, boardTab)).find((w) => (w.id) === wid);
  const samePlace = sameBox(before, after);
  record('P19', 'card recoloured in place', upd.error ? 'FAIL' : samePlace ? 'PASS' : 'PARTIAL',
    upd.error ? upd.error.message.slice(0,130)
      : `colour now ${after?.color}; position/size unchanged: ${samePlace} (${geom(before)} -> ${geom(after)})`);
  save();
});

// ── P20: change a chart's type without losing its source ─────────────────────
await step('P20', "Change a chart's type without losing its data source", async () => {
  const add = P(await handleAddDashboardWidget({ dashboardId: DID, tabId: boardTab,
    widgetType: 'chart-widget', name: 'Open findings by severity', confirm: true }, ctx));
  if (add.error) return record('P20', 'change a chart', 'BLOCKED', add.error.message.slice(0,130));
  const wid = add.widget?.id ?? add.id;
  await sleep(1200);
  const before = (await widgetsOf(DID, boardTab)).find((w) => w.id === wid);
  const srcBefore = JSON.stringify(before?.params ?? {}).match(/"application"\s*:\s*"[^"]+"/)?.[0] ?? 'none';
  const upd = P(await handleUpdateDashboardWidget({ widgetId: wid,
    params: { chart_type: 'bar' }, confirm: true }, ctx));
  await sleep(1200);
  const after = (await widgetsOf(DID, boardTab)).find((w) => w.id === wid);
  const srcAfter = JSON.stringify(after?.params ?? {}).match(/"application"\s*:\s*"[^"]+"/)?.[0] ?? 'none';
  record('P20', 'chart type changed, data source retained',
    upd.error ? 'FAIL' : srcAfter !== 'none' && srcAfter === srcBefore ? 'PASS' : 'PARTIAL',
    upd.error ? upd.error.message.slice(0,130)
      : `source before=${srcBefore}, after=${srcAfter} — a params patch replaces the whole blob, so a partial patch can drop the source`);
  save();
});

// ── P21: add a fourth tab (not a new dashboard) with a pivot ─────────────────
await step('P21', 'Add a fourth tab with a list, a card and a pivot', async () => {
  const dashBefore = (P(await handleListDashboards({ applicationId: FD }, ctx)).dashboards ?? []).length;
  const upd = P(await handleUpdateDashboard({ dashboardId: DID,
    tabs: [...tabs.map(t=>({ id: t.id, name: t.name })), { name: 'Control owners' }], confirm: true }, ctx));
  await sleep(1500);
  const d = (await dashboardOf(DID)) ?? {};
  const nowTabs = d.tabs ?? [];
  const newTab = nowTabs.find((t) => t.name === 'Control owners');
  const dashAfter = (P(await handleListDashboards({ applicationId: FD }, ctx)).dashboards ?? []).length;
  record('P21a', 'fourth tab added to the same dashboard', upd.error ? 'FAIL' : newTab && dashAfter === dashBefore ? 'PASS' : 'PARTIAL',
    upd.error ? upd.error.message.slice(0,130)
      : `tabs now ${nowTabs.length}; dashboards ${dashBefore}->${dashAfter} (no new dashboard: ${dashAfter===dashBefore})`);
  if (!newTab) return;
  const types = ['list-view-widget','summary-card-widget','pivot-widget'];
  const ok = [];
  for (const t of types) {
    const r = P(await handleAddDashboardWidget({ dashboardId: DID, tabId: newTab.id, widgetType: t,
      name: `Owners ${t}`, confirm: true }, ctx));
    if (!r.error) ok.push(t); else console.log(`     ! ${t}: ${r.error.message.slice(0,90)}`);
    await sleep(900);
  }
  record('P21b', 'list, card and pivot widgets created', ok.length === 3 ? 'PASS' : ok.length ? 'PARTIAL' : 'FAIL',
    `${ok.length}/3 created: ${ok.join(', ')}`);
  save();
});

// ── P22: remove and rearrange, then close the gaps ───────────────────────────
await step('P22', 'Remove widgets, resize, and tidy the gaps', async () => {
  const ws = await widgetsOf(DID, boardTab);
  const victim = ws[ws.length - 1];
  if (!victim) return record('P22', 'remove and rearrange', 'BLOCKED', 'no widget to remove');
  const rm = P(await handleRemoveDashboardWidget({ widgetId: victim.id, confirm: true }, ctx));
  await sleep(1200);
  const afterRm = await widgetsOf(DID, boardTab);
  const gone = !afterRm.some((w) => w.id === victim.id);
  const norm = P(await handleNormalizeDashboardWidgets({ dashboardId: DID, reflow: true, confirm: true }, ctx));
  await sleep(1500);
  const final = await widgetsOf(DID, boardTab);
  let collisions = 0;
  for (let i=0;i<final.length;i++) for (let j=i+1;j<final.length;j++) if (overlaps(final[i], final[j])) collisions++;
  record('P22', 'widget removed and layout reflowed with no overlaps',
    rm.error ? 'FAIL' : gone && collisions === 0 ? 'PASS' : 'PARTIAL',
    rm.error ? rm.error.message.slice(0,130)
      : `removed: ${gone}; reflow ${norm.error ? 'FAILED: '+norm.error.message.slice(0,60) : 'ok'}; ${collisions} overlapping pair(s) among ${final.length}`);
  save();
});

// ── P23: heading and text block take a rich-text doc, not a string ───────────
await step('P23', 'Heading and explanatory text render as text, not raw JSON', async () => {
  const results = [];
  for (const [type, text] of [['heading-widget','How coverage is computed'],
                              ['text-block-widget','Coverage is implemented controls divided by applicable requirements.']]) {
    const r = P(await handleAddDashboardWidget({ dashboardId: DID, tabId: boardTab, widgetType: type,
      name: text, params: { content: text }, confirm: true }, ctx));
    if (r.error) { results.push(`${type}: FAIL ${r.error.message.slice(0,60)}`); continue; }
    await sleep(900);
    const w = (await widgetsOf(DID, boardTab)).find((x) => x.id === (r.widget?.id ?? r.id));
    const blob = JSON.stringify(w?.params ?? {});
    // A rich-text widget stores a ProseMirror doc; a bare string round-trips as a raw string.
    const rich = /"type"\s*:\s*"doc"/.test(blob);
    results.push(`${type}: ${rich ? 'rich-text doc' : 'stored as a plain string (renders as raw text/JSON or blank)'}`);
  }
  const allRich = results.every((r) => r.includes('rich-text doc'));
  record('P23', 'content widgets carry a rich-text document', allRich ? 'PASS' : 'PARTIAL', results.join(' | '));
  save();
});

console.log('\n--- phase 5 complete ---');
save();
