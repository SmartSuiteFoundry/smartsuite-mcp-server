# Changelog

All notable changes to the SmartSuite MCP Server. Versions marked _(unreleased)_ are built and
deployed as incremental `.mcpb` artifacts but not yet published as a GitHub release.

## 1.0.0
First stable release. The tool surface is verified against the live SmartSuite API and versioning
now follows semver: breaking changes require a major bump.
### Added
- **`smartsuite_create_fields` — create many fields in one call.** Previously adding N fields meant N separate tool calls. SmartSuite has no bulk add-field API (`add_field` takes exactly one field, and a table's `structure` is not mutable — see below), so this issues one request per field, ~1s each. It is sequential on purpose: parallel field adds get rate-limited (429) and silently drop fields rather than corrupting the schema, so concurrency loses fields instead of saving time. The whole batch is validated before anything is written, and a mid-batch failure does **not** abort the rest — every field is reported with `created` true/false plus its error, so a partial batch can be retried with just the failures. The post-batch schema read (one, not one per field) is the authority on what landed, since `add_field` returns an empty body.
- **`smartsuite_create_application` accepts `fields[]`** — provisions a new table *and* all its fields in a **single** request, with the generated slugs preserved. This is the only genuine bulk field path the API offers and it's dramatically faster: measured against the live API, 4 fields inline took **1.06s** versus **5.65s** for the same 4 added afterwards. Prefer it whenever the table is new.
### Changed
- **Removed `afterFieldSlug` from `create_field` and `create_formula_field`** (breaking, for a parameter that never worked). The API *requires* `field_position` — omitting it is a 400 — but **ignores its value**: verified against the live API, anchoring a new field at the first field, a middle field, or even a slug that doesn't exist all returned 200 and appended to the end, of both `structure` and the record-view layout. The parameter was advertising positioning it could not deliver. New fields always append; use `smartsuite_move_layout_field` to position one. This also removes a wasted schema fetch and a spurious "could not determine a position" failure path from `create_formula_field`.
### Fixed
- **`smartsuite_update_records` failed on every real write** with `Cannot read properties of undefined (reading 'length')`, regardless of batch size or value shape. The bulk-update endpoint returns a **bare array** of the updated records — not the `{successful_items, failed_items}` envelope its type claimed (the same discrepancy fixed for bulk-*create* in 0.9.5, which bulk-update never got). The write itself succeeded; the handler then crashed formatting the response, which is why only `dryRun: false` calls were affected. `bulkUpdateRecords` now normalizes array→envelope.
- **Partially-applied batch updates reported `failed: 0` and silently lost records.** The endpoint drops ids it can't match without reporting a failure — verified against the live API, a batch of one real and one unknown id returns only the one updated record and no error. `update_records` now diffs the requested ids against the ids that came back and reports the missing ones (with their batch `index`) as failures.
- `update_records` now rejects a missing or empty `records` array with a validation error instead of throwing, matching `create_records`.

## 0.9.10
### Security
- **Allowlist is now enforced on every tool call.** Previously `SMARTSUITE_ALLOWED_SOLUTIONS`/`SMARTSUITE_ALLOWED_APPLICATIONS` were only checked by a few write tools — reads (`get_record`, `list/query/search records`, `describe_application`, views/dashboards/automations, …) were not gated, and `SMARTSUITE_ALLOWED_SOLUTIONS` wasn't enforced anywhere. A central chokepoint now applies allow/deny to **all** calls: it resolves the solution/application a call targets (including tools identified only by a view/dashboard/widget id) and blocks anything outside the allowlist or in the denylist.
- **`list_solutions` and `list_applications` no longer reveal out-of-scope items** when an allowlist is set — so a caller can't even discover other solutions to try to reach them.
- **`list_my_work` is filtered too.** My Work spans every solution and carries no scoping argument, so the chokepoint can't gate it; the handler now drops items whose solution/application is outside the allowlist (or denied), which otherwise leaked task titles and record references from out-of-scope solutions.
- **`get_file_url` is disabled while an allowlist is active** — a raw file handle isn't scoped to a solution, so it could otherwise reach files outside the allowed solutions.
- **Allowlist fields are now editable in the Claude Desktop connector settings** — added Allowed Solutions / Allowed Applications / Denied Applications to the MCPB manifest (they previously had no config UI field, so `.mcpb` installs couldn't set them).
### Fixed
- **Tables created via MCP could end up with an empty record term, which broke grid/list-view widgets on dashboards built against them** (a whole dashboard came out empty). `create_application` now always sets a non-empty record term ("what each record is called") explicitly — default `"Record"`, or pass `recordTerm` (e.g. "Request") — instead of relying on the server's auto-default. (The API rejects an empty term and normally defaults it, but it had intermittently come through empty.)
### Added
- **`smartsuite_validate_automation`** — reads the automation errors the SmartSuite UI shows inline, notably "Trigger output with id <id> not found" (an action references a trigger output / field that no longer exists because the field was deleted or its slug changed). It resolves the trigger's current outputs and flags every action-input reference to a missing one, returning the error text, the missing `outputId`, and where it's used. Also reports `userEnabled` (the ON/OFF toggle) and engine `status`. Works even in solutions where listing automations 500s (uses GetAutomation).
### Changed
- Automation summaries (`list`/`describe`) now include `userEnabled` — the user's ON/OFF toggle (`user_status`), distinct from `enabled`/`status` which reflect the engine's computed validity. (An automation can be toggled ON yet engine-disabled because it's invalid.)

## 0.9.8
### Fixed
- **Automations became unreadable in solutions that contain an AI action.** SmartSuite's `ListAutomations` (which every automation tool used) returns a hard 500 for a whole solution when it contains the AI "ai-custom-prompt" action — so `describe_automation`, `describe_automation_step`, and `update_automation` all failed there. They now fetch single automations via `GetAutomation` (which works), and `list_automations` returns a clear explanation instead of a raw 500.
### Added
- **`smartsuite_set_automation_ai_prompt`** — set the dynamic prompt on an automation's AI ("AI Workflow Agent") action from a `{{field_slug}}` template. Builds the rich-text prompt with field-reference pills (same reliable path as AI-field prompts) and writes it to the action, leaving the rest intact. Reads via GetAutomation so it works even where listing automations 500s. Verified live end-to-end (create → set prompt → round-trip → update).
- **`normalize_dashboard_widgets` can now re-flow layouts** (`reflow:true`) to repair dashboards whose widgets were piled near (0,0) and overlap/hide each other. It keeps widgets that share a row (same `position_y`) side-by-side and stacks rows top-to-bottom by each row's tallest widget, eliminating overlaps. (The create-time auto-position fix only helps new widgets; this repairs already-built dashboards. Verified live: a piled layout with 9 overlapping pairs → 0.)
- **Reliable dynamic AI-field prompts.** `create_field`/`update_field` accept an `aiPrompt` template where `{{field_slug}}` inserts a live reference to another field (e.g. `"Summarize {{title}} for {{s096c9e74e}}"`). The tool builds the exact rich-text `ai_agent.instructions` doc — including the field-reference `pill` nodes (label + type icon resolved from the schema) — and enables the AI agent, preserving any existing model/settings. This replaces hand-building ProseMirror pills, which was flaky (the connector could construct a prompt one time and fail the next). Unknown `{{slug}}` references are rejected with a clear error.
### Fixed
- **Metric (summary-card) widgets rendered blank / under-populated.** The auto-fill template was too minimal: the metric number renders from `params.color` (invisible when unset/white) and the card needs a `drill_in` skeleton plus `appearance`/`size`/`mode`/`static_value`. The template now includes all of these with a visible accent color, and the summary-card default height is 156 (128 clipped the card's padding). Chart template now also carries `categories`/`legends`/`dynamic_filter_field`/`custom_sort_applied` and full `totals`/`benchmarks`/`advanced_options`. (Derived from docs/NOTES-dashboard-widgets.md; verified live.)
### Changed
- `add_dashboard_widget`/`update_dashboard_widget` descriptions document the summary-card gotchas (number color must be visible; `function_type` is `avg` not `average`) and that updating `params` can reset height (pass `size` too).

## 0.9.7
### Added
- **Create solutions and tables**: `smartsuite_create_solution` (name + optional logo icon/color; server assigns slug + private permissions) and `smartsuite_create_application` (create a table in a solution, with a default "Title" primary field). Both gated by schema-write + dry-run/confirm.
### Fixed
- **Widget with null color broke the dashboard** (reported: choosing a Highlight color over a widget cleared the dashboard). API-created widgets had `color: null`, but the UI color editor expects a hex and blanked the dashboard on a null. Widgets are now created with a valid accent color (default `#3A86FF`, or pass `color`) plus non-null `description`/`collapsed_by_default`, matching UI-created widgets.
- **Widgets stacked at (0,0) and overlapped** (reported: dividers hidden behind other widgets). `add_dashboard_widget` defaulted every widget to position (0,0), so multiple widgets piled on top of each other and thin ones (dividers) disappeared behind taller ones. When `position` is omitted, a widget is now appended **below** the lowest existing widget on the tab.
- **Dashboard widgets got a wrong default height** (reported: metric/summary cards with "strange heights" that re-saving didn't fix). `add_dashboard_widget` applied a uniform `width:4, height:200` to every widget type; since height is stored explicitly, compact widgets like summary-card/progress/comparison rendered too tall and the UI kept the value on re-save. Widgets now default to the natural per-type size the SmartSuite UI uses (e.g. summary-card/progress/comparison = 1×128, charts = 2×448, list/calendar = width 4), taken from real dashboards. Callers can still override with `position`/`size`.
### Added
- `smartsuite_normalize_dashboard_widgets` — repair tool that resets existing widgets to their natural per-type size (fixes dashboards already built with the wrong sizes). Preview-first; normalizes height only by default (leaving width/position), `dimension:"both"` also fixes width; optional `widgetTypes`/`tabId` filters.
- Recognize six more real widget types that were previously rejected as unknown: `spacing-widget`, `button-row-widget`, `webpage-widget`, `record-picker-widget`, `countdown-widget`, `world-clock-widget` (accepted with per-type default sizes; no auto-fill param template yet — supply `params`).

## 0.9.6
### Fixed
- **Restore toggle now appears in Claude Desktop**: `SMARTSUITE_ENABLE_RESTORE` was read by the server but not declared in the MCPB manifest, so no config field was shown (and for MCPB installs there was no way to turn it on). Added an "Enable Restore Tools" toggle (default off) and wired the env binding.
### Changed
- Manifest description for "Enable Schema Writes" now reflects the full surface (fields, formulas, forms, views, dashboards, widgets, automations).

## 0.9.5
### Added
- **Bulk create records**: `smartsuite_create_records` — batch-create with dry-run/confirm, batch-size cap, and audit; returns created IDs and per-row failures.
- **Compact record output**: `list`/`query`/`search` records accept `format:"compact"`, returning a `{ columns, rows }` table (field names once instead of per-record) — materially fewer tokens on large result sets, lossless for scalar values. Pairs with the existing `fields` projection.
- **Deleted-record recovery**: `smartsuite_list_deleted_records` (readonly, solution-scoped trash listing with `deletedBy`/`deletedAt`) and `smartsuite_restore_records` (gated by `SMARTSUITE_ENABLE_RESTORE` + confirm). `delete_records` now returns the deleted IDs so they can be restored, and its description reflects that deletes are recoverable.
- **Deleted-schema recovery**: `smartsuite_list_deleted_fields` + `smartsuite_restore_field` (restore a deleted field into its table; schema-write-gated + confirm) and `smartsuite_list_deleted_applications` (listing only — SmartSuite has no public restore-application endpoint). `delete_field` now advertises that fields are recoverable via `restore_field`.
- **Dashboard CRUD + widgets**: `smartsuite_create_dashboard` / `update_dashboard` / `delete_dashboard` (create with named tabs, edit tabs/footer/style/enable-tab-bar, gated+confirm delete) and `smartsuite_add_dashboard_widget` / `update_dashboard_widget` / `remove_dashboard_widget`. Widgets support layout (position {x,y} = columns, {y,height} = pixels), settings (name/showName/color/description/collapsed), and moving between tabs. Labels are uniqueness-checked; forms/views are routed to their own tools.
- **Widget template catalog (all 19 types)**: `widgetType` is validated against the 19 real types, and `params` is now OPTIONAL — omit it and `add_dashboard_widget` fills a verified minimal template for that type (data widgets default to the dashboard's own application with sensible field slugs), so any widget is creatable with just `dashboardId` + `widgetType`. Templates were discovered by probing the API and verified to create live on a second application (19/19).
- **View (report) CRUD**: `smartsuite_create_view`, `smartsuite_update_view`, `smartsuite_delete_view`. Create a view of any mode (grid/card/kanban/calendar/timeline/gantt/chart/map) with an optional initial config (visibleFields, filters + operator, sort, groupBy); update renames/re-describes and edits config; delete is gated + confirm-required and refuses the last remaining view. Labels are checked for uniqueness (suggests an alternative), field slugs validated against the schema, and forms/dashboards are routed to their own tools.
### Fixed
- **Automation status reporting**: `enabled` was reported as `null` for both pending and disabled automations, hiding *why* an automation wouldn't run. Write/list/describe results now include `status` (`enabled` | `disabled` | `pending` | `unknown`) and `statusReason` (e.g. "Trigger credential not found"). `system_status` is engine-computed, so create/update responses now note it's validated asynchronously (usually `pending` immediately after a write) and that a `disabled` result means the automation is structurally invalid — not that the write cleared an enabled flag.
### Changed
- `update_automation` / `describe_automation_step` descriptions now warn against rebuilding a trigger/action from the (slimmed) `describe_automation_step` output — doing so drops full input encodings (e.g. an AI action's model) and can strip settings on save. To edit only the name, omit trigger/actions so they're preserved verbatim.

## 0.9.4 — _(unreleased)_
### Changed
- **Leaner schema responses (token cost)**: `describe_application` and `list_fields` now omit per-field boilerplate — `required`/`primary`/`hidden` appear only when true, help text only when present (absence = false/none). Cuts a typical schema payload by ~35–40%. `list_fields` now also returns choice options + linked-app targets, so it's a viable lightweight alternative to `describe_application`.
### Added
- `describe_application` gains `verbosity: compact | standard | full` — `compact` returns just slug/label/type + choice options + linked-app (best for surveys / data work / scanning many tables), `full` appends the raw params blob.
- Tool descriptions now flag schema calls as token-heavy, note the schema is stable within a session (call once per table, reuse — don't re-describe), and steer callers to `list_fields`/`verbosity:"compact"` when they only need field slugs/types.

## 0.9.3 — _(unreleased)_
### Added
- **Select choice descriptions and numeric values**: `create_field`/`update_field` accept `value_help_text` (the option description shown in the dropdown) and `weight` (the option's numeric value, used by formulas/rollups) on single/multi-select choices — e.g. `{label:"High", value_help_text:"Ship this week", weight:3}`. Defaults (`value_help_text:""`, `weight:1`) match UI-created choices; status choices take neither.

## 0.9.2 — _(unreleased)_
### Added
- `smartsuite_delete_field` — delete a field by slug (gated by schema-write + `SMARTSUITE_ENABLE_DELETE`, confirm-required, refuses system fields). Enables replacing a formula with a rollup end-to-end.
### Fixed
- Single/multi/status **select choice colors**: MCP-created choices omitted `value_color`, so dropdowns rendered incorrectly until edited in the UI. `create_field`/`update_field` now auto-assign a color (SmartSuite's default palette, by position) and order to any choice missing one; explicit colors are preserved.
### Changed
- `create_field` documents **rollup** (`{linked_field, field_selection, function}`) and **lookup** (`{linked_field, field_selection}`) params — these field types were always creatable via the generic tool; the guidance makes it discoverable (rollups are not UI-only).

## 0.9.1 — _(unreleased)_
### Added
- `smartsuite_move_layout_field` gains `toTab` — move a field to a **different tab** (removed from its current tab, added to the destination). Plain reorder can't pull a field in from another tab.
- `smartsuite_update_application` — rename a table (`name`) and/or change its record term.

## 0.9.0
- Solution migration / schema diff: `match_solutions`, `match_applications`, `diff_schemas` (tables, fields, views, forms, dashboards), `export_diff` (XLSX + JSON).
- Record-view layout authoring: sections, tabs, `move_layout_field`, `set_field_visibility` (hide/show), `set_display_logic` (field/section/tab visibility conditions).
- Fields: `create_field`/`update_field` (any type), `set_field_help_text` (markdown → help doc); new fields auto-placed in the layout.
- `move_attachments` — move/copy files between file fields.

## 0.8.0
- Forms (list/describe/create/update/submit), My Work, automation create/update/delete.
- Packaging fix: ship `server/package.json` `{"type":"module"}` so the bundle loads on every Node (resolves the "Installing…" hang).

## 0.7.0
- Formula tooling (analyze/validate/create/update), automations, cross-workspace reads, views/dashboards.
