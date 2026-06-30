# SmartSuite MCP Server

A locally-hosted [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives AI coding agents and desktop assistants governed, auditable access to SmartSuite data.

Works with Claude Desktop, Claude Code, Cursor, Cline, and any other MCP-compatible client.

---

## What this is

The SmartSuite MCP server runs on your machine and communicates with your MCP client over stdio. It proxies requests to the SmartSuite REST API using your account credentials. The server enforces access modes, validates inputs, redacts secrets from logs, and writes local audit logs for all write operations.

---

## Installation

### Option 1: Claude Desktop extension (.mcpb)

Download the latest `smartsuite-mcp-server-*.mcpb` from the [Releases page](https://github.com/SmartSuiteFoundry/smartsuite-mcp-server/releases), then double-click to install in Claude Desktop. You'll be prompted for your account ID and API key. No Node.js required.

### Option 2: npm (global)

```bash
npm install -g @smartsuite/mcp-server
```

### Option 3: npx (no install)

```bash
npx @smartsuite/mcp-server
```

### Option 4: Docker

```bash
docker pull smartsuite/mcp-server:latest
```

---

## Quick start: Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "smartsuite": {
      "type": "stdio",
      "command": "smartsuite-mcp",
      "args": [],
      "env": {
        "SMARTSUITE_ACCOUNT_ID": "your-account-id",
        "SMARTSUITE_API_KEY": "your-api-key",
        "SMARTSUITE_BASE_URL": "https://app.smartsuite.com/api/v1",
        "SMARTSUITE_MCP_MODE": "readwrite"
      }
    }
  }
}
```

Restart Claude Desktop. You should see the SmartSuite tools in the connector panel.

---

## Quick start: Claude Code

```bash
claude mcp add smartsuite \
  --env SMARTSUITE_ACCOUNT_ID=your-account-id \
  --env SMARTSUITE_API_KEY=your-api-key \
  --env SMARTSUITE_BASE_URL=https://app.smartsuite.com/api/v1 \
  --env SMARTSUITE_MCP_MODE=readwrite \
  -- smartsuite-mcp
```

---

## Quick start: Docker

```bash
docker run --rm -i \
  -e SMARTSUITE_ACCOUNT_ID=your-account-id \
  -e SMARTSUITE_API_KEY=your-api-key \
  -e SMARTSUITE_MCP_MODE=readonly \
  smartsuite/mcp-server:latest
