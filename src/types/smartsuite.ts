/**
 * A workspace ("account") the authenticated API key can reach, from GET /accounts/.
 * The `slug` is the value used in the ACCOUNT-ID request header. Many more fields are
 * returned by the API; only the ones the server uses are typed here.
 */
export interface Workspace {
  id: number;
  slug: string;
  name: string;
  status?: number;
  metrics?: {
    solutions_count?: number;
    members_count?: number;
    [key: string]: unknown;
  };
  plan?: {
    id?: string;
    category?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface Solution {
  id: string;
  name: string;
  slug?: string;
  description?: unknown;
  /** Template/source metadata — null when the solution was not created from a template. */
  template?: unknown;
  status?: string;
  homepage_category_name?: string;
  homepage_category?: string;
  has_demo_data?: boolean;
  applications_count?: number;
  automation_count?: number;
  records_count?: number;
  members_count?: number;
  sharing_enabled?: boolean;
  sharing_hash?: string;
  [key: string]: unknown;
}

/** A solution-level automation (from the automation-engine RPC). Many fields are passed through raw. */
export interface Automation {
  automation_id: string;
  solution_id?: string;
  label?: string;
  system_status?: string;
  trigger?: {
    trigger_reference?: { integration_id?: string; trigger_id?: string };
    credential_id?: string;
    inputs?: unknown;
    [key: string]: unknown;
  };
  action_groups?: unknown[];
  automatic_description?: string;
  first_created?: unknown;
  last_updated?: unknown;
  timezone?: string;
  [key: string]: unknown;
}

export interface FieldsCount {
  total?: number;
  [fieldType: string]: number | undefined;
}

export interface LayoutSection {
  title?: string;
  slug?: string;
  collapsed?: boolean;
  description?: string | null;
  hidden?: boolean;
}

export interface StructureLayout {
  /** Active layout mode, e.g. "fifty_fifty" | "seventy_thirty" | "single_column". */
  mode?: string;
  /** Each mode key (mode value) holds { rows, sections }. */
  [mode: string]: unknown;
}

export interface ApplicationSummary {
  id: string;
  name: string;
  slug?: string;
  solution?: string;
  description?: string;
  record_term?: string;
  fields_count?: FieldsCount;
  /** List responses embed the full field structure — heavy; used only to derive a field count in slim mode. */
  structure?: FieldDefinition[];
  structure_layout?: StructureLayout;
}

export interface FieldChoice {
  value: string;
  label: string;
  value_color?: string;
  value_order?: number;
}

export interface FieldParams {
  primary?: boolean;
  required?: boolean;
  unique?: boolean;
  hidden?: boolean;
  choices?: FieldChoice[];
  linked_application?: string;
  linked_field_slug?: string;
  max_length?: number;
  system?: boolean;
  help_text?: string;
  /** Field help/description, stored as a ProseMirror doc; `help_text` is usually null. */
  help_doc?: unknown;
  help_text_display_format?: string;
  new_choices_allowed?: boolean;
  edit_values?: boolean;
  /** Formula fields: the expression and the type/shape of the computed result. */
  formula?: string;
  is_advanced?: boolean;
  /** Formula fields: SmartSuite's native complexity score (heavily skewed; 0..thousands). */
  score?: number;
  /** Formula fields: false when SmartSuite considers the expression broken/invalid. */
  valid?: boolean;
  target_field_structure?: {
    slug?: string;
    label?: string;
    field_type?: string;
    params?: Record<string, unknown>;
  };
  /** Record-title field: whether the title is auto-generated and its template (e.g. "[[autonumber]] - [[slug]]"). */
  is_auto_generated?: boolean;
  template?: string;
  /** Auto-number field config. */
  prefix?: string;
  suffix?: string;
  starting_number?: number;
  leading_zeros?: number;
  include_labels?: boolean;
  /** Linked-record field: how the link renders ("table" = in-record grid, otherwise inline chips). */
  display_format?: string;
  visible_fields?: string[];
  entries_allowed?: string;
  /** Native AI field configuration (present on AI-enabled fields). */
  ai_agent?: AiAgentConfig;
}

export interface AiAgentConfig {
  enabled?: boolean;
  instructions?: string;
  model?: string;
  enable_internet_search?: boolean;
  run_automatically?: boolean;
  [key: string]: unknown;
}

export interface FieldDefinition {
  slug: string;
  label: string;
  field_type: string;
  params: FieldParams;
}

export interface ApplicationDetail extends ApplicationSummary {
  structure: FieldDefinition[];
  primary_field?: string;
  icon?: string;
  status?: string;
}

export interface RecordTimestamp {
  by?: string;
  on?: string;
}

export interface SmartSuiteRecord {
  id: string;
  title?: string;
  application_id?: string;
  first_created?: RecordTimestamp;
  last_updated?: RecordTimestamp;
  [key: string]: unknown;
}

export interface ListRecordsRequest {
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  filter?: FilterClause;
  ids?: string[];
}

export interface FilterClause {
  operator: 'and' | 'or';
  fields?: FilterField[];
  filters?: FilterClause[];
}

export interface FilterField {
  field: string;
  comparison: string;
  value?: unknown;
}

export interface ListRecordsResponse {
  items: SmartSuiteRecord[];
  total: number;
  offset: number;
  limit?: number;
}

export interface BulkCreateResponse {
  successful_items: SmartSuiteRecord[];
  failed_items: Array<{ index: number; reason: string }>;
}

export interface BulkUpdateResponse {
  successful_items: SmartSuiteRecord[];
  failed_items: Array<{ index: number; reason: string }>;
}

export interface Comment {
  id: string;
  author?: string;
  created_by?: string;
  message?: string;
  text?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ListCommentsResponse {
  data?: Comment[];
  results?: Comment[];
  items?: Comment[];
  count?: number;
  total?: number;
}

/**
 * A "report" is SmartSuite's underlying construct for both views (grid, kanban,
 * calendar, timeline, gantt, map, chart, form) and dashboards. They are all
 * returned by GET /reports/?application=<id> as a bare array, distinguished by
 * `view_mode`. Field names differ from the generic View shape: name is `label`,
 * type is `view_mode`, and per-view config lives under `state`.
 */
export interface ReportTab {
  id: string;
  name: string;
  order: number;
}

export interface DashboardConfig {
  tabs?: {
    enabled?: boolean;
    position?: string;
    logo?: unknown;
    logo_size?: unknown;
    action_buttons?: unknown;
    tabs?: ReportTab[];
  };
  footer?: Record<string, unknown>;
  style?: Record<string, unknown>;
}

export interface Report {
  id: string;
  label: string;
  description?: string | null;
  application: string;
  solution?: string;
  view_mode: string;
  order: number;
  owner?: string;
  is_private?: boolean;
  parent_folder?: string | null;
  is_locked?: boolean;
  state?: Record<string, unknown>;
  map_state?: Record<string, unknown>;
  form_state?: Record<string, unknown> | null;
  dashboard?: DashboardConfig;
  sharing_enabled?: boolean;
  sharing_hash?: string;
  sharing_password?: string | null;
  sharing_allow_copy?: boolean;
  sharing_allow_all_fields?: boolean;
  sharing_allow_export?: boolean;
  sharing_allow_open_record?: boolean;
  sharing_show_toolbar?: boolean;
  is_password_protected?: boolean;
  [key: string]: unknown;
}

export interface DashboardWidget {
  id: string;
  report: string;
  widget_type: string;
  name: string;
  show_name?: boolean;
  width?: number;
  height?: number;
  position_x?: number;
  position_y?: number;
  /** Raw API returns this as a JSON-encoded string; the client parses it to an object. */
  params?: unknown;
  value?: unknown;
  collapsed_by_default?: boolean;
  [key: string]: unknown;
}
