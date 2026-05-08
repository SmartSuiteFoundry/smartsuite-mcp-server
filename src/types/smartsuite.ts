export interface Solution {
  id: string;
  name: string;
  slug?: string;
  description?: string;
}

export interface ApplicationSummary {
  id: string;
  name: string;
  slug?: string;
  solution?: string;
  description?: string;
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
  new_choices_allowed?: boolean;
  edit_values?: boolean;
}

export interface FieldDefinition {
  slug: string;
  label: string;
  field_type: string;
  params: FieldParams;
}

export interface ApplicationDetail extends ApplicationSummary {
  structure: FieldDefinition[];
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

export interface View {
  id: string;
  name: string;
  type?: string;
  slug?: string;
}

export interface ViewDetail extends View {
  fields?: string[];
  filter?: FilterClause;
  sort?: Array<{ field: string; direction: string }>;
}