```

---

## Access modes

| Mode | Read | Create/Update | Delete | Schema writes |
|------|------|--------------|--------|---------------|
| `readonly` | ✅ | ❌ | ❌ | ❌ |
| `readwrite` | ✅ | ✅ | opt-in | opt-in |
| `admin` | ✅ | ✅ | opt-in | opt-in |

Set with `SMARTSUITE_MCP_MODE`. Default is `readonly`.

---

## Cross-workspace access

A SmartSuite API key can often reach several workspaces. By default this server is locked to the single workspace named in `SMARTSUITE_ACCOUNT_ID` (the "primary" workspace). Set `SMARTSUITE_ENABLE_CROSS_WORKSPACE=true` to let the server read from other workspaces the key can access.

When enabled:

- A new read-only tool **`smartsuite_list_workspaces`** lists the workspaces you can reach (slug, name, solution count, plan). It's hidden when the flag is off.
- Read tools gain an optional **`workspace`** parameter — pass a workspace **slug or name** to run that single call against a non-primary workspace. Omit it to use the primary.
- **Cross-workspace access is read-only.** Writes, updates, and deletes always target the primary workspace only; passing `workspace` to a write tool is rejected, regardless of access mode.
- Restrict the reachable set with `SMARTSUITE_ALLOWED_WORKSPACES` (comma-separated slugs or names). Empty means all workspaces the key can access. The primary is always allowed.

```jsonc
// Example: enable cross-workspace, limited to two workspaces
"env": {
  "SMARTSUITE_ENABLE_CROSS_WORKSPACE": "true",
  "SMARTSUITE_ALLOWED_WORKSPACES": "s36h7yr5,Reveal Risk"
}
```

```
// Then, in the client:
smartsuite_list_workspaces()                          → see what's reachable
smartsuite_list_solutions({ workspace: "Reveal Risk" })   → read another workspace by name
smartsuite_describe_application({ applicationId, workspace: "s36h7yr5" })  → by slug
```

---

## Configuration

### Required

| Variable | Description |
|----------|-------------|
| `SMARTSUITE_ACCOUNT_ID` | Your SmartSuite account ID |
| `SMARTSUITE_API_KEY` | Your SmartSuite API key |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `SMARTSUITE_BASE_URL` | `https://app.smartsuite.com/api/v1` | API base URL |
| `SMARTSUITE_MCP_MODE` | `readonly` | Access mode: `readonly`, `readwrite`, `admin` |
| `SMARTSUITE_MAX_RECORDS` | `100` | Hard cap for list/query tools |
| `SMARTSUITE_MAX_BATCH_WRITES` | `25` | Max records per batch update |
| `SMARTSUITE_ENABLE_DELETE` | `false` | Enable delete tools |
| `SMARTSUITE_ENABLE_SCHEMA_WRITE` | `false` | Enable schema write tools (create/update fields, formulas, forms, and automations) |
| `SMARTSUITE_ALLOWED_SOLUTIONS` | _(all)_ | Comma-separated solution IDs to allow |
| `SMARTSUITE_ALLOWED_APPLICATIONS` | _(all)_ | Comma-separated application IDs to allow |
| `SMARTSUITE_DENIED_APPLICATIONS` | _(none)_ | Comma-separated application IDs to block |
| `SMARTSUITE_ENABLE_CROSS_WORKSPACE` | `false` | Allow read access to other workspaces your API key can reach (see [Cross-workspace access](#cross-workspace-access)) |
| `SMARTSUITE_ALLOWED_WORKSPACES` | _(all)_ | Comma-separated workspace slugs or names reachable when cross-workspace is enabled; empty allows all accessible workspaces |
| `SMARTSUITE_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `SMARTSUITE_LOG_FILE` | stderr | Path to write logs (default: stderr) |
| `SMARTSUITE_REQUEST_TIMEOUT_MS` | `30000` | HTTP request timeout in milliseconds |
| `SMARTSUITE_RETRY_COUNT` | `2` | Number of retries for rate limits and transient errors |
| `SCHEMA_CACHE_TTL_MS` | `300000` | Application schema cache TTL (5 min) |
| `SMARTSUITE_AI_ENRICHED_RECORDS` | `false` | Return field context (label, type, help text, linked field) with every record response |
| `SMARTSUITE_MIGRATION_DIR` | _(cwd)_ | Base directory for solution-migration project files (mappings/diff/xlsx, under `.smartsuite-migrations/`) |

---

## Tool list

### Discovery & Schema

| Tool | Description |
|------|-------------|
| `smartsuite_diagnostics` | Validate configuration and connectivity |
| `smartsuite_list_workspaces` | List workspaces your API key can access (only when cross-workspace is enabled) |
| `smartsuite_list_solutions` | List accessible SmartSuite solutions |
| `smartsuite_get_solution` | Get solution details |
| `smartsuite_list_applications` | List applications; pass `solutionId` to filter to one solution. Use `slim: true` to inventory a whole solution cheaply (id, name, slug, solution, fieldCount); `limit` is enforced client-side |
| `smartsuite_describe_application` | Application schema with field slugs, options, help text, and the record term. Pass `includeLayout: true` for record-view tabs, sections (collapse + visibility conditions), field rows, and field-level display logic |
| `smartsuite_list_fields` | List fields for an application, with help text |
| `smartsuite_describe_field` | Detailed field metadata: choice options, help text (+ format), linked-record targets and display format, formula expression + return type, record-title template, auto-number config, and native AI field config |
| `smartsuite_set_field_help_text` | readwrite + enable_schema_write | Set/modify/clear a field's help text. Accepts markdown (paragraphs, bullet/ordered lists, **bold**/*italic*) → rich `help_doc`; `displayFormat` = `tooltip` or `below_field_name`. Applies asynchronously; dry-run unless `confirm:true` |
| `smartsuite_create_field` | readwrite + enable_schema_write | Create a field of any type. Supply `fieldType` + `label` and optional sparse `params` (SmartSuite fills type defaults); e.g. `choices` for select/status, `linked_application`+`entries_allowed` for linkedrecord (backlink auto-created). Slug generated, field placed in the layout. Dry-run unless `confirm:true`. (Formulas: use `create_formula_field`) |
| `smartsuite_update_field` | readwrite + enable_schema_write | Update a field's `label` and/or `params` (shallow-merged patch; other params preserved). Applies asynchronously; dry-run unless `confirm:true` |

### Formulas

| Tool | Mode | Description |
|------|------|-------------|
| `smartsuite_analyze_formulas` | readonly | Review formula fields. Application-wide: every formula with return type, validity, native complexity score + tier, and structural metrics (function count, nesting depth, reference counts). Pass `fieldSlug` for one formula's dependency graph — reference chains resolved across linked records and compound sub-fields, rendered as an ASCII tree and a Mermaid flowchart. Add `deep: true` for the cross-table impact index (record count × link fan-out) |
| `smartsuite_validate_formula` | readonly | Validate a formula expression against an application without writing anything. Returns `{valid, safe, warnings}` or the exact error (syntax, unknown function, missing field reference) |
| `smartsuite_create_formula_field` | readwrite + enable_schema_write | Create a formula field. Validates the expression first (an invalid formula is never created); dry-run preview unless `confirm: true` |
| `smartsuite_update_formula_field` | readwrite + enable_schema_write | Update a formula field's expression, label, and/or return type. Validates first; dry-run preview unless `confirm: true` |

### Records

| Tool | Mode | Description |
|------|------|-------------|
| `smartsuite_list_records` | readonly | List records with optional sort and field projection; pass `ids` to fetch specific records by ID |
| `smartsuite_get_record` | readonly | Get a record by ID |
| `smartsuite_search_records` | readonly | Text search across specified fields |
| `smartsuite_query_records` | readonly | Structured filter query |
| `smartsuite_create_record` | readwrite | Create a new record |
| `smartsuite_update_record` | readwrite | Update one record |
| `smartsuite_update_records` | readwrite | Batch update with dry-run support |
| `smartsuite_delete_records` | readwrite + enable_delete | Delete records with confirmation |

### Comments

| Tool | Mode | Description |
|------|------|-------------|
| `smartsuite_list_comments` | readonly | List comments on a record |
| `smartsuite_create_comment` | readwrite | Add a comment to a record |

### Views & Dashboards

| Tool | Description |
|------|-------------|
| `smartsuite_list_views` | List views for an application (grid, kanban, calendar, timeline, gantt, map, chart, form). Pass `includeConfig: true` for each view's filters, sort, group-by, and visible/collapsed fields |
| `smartsuite_describe_view` | Full configuration for one view: filters, sort, group-by, visible/collapsed fields, sharing settings. For form views, returns form config (title, submit label, branding, redirect, per-field prefill/help) |
| `smartsuite_list_dashboards` | List dashboards for an application with their tabs |
| `smartsuite_describe_dashboard` | Full dashboard config: tabs, branding, style. Pass `includeWidgets: true` to fetch every widget (type, name, position, parsed params) on every tab |

### Forms

| Tool | Mode | Description |
|------|------|-------------|
| `smartsuite_list_forms` | readonly | List an application's forms with page/field counts, sharing state, and public URL |
| `smartsuite_describe_form` | readonly | Full form structure: settings, sharing, and the page-by-page layout (bound fields + content elements, sections, conditions) |
| `smartsuite_create_form` | readwrite + enable_schema_write | Create a form; validates label + field slugs. Dry-run unless `confirm: true` |
| `smartsuite_update_form` | readwrite + enable_schema_write | Update form settings, fields, or full `formState`. Dry-run unless `confirm: true` |
| `smartsuite_submit_form` | readwrite | Submit a form — creates a record through the form's pipeline. Call without `values` to preview the fields to fill, then with `values` to submit |

### Automations

| Tool | Description |
|------|-------------|
| `smartsuite_list_automations` | List a solution's automations (id, name, enabled state, trigger, action types). Scoped per solution |
| `smartsuite_describe_automation` | Full automation config: trigger and all action groups |
| `smartsuite_describe_automation_step` | Resolve one step's full schema: a trigger (label, inputs+options, exposed fields, condition fields) or a chosen action (label, integration, inputs). Select an action with `actionIndex`/`actionInstanceId` |
| `smartsuite_get_automation_limits` | Workspace automation run usage and plan: plan category, run limit, used, remaining, percent used, enforced |
| `smartsuite_list_automation_credentials` | Integration credentials a solution's automations use (Gmail, Slack, Teams, webhooks, …) |
| `smartsuite_list_solution_members` | Members available to a solution (id, name, email, job title, status) |
| `smartsuite_create_automation` | Create an automation (trigger + actions). Requires `readwrite`/`admin` + `SMARTSUITE_ENABLE_SCHEMA_WRITE`. Pass actions as native `actionGroups` or a flat `actions` array; `credentialId` fills the credential onto trigger/actions. Build the shapes with `describe_automation_step` on a similar automation |
| `smartsuite_update_automation` | Update an automation (label, trigger, actions, timezone) — applies only provided fields, preserves the rest. Trigger/actions you supply replace wholesale. Requires schema-write |
| `smartsuite_delete_automation` | Delete an automation. Requires schema-write **and** `SMARTSUITE_ENABLE_DELETE`. Previews unless `confirm:true`. Destructive |

### My Work

| Tool | Mode | Description |
|------|------|-------------|
| `smartsuite_list_my_work` | readonly | List the authenticated user's assigned work (comment mentions, checklist items, assigned records). Returns a summary (totals, overdue count, breakdowns by type/priority/solution) plus items. Filter by `status` (open/resolved), `period`, solution, application, item type, priority, or `overdueOnly` |
| `smartsuite_update_my_work` | readwrite | Update a My Work item: mark it resolved/open and/or set or clear its due date |

### Record-view layout (sections & tabs)

Edit the sections (labeled field groupings) and tabs on an application's record detail view. A section
groups the fields that follow it (until the next section). **When tabs are enabled the record view
renders per-tab layouts, so the section tools require `tabId`** — a tab id, `"all"` (every tab), or
`"top"` (the hidden top-level layout) — and refuse a silent top-level write. When tabs are disabled,
`tabId` is omitted. All require `readwrite`/`admin` + `SMARTSUITE_ENABLE_SCHEMA_WRITE`, and preview
unless `confirm:true`.

| Tool | Description |
|------|-------------|
| `smartsuite_add_layout_section` | Add a section. Place it after a field with `afterField` (fields after it fall under the section) or append at the end. Optional `description`, `collapsed`, `hidden` |
| `smartsuite_update_layout_section` | Update a section's `title` / `description` / `collapsed` / `hidden` by its `section__…` slug |
| `smartsuite_remove_layout_section` | Remove a section by slug. Removes only the grouping — fields under it are preserved |
| `smartsuite_add_layout_tab` | Add a tab. Enables tabs if off (the first tab mirrors the current layout); optional `description`, `position`, and tab-bar `style` (`basic`/`process`/`journey`) / `align` |
| `smartsuite_update_layout_tab` | Update a tab's `name` / `description` / `position` by tab id, and/or the tab-bar `style`/`align` |
| `smartsuite_remove_layout_tab` | Remove a tab by id. Fields stay in the top-level layout; removing the last tab disables tabs |
| `smartsuite_move_layout_field` | Move/arrange an existing field in the layout — reorder it, or place it under a section (`afterField` = a field slug or a `section__` slug). Tabs-aware (`tabId` required when tabs are on) |
| `smartsuite_set_field_visibility` | Hide (`hidden:true`) or show (`hidden:false`) a field in the record view via the layout's record-wide `hidden_fields` list. Dry-run unless `confirm:true` |
| `smartsuite_set_display_logic` | Add/modify/remove display (visibility) logic on a `field`, `section`, or `tab` — show it only when `conditions` (`[{comparison, field, value}]`, combined by `operator`) are met; `clear:true` removes the rule. Dry-run unless `confirm:true` |

### Solution migration (schema diff)

Compare a solution across workspaces and produce a diff package, for promoting lower-environment
changes up to production. Set your **primary workspace to production (the migration target)** and read
the lower environment via cross-workspace access (`SMARTSUITE_ENABLE_CROSS_WORKSPACE`). All four are
read-only against SmartSuite — they only write local files under `SMARTSUITE_MIGRATION_DIR`. The diff
covers tables, fields, views, and forms in full; dashboards are compared at the report-config level
(per-widget contents are not yet diffed).

| Tool | Description |
|------|-------------|
| `smartsuite_match_solutions` | Match lower→prod solutions by exact name (ids differ across workspaces). Propose, then `confirm:true` (+ `overrides`) to confirm; persists a project mapping file |
| `smartsuite_match_applications` | For a confirmed solution pair, match its tables by name (table ids *and* slugs both regenerate across workspaces); persists the table-id map |
| `smartsuite_diff_schemas` | Diff schemas (lower→prod). Fields match by slug; cross-table references remapped and system values ignored, so only real changes surface. `scope:"all"` (default) also diffs views & forms in full and dashboards at the report-config level (matched by name); `scope:"schema"` = tables + fields only. Classifies added/removed/modified with per-property detail + compatible/risky risk; writes `diff.json` |
| `smartsuite_export_diff` | Render the diff as XLSX (Summary + Detail tabs) alongside the JSON |

### SmartDocs

| Tool | Mode | Description |
|------|------|-------------|
| `smartsuite_get_smartdoc_content` | readonly | Read a SmartDoc field as plain text and raw value |
| `smartsuite_append_smartdoc_content` | readwrite | Append markdown to a SmartDoc field |

### Files

| Tool | Mode | Description |
|------|------|-------------|
| `smartsuite_get_file_url` | readonly | Resolve a file field handle to a signed CDN download URL |
| `smartsuite_upload_file` | readwrite | Upload a local file to a SmartSuite file field |
| `smartsuite_move_attachments` | readwrite | Move (or copy) attachments from one file field to another — one record (`recordId`) or all records (`allRecords`). `mode` append/replace; `clearSource` false = copy. Dry-run unless `confirm:true` |

---

## Security model

1. **Credentials never reach the LLM.** API key and account ID are loaded from environment variables and never included in tool responses or logs.
2. **Secrets are redacted from all log output.**
3. **Access mode is enforced server-side.** Write tools return a clear error in `readonly` mode.
4. **Destructive operations require explicit opt-in** (`SMARTSUITE_ENABLE_DELETE=true`) and a confirmation argument.
5. **Batch writes require dry-run acknowledgement** or `confirm=true`.
6. **Application allowlists and denylists** prevent access to sensitive tables.
7. **Cross-workspace access is opt-in and read-only.** Disabled by default; when enabled, other workspaces can be read but never written, and can be scoped with `SMARTSUITE_ALLOWED_WORKSPACES`.
8. **All write operations write a local audit log** (tool, account, application, record, timestamp, success/failure). Field values are not logged by default.

See [SECURITY.md](SECURITY.md) for the full security model.

---

## Troubleshooting

**"config error: Missing required environment variable"**
Set `SMARTSUITE_ACCOUNT_ID` and `SMARTSUITE_API_KEY` in your MCP client config.

**"SmartSuite API error 401"**
Check that your API key is correct and not expired.

**"This operation is blocked in readonly mode"**
Set `SMARTSUITE_MCP_MODE=readwrite` to enable writes.

**Tools not appearing in Claude Desktop**
Restart Claude Desktop after updating the config file.

**Logs polluting MCP output**
Ensure `SMARTSUITE_LOG_FILE` is set to a file path, or that no other code writes to stdout. The server only writes JSON-RPC to stdout.

---

## Development

```bash
# Install dependencies
npm install

# Type-check
npm run typecheck

# Build
npm run build

# Run tests
npm test

# Bundle single file for Docker/MCPB
npm run bundle

# Build and package the Claude Desktop extension (.mcpb)
npm run pack:mcpb
# Output: mcpb/smartsuite-mcp-server-<version>.mcpb
```

### Project structure

```
src/
  index.ts              Entry point
  server.ts             MCP server bootstrap and tool dispatch
  config.ts             Environment variable loader
  logger.ts             Structured JSON logger (stderr or file)
  errors.ts             Error classes and codes
  auth.ts               SmartSuite auth header builder
  smartSuiteClient.ts   SmartSuite REST API client with schema cache
  workspaces.ts         Workspace resolver (slug/name → slug) and allowlist
  tools/
    registry.ts         Tool definitions (names, schemas, annotations)
    context.ts          Shared tool context type
    diagnostics.ts
    workspaces.ts
    solutions.ts
    applications.ts
    fields.ts
    formulas.ts        Formula analysis, validation, and field create/update
    forms.ts           Form review, create/update, and submit (form-type reports)
    mywork.ts          My Work — the authenticated user's assigned items
    records.read.ts
    records.write.ts
    files.ts
    attachments.ts     Move/copy attachments between file fields
    comments.ts
    views.ts
    automations.ts     Automation review, usage/limits, and create/update/delete
    layout.ts          Record-view layout: sections, tabs, field move, hide/show, display logic
    migration.ts       Solution migration tools (match, diff, export)
    smartdocs.ts
  migration/
    types.ts            Migration mapping + diff data model
    match.ts            Name-matching (solutions, tables)
    normalize.ts        System-noise strip + cross-reference remap
    diff.ts             Schema diff engine (field/table/solution classification)
    project.ts          Per-project mapping/diff file persistence
    xlsx.ts             Dependency-free XLSX writer
  types/
    config.ts           Config interface
    smartsuite.ts       SmartSuite API types
  utils/
    audit.ts            Audit log writer
    pagination.ts       Cursor encode/decode
    prosemirror.ts      ProseMirror/SmartDoc → plain text
    redaction.ts        Secret redaction
    retry.ts            Exponential backoff retry
    safeJson.ts         Safe JSON stringify
```

---

## License

MIT
