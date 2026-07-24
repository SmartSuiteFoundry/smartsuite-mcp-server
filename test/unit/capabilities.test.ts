import { describe, it, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../../src/tools/registry.js';

const names = new Set(TOOL_DEFINITIONS.map((t) => t.name));
const has = (...tools: string[]) => tools.every((t) => names.has(t));

/**
 * Capability scoreboard for the internal-user requests. Each entry asserts the MCP tool(s) that back
 * the capability exist. Gaps fail here until implemented.
 */
const CAPABILITIES: Array<{ request: string; tools: string[] }> = [
  { request: 'Add, modify and delete sections', tools: ['smartsuite_add_layout_section', 'smartsuite_update_layout_section', 'smartsuite_remove_layout_section'] },
  { request: 'Add, modify and delete tabs', tools: ['smartsuite_add_layout_tab', 'smartsuite_update_layout_tab', 'smartsuite_remove_layout_tab'] },
  { request: 'Arrange fields within sections', tools: ['smartsuite_move_layout_field'] },
  { request: 'Rename fields', tools: ['smartsuite_update_field'] },
  { request: 'Create and update field help descriptions', tools: ['smartsuite_set_field_help_text'] },
  { request: 'Add field types and change field settings', tools: ['smartsuite_create_field', 'smartsuite_update_field'] },
  { request: 'Hide/show fields', tools: ['smartsuite_set_field_visibility'] },
  { request: 'Add/modify/delete display logic (field/section/tab)', tools: ['smartsuite_set_display_logic'] },
  { request: 'Move attachments from one field to another', tools: ['smartsuite_move_attachments'] },
  { request: 'Move a field to another tab (cross-tab)', tools: ['smartsuite_move_layout_field'] },
  { request: 'Rename a table', tools: ['smartsuite_update_application'] },
  { request: 'Create a solution', tools: ['smartsuite_create_solution'] },
  { request: 'Create a table', tools: ['smartsuite_create_application'] },
  { request: 'Set an AI field dynamic prompt', tools: ['smartsuite_create_field', 'smartsuite_update_field'] },
  { request: 'Set a workflow AI-action dynamic prompt', tools: ['smartsuite_set_automation_ai_prompt'] },
  { request: 'Create rollup / lookup fields', tools: ['smartsuite_create_field'] },
  { request: 'Delete a field', tools: ['smartsuite_delete_field'] },
  { request: 'Create, modify and delete views', tools: ['smartsuite_create_view', 'smartsuite_update_view', 'smartsuite_delete_view'] },
  { request: 'Create, modify and delete dashboards', tools: ['smartsuite_create_dashboard', 'smartsuite_update_dashboard', 'smartsuite_delete_dashboard'] },
  { request: 'Add, configure, lay out and remove dashboard widgets', tools: ['smartsuite_add_dashboard_widget', 'smartsuite_update_dashboard_widget', 'smartsuite_remove_dashboard_widget'] },
  { request: 'Normalize existing widget sizes on a dashboard', tools: ['smartsuite_normalize_dashboard_widgets'] },
  { request: 'Bulk-create records', tools: ['smartsuite_create_records'] },
  { request: 'List and restore deleted records', tools: ['smartsuite_list_deleted_records', 'smartsuite_restore_records'] },
  { request: 'List and restore deleted fields', tools: ['smartsuite_list_deleted_fields', 'smartsuite_restore_field'] },
  { request: 'List deleted applications', tools: ['smartsuite_list_deleted_applications'] },
];

describe('capability scoreboard (internal requests → backing tools)', () => {
  for (const cap of CAPABILITIES) {
    it(`supports: ${cap.request} [${cap.tools.join(', ')}]`, () => {
      expect(has(...cap.tools), `missing tool(s): ${cap.tools.filter((t) => !names.has(t)).join(', ')}`).toBe(true);
    });
  }
});
