# Views & Dashboards (`/reports/`) — response shape reference

These fixtures are real (trimmed) responses from the SmartSuite API, captured against
the "Company Operating Plan" solution. They document the shape behind
`smartsuite_list_views`, `smartsuite_describe_view`, `smartsuite_list_dashboards`, and
`smartsuite_describe_dashboard`.

## Endpoints

| Endpoint | Returns | Fixture |
|---|---|---|
| `GET /reports/?application=<appId>` | **bare array** of views **and** dashboards | `reports-grid-view.json`, `reports-dashboard.json` |
| `GET /dashboard/widgets/?report=<reportId>&tab=<tabId>` | **bare array** of widgets | `dashboard-widgets.json` |
| `GET /dashboard/widget-registry/` | object keyed by widget type — static catalog of all widget types | (not fixtured) |

A "report" is SmartSuite's underlying construct for both views and dashboards. There is
no wrapper object and no pagination — the response is a JSON array.

## Report fields (each element of `/reports/`)

| API key | Meaning | Tool mapping |
|---|---|---|
| `id` | report/view/dashboard id | `id` |
| `label` | display name (**not** `name`) | `name` |
| `view_mode` | `grid` \| `form` \| `kanban` \| `calendar` \| `timeline` \| `gantt` \| `chart` \| `map` \| **`dashboard`** | `type`; `view_mode === "dashboard"` routes to the dashboard tools |
| `description` | one-line description (nullable) | `description` |
| `order` | display order; lowest is treated as the base view | `order`; `isDefault` is **inferred** as the lowest-order view (SmartSuite has no explicit default flag) |
| `application` / `solution` | parent table / solution ids | — |
| `owner` | user id of the report owner | `owner` |
| `is_private` | private to owner | `isPrivate` |
| `sharing_*` | external-share settings (`sharing_enabled`, `sharing_hash`, `sharing_allow_copy`, `sharing_allow_export`, `sharing_allow_open_record`, ...) | `sharing*` |
| `is_password_protected` | share link password-gated | `isPasswordProtected` |
| `state` | per-view configuration (see below) | `config` (extracted) + raw `state` in `describe_view` |
| `dashboard` | dashboard config — present only when `view_mode === "dashboard"` (see below) | dashboard tools |

### `state` (per-view config)

`state` holds ~16 "window" objects; the view-type-agnostic ones the tools extract:

| `state` path | Meaning | `config` key |
|---|---|---|
| `filterWindow.new_filters.conditions[]` (fallback `filterWindow.filter.fields[]`) | filter conditions `{comparison, field, value}` | `filters` |
| `sortWindow.sort[]` | sort order | `sort` |
| `groupbyWindow.group[]` | group-by | `groupBy` |
| `fieldsWindow.visibleFields[]` | shown field slugs (drives "clarity over volume") | `visibleFields` |
| `fieldsWindow.collapsed[]` | collapsed/hidden fields | `collapsedFields` |

Type-specific windows also live in `state` and are preserved raw in `describe_view`:
`calendarFieldsWindow`, `timelineFieldsWindow`, `ganttFieldsWindow`, `chartSettings`,
`stackByWindow` (kanban), plus the report's `map_state` (maps).

## Dashboard `dashboard` object

Present only when `view_mode === "dashboard"`. Keys:

| Key | Meaning |
|---|---|
| `tabs` | `{enabled, position, logo, logo_size, action_buttons, tabs:[{id, name, order}]}` — tab structure + branding logo |
| `footer` | footer/branding block (`enabled`, `layout`, `logo`, `links`, ...) |
| `style` | `{width, background_color}` |

**Widgets are not in `/reports/`** — fetch them per tab via `/dashboard/widgets/?report=&tab=`.

## Widget fields (each element of `/dashboard/widgets/`)

| API key | Meaning |
|---|---|
| `id` | widget id |
| `report` | parent dashboard id |
| `widget_type` | see catalog below |
| `name` | widget title |
| `show_name` | whether the title renders |
| `position_x`, `position_y` | grid position |
| `width`, `height` | grid size |
| `collapsed_by_default` | starts collapsed |
| `params` | **JSON-encoded string** in the raw API — the client `JSON.parse`s it before returning. Schema varies per `widget_type`. |

### Widget type catalog (from `dashboard-widgets.json`)

**Content / layout** (no data source — instructions & decoration):
`hero-widget`, `simple-banner-widget`, `heading-widget`, `text-block-widget`,
`faq-widget`, `webpage-widget`, `spacing-widget`, `divider-widget`,
`button-row-widget`, `countdown-widget`, `world-clock-widget`.
Instructional/banner text for Section 4 standards lives in these widgets' `params`.

**Metric** (single aggregated value — `params` has `source`/`application`, `field_slug`, `function_type`, `filter`):
`comparison-widget`, `progress-widget` (has `goal`), `summary-card-widget`.

**Embedded view** (`params` carries `*_window` config mirroring report `state`):
`list-view-widget`, `card-view-widget`, `kanban-view-widget`,
`timeline-view-widget`, `calendar-view-widget`.

**Analytics**: `pivot-widget` (row/column/summarize_by), `chart-widget` (chart_type, values, group_by, categories, benchmarks).

**Interactive / structural**: `record-picker-widget`, `record-details-widget`,
`filter-widget`, `data-schema-widget` (solution ERD).
