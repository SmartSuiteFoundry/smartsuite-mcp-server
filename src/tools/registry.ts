export const TOOL_DEFINITIONS = [
  // ── Diagnostics ────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_diagnostics',
    description: 'Validate SmartSuite MCP server configuration and connectivity. Returns server version, mode, and account info. Does not return the API key.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },

  // ── Workspaces ─────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_workspaces',
    description: 'List the SmartSuite workspaces (accounts) the configured API key can access. Only available when SMARTSUITE_ENABLE_CROSS_WORKSPACE=true. Returns slim records: id, slug, name, solutionsCount, status, plan, isPrimary, isAllowed. Use the slug or name with the `workspace` parameter on read tools to target a non-primary workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional substring filter on workspace name or slug' },
      },
    },
    annotations: { readOnlyHint: true },
  },

  // ── Solutions ──────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_solutions',
    description: 'List SmartSuite solutions (workspaces) accessible to the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum results to return (default 50)' },
        cursor: { type: 'string', description: 'Pagination cursor from a previous response' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_get_solution',
    description: 'Get details for a specific SmartSuite solution.',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID' },
      },
      required: ['solutionId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_create_solution',
    description: 'Create a new solution. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Only a name is required; the server assigns a slug, a default logo, and private-to-you permissions. Optionally set logoIcon and logoColor. Add tables to it with smartsuite_create_application. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The solution name.' },
        logoIcon: { type: 'string', description: 'Optional icon name for the solution logo.' },
        logoColor: { type: 'string', description: 'Optional hex color for the solution logo (e.g. "#3A86FF").' },
        confirm: { type: 'boolean', description: 'Set true to create; otherwise returns a dry-run preview.' },
      },
      required: ['name'],
    },
    annotations: { readOnlyHint: false },
  },

  // ── Applications ───────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_applications',
    description: 'List SmartSuite applications (tables). Optionally filter by solution. Returns full table objects by default (heavy — includes each table\'s field structure); set slim:true to return only {id, name, slug, solution, fieldCount}, which is the safe way to inventory a multi-table solution without exceeding the token budget. The response includes a `total` (pre-limit count).',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'Filter by solution ID' },
        slim: { type: 'boolean', description: 'Return a compact shape {id, name, slug, solution, fieldCount} instead of full table objects. Default false. Recommended for multi-table solutions.' },
        limit: { type: 'number', description: 'Maximum number of applications to return. The SmartSuite API ignores this, so it is enforced client-side.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_create_application',
    description: 'Create a new table (application) in a solution. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Supply a name and the solutionId. The table is created with a default "Title" primary field; add more fields with smartsuite_create_field. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The table name.' },
        solutionId: { type: 'string', description: 'The solution to create the table in.' },
        confirm: { type: 'boolean', description: 'Set true to create; otherwise returns a dry-run preview.' },
      },
      required: ['name', 'solutionId'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_describe_application',
    description: 'Describe a SmartSuite application schema, including field slugs, types, and options, plus the record term (custom record terminology). Always call this before creating or updating records so you know field slugs and valid values. Set includeLayout:true to also return the record-view layout (sections with collapse flags, and the field row arrangement of the active layout mode). TOKEN COST: the schema is large; a full table is ~1k+ tokens. The schema is STABLE within a session — call this once per table and reuse the result; do NOT re-describe the same application (use forceRefresh only after you change the schema). When you only need field slugs/types/choices (e.g. to build or query records), use verbosity:"compact" or the lighter smartsuite_list_fields instead of the default.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        includeFields: { type: 'boolean', description: 'Include field definitions (default true)' },
        verbosity: {
          type: 'string',
          enum: ['compact', 'standard', 'full'],
          description: 'Field detail level. "compact" = slug/label/type + choice options + linked-app only (cheapest; use for surveys, CSV/data work, or when scanning many tables). "standard" (default) also adds help text and flags when set. "full" adds the raw params blob (large — only when you need every setting).',
        },
        includeLayout: { type: 'boolean', description: 'Include the record-view layout: { mode, sections (with collapsed flags), rows, hiddenFields }. Default false.' },
        forceRefresh: { type: 'boolean', description: 'Bypass cache and fetch fresh schema. Only needed after the schema changed this session — otherwise redundant.' },
      },
      required: ['applicationId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_list_deleted_applications',
    description: 'List soft-deleted applications (tables) in a solution\'s trash (read-only). Returns id, name, and recordTerm for each. Note: SmartSuite exposes no public endpoint to restore a deleted application, so this is listing only (restore a table from the SmartSuite UI).',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID whose deleted applications to list.' },
      },
      required: ['solutionId'],
    },
    annotations: { readOnlyHint: true },
  },

  // ── Fields ─────────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_fields',
    description: 'List a SmartSuite application\'s fields as a token-lean column list: slug, label, type, choice options (value+label), and linked-app targets — omitting help text and false flags. Cheapest way to learn a table\'s fields; prefer this over smartsuite_describe_application when you just need field slugs/types/choices and not the record layout or help text. The result is stable within a session — call once per table and reuse it.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
      },
      required: ['applicationId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_describe_field',
    description: 'Get detailed metadata for a single field in a SmartSuite application, including help text, choice options, linked-record targets, and — for formula fields — the formula expression and its computed return type.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        fieldSlug: { type: 'string', description: 'The field slug (e.g. s10a908cbe)' },
      },
      required: ['applicationId', 'fieldSlug'],
    },
    annotations: { readOnlyHint: true },
  },

  // ── Formulas ───────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_analyze_formulas',
    description: 'Review and analyze formula fields in a SmartSuite application. Without fieldSlug: returns every formula field with its return type, validity (valid:false = broken formula), native complexity score + tier, and structural metrics (function count, nesting depth, reference counts) — sortable by name or score. With fieldSlug: returns full detail for one formula plus its dependency graph (resolved [field].[field] reference chains across linked tables) as both an ASCII tree and a Mermaid flowchart. Set deep:true to also compute the cross-table Impact Index (samples record counts and link fan-out — several extra API calls).',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        fieldSlug: { type: 'string', description: 'Optional. A specific formula field slug to get full detail + dependency graph. Omit for an application-wide summary of all formula fields.' },
        sortBy: { type: 'string', enum: ['name', 'score'], description: 'Summary sort order (default name). Ignored when fieldSlug is set.' },
        deep: { type: 'boolean', description: 'When fieldSlug is set, also compute the chain-aware Impact Index (record count × link fan-out). Heavier — fires extra record-list calls. Default false.' },
      },
      required: ['applicationId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_validate_formula',
    description: 'Validate a SmartSuite formula expression against an application WITHOUT writing anything (safe in any mode). Returns {valid, safe, warnings} when valid, or a descriptive error message when not (syntax errors, unknown functions, missing field references). Field references use [slug] and chain across linked/compound fields as [slug].[slug]. Use this to check a formula before creating or updating a field.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID the formula will run in (field references are resolved against its schema)' },
        formula: { type: 'string', description: 'The formula expression, e.g. COUNT([sf1ac24c84]) or CONCAT([title], " - ", [status])' },
        returnType: { type: 'string', description: 'Optional declared output field type (e.g. textfield, numberfield, datefield, currencyfield, yesnofield). Validation works without it.' },
      },
      required: ['applicationId', 'formula'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_create_formula_field',
    description: 'Create a new formula field in a SmartSuite application. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. The expression is validated first — an invalid formula is never created. Without confirm:true returns a dry-run preview (validation result + what would be created); set confirm:true to create. The field slug is generated automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        label: { type: 'string', description: 'Display label for the new field' },
        formula: { type: 'string', description: 'The formula expression' },
        returnType: { type: 'string', description: 'Output field type (default textfield). One of: textfield, numberfield, datefield, currencyfield, percentfield, singleselectfield, statusfield, yesnofield, emailfield, phonefield, durationfield, timefield, daterangefield, duedatefield.' },
        afterFieldSlug: { type: 'string', description: 'Optional: place the new field immediately after this existing field slug (defaults to last field).' },
        confirm: { type: 'boolean', description: 'Must be true to actually create. Omit/false for a validate-only dry run.' },
      },
      required: ['applicationId', 'label', 'formula'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_formula_field',
    description: 'Update an existing formula field\'s expression, label, and/or return type. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. The current definition is fetched and only the supplied fields are changed (other params preserved). The new expression is validated first. Without confirm:true returns a dry-run preview (new vs previous); set confirm:true to apply.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        fieldSlug: { type: 'string', description: 'The formula field slug to update' },
        formula: { type: 'string', description: 'New formula expression (optional)' },
        label: { type: 'string', description: 'New display label (optional)' },
        returnType: { type: 'string', description: 'New output field type (optional)' },
        confirm: { type: 'boolean', description: 'Must be true to apply. Omit/false for a validate-only dry run.' },
      },
      required: ['applicationId', 'fieldSlug'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_set_field_help_text',
    description: 'Set or modify a field\'s help text (any field type). Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. helpText is lightweight markdown — paragraphs (blank-line separated), bullet lists (-/*), ordered lists (1.), and inline **bold** / *italic* — converted to SmartSuite\'s rich help_doc. Pass helpText:"" to clear it. displayFormat controls how it shows: "tooltip" (info icon) or "below_field_name". The full field definition is read and rewritten (other params preserved). Applies asynchronously. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        slug: { type: 'string', description: 'The field slug.' },
        helpText: { type: 'string', description: 'Help text as markdown ("" clears it).' },
        displayFormat: { type: 'string', enum: ['tooltip', 'below_field_name'], description: 'How the help text is displayed (default tooltip when setting).' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'slug'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_create_field',
    description: 'Create a field of any type in an application (including rollup and lookup fields — not just formulas). Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. You supply fieldType + label and an OPTIONAL sparse params object; SmartSuite fills type defaults, so most fields need no params. Provide params only where they matter, e.g.: singleselectfield/multipleselectfield/statusfield → {choices:[{label, value_help_text?, weight?}]} where value_help_text is the option DESCRIPTION shown in the dropdown and weight is its NUMERIC value (used by formulas/rollups); e.g. {choices:[{label:"High", value_help_text:"Ship this week", weight:3}]}. Choice colors and order are auto-assigned if omitted so the dropdown renders correctly (status choices take no weight/description); linkedrecordfield → {linked_application:"<app id>", entries_allowed:"single"|"multiple"} (backlink auto-created); rollupfield → {linked_field:"<linkedrecord field slug in THIS table>", field_selection:"<field slug in the LINKED table>", function:"sum"|"count"|"min"|"max"|"average"|"concatenate"|...}; lookupfield → {linked_field, field_selection}; numberfield → {precision, separator}; currencyfield → {currency:"USD"}; textfield → {max_length}. (For formula fields use smartsuite_create_formula_field.) The slug is generated and the field is placed in the record-view layout. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        fieldType: { type: 'string', description: 'SmartSuite field type, e.g. textfield, textareafield, richtextareafield, numberfield, currencyfield, percentfield, datefield, duedatefield, singleselectfield, multipleselectfield, statusfield, yesnofield, linkedrecordfield, userfield, emailfield, phonefield, linkfield, filefield, addressfield, ratingfield, durationfield, timefield, checklistfield, tagsfield, colorpickerfield.' },
        label: { type: 'string', description: 'Field display label.' },
        params: { type: 'object', description: 'Optional sparse field params; omit to accept type defaults. See the tool description for which params each type needs.' },
        afterFieldSlug: { type: 'string', description: 'Optional: place the new field after this field slug (default: end).' },
        confirm: { type: 'boolean', description: 'Must be true to create (default false = preview).' },
      },
      required: ['applicationId', 'fieldType', 'label'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_field',
    description: 'Update a field\'s label and/or params (any type). Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. params is a PATCH — only the keys you pass are changed (shallow-merged onto the existing params); everything else (choices, nested, links) is preserved. Read the field first with smartsuite_describe_field to see current params. Note: choices is replaced wholesale, not merged — to edit select options pass the FULL choices array (each choice may set value_help_text=description and weight=numeric value; colors auto-assigned if omitted). Applies asynchronously. Dry-run preview unless confirm:true. (For help text use smartsuite_set_field_help_text; for formula expressions use smartsuite_update_formula_field.)',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        slug: { type: 'string', description: 'The field slug to update.' },
        label: { type: 'string', description: 'New label (optional).' },
        params: { type: 'object', description: 'Optional params patch (shallow-merged onto existing params). For select fields, omitted choice colors are auto-assigned.' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'slug'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_delete_field',
    description: 'Delete a field from a table by slug. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true AND SMARTSUITE_ENABLE_DELETE=true. Destructive — removes the field and its data (system fields are refused). Useful e.g. to replace a formula field with a rollup: create the rollup, then delete the old formula. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        slug: { type: 'string', description: 'The field slug to delete.' },
        confirm: { type: 'boolean', description: 'Must be true to delete (default false = preview).' },
      },
      required: ['applicationId', 'slug'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'smartsuite_list_deleted_fields',
    description: 'List soft-deleted fields in a solution (read-only). Returns each deleted field\'s slug, label, and fieldType. Solution-scoped — the API does not attribute deleted fields to their source application, so results are not app-filtered. Restore one with smartsuite_restore_field (supplying the applicationId it belonged to).',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID whose deleted fields to list.' },
      },
      required: ['solutionId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_restore_field',
    description: 'Restore a soft-deleted field back into its application. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Supply the applicationId the field belonged to and its slug (from smartsuite_list_deleted_fields). Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) the field belonged to.' },
        slug: { type: 'string', description: 'The deleted field slug to restore.' },
        confirm: { type: 'boolean', description: 'Must be true to restore (default false = preview).' },
      },
      required: ['applicationId', 'slug'],
    },
    annotations: { readOnlyHint: false },
  },

  // ── Record reads ───────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_records',
    description: 'List records from a SmartSuite application. Use smartsuite_describe_application first to learn field slugs. For large result sets, pass format:"compact" and a fields projection to cut token usage substantially.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fetch specific records by ID. When provided, filter and cursor are ignored.',
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Field slugs to include (empty = all fields). Projecting only the fields you need is the biggest token saver.',
        },
        format: { type: 'string', enum: ['json', 'compact'], description: '"json" (default) = array of record objects. "compact" = { columns, rows } table where field names appear once instead of on every record — materially fewer tokens for large lists, lossless for scalar values. Prefer "compact" for big result sets.' },
        limit: { type: 'number', description: 'Max records to return (default 50, max set by server config)' },
        cursor: { type: 'string', description: 'Pagination cursor from a previous response' },
        includeFieldContext: { type: 'boolean', description: 'When true, adds a _fieldContext map to the response with label, type, helpText, and linked field info for each slug. Defaults to SMARTSUITE_AI_ENRICHED_RECORDS server setting.' },
        sort: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              direction: { type: 'string', enum: ['asc', 'desc'] },
            },
            required: ['field', 'direction'],
          },
        },
      },
      required: ['applicationId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_get_record',
    description: 'Get a single SmartSuite record by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        recordId: { type: 'string', description: 'The record ID' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Field slugs to include (empty = all fields)',
        },
        includeFieldContext: { type: 'boolean', description: 'When true, each field value is returned as an annotated object with slug, label, type, helpText, linkedApplication, linkedFieldSlug, and value.' },
      },
      required: ['applicationId', 'recordId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_search_records',
    description: 'Search records using a text query across specified fields.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        query: { type: 'string', description: 'Text to search for' },
        fieldSlugs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Field slugs to search within',
        },
        limit: { type: 'number', description: 'Max records to return (default 25)' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        format: { type: 'string', enum: ['json', 'compact'], description: '"json" (default) or "compact" columns+rows table (fewer tokens for large result sets).' },
        includeFieldContext: { type: 'boolean', description: 'When true, adds a _fieldContext map to the response.' },
      },
      required: ['applicationId', 'query'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_query_records',
    description: 'Query records using a structured SmartSuite filter. Use smartsuite_describe_application first to learn field slugs and valid values for choice fields.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        filter: {
          type: 'object',
          description: 'SmartSuite filter object with operator ("and"/"or") and fields array',
          properties: {
            operator: { type: 'string', enum: ['and', 'or'] },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  comparison: { type: 'string' },
                  value: {},
                },
                required: ['field', 'comparison'],
              },
            },
          },
          required: ['operator'],
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Field slugs to include in results',
        },
        sort: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              direction: { type: 'string', enum: ['asc', 'desc'] },
            },
            required: ['field', 'direction'],
          },
        },
        limit: { type: 'number', description: 'Max records (default 50)' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        format: { type: 'string', enum: ['json', 'compact'], description: '"json" (default) or "compact" columns+rows table (fewer tokens for large result sets).' },
        includeFieldContext: { type: 'boolean', description: 'When true, adds a _fieldContext map to the response.' },
      },
      required: ['applicationId', 'filter'],
    },
    annotations: { readOnlyHint: true },
  },

  // ── Record writes ──────────────────────────────────────────────────────────
  {
    name: 'smartsuite_create_record',
    description: 'Create a new record in a SmartSuite application. Requires readwrite or admin mode. Call smartsuite_describe_application first to learn field slugs.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        fields: {
          type: 'object',
          description: 'Field values keyed by field slug',
        },
      },
      required: ['applicationId', 'fields'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_create_records',
    description: 'Batch-create multiple records in one call. Requires readwrite or admin mode. Supports dry-run (default) then confirm. Respects the server batch-size cap (SMARTSUITE_MAX_BATCH_WRITES). Returns created record IDs and any per-row failures. Call smartsuite_describe_application first to learn field slugs.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        records: {
          type: 'array',
          items: { type: 'object' },
          description: 'Records to create — each an object of field values keyed by slug.',
        },
        dryRun: { type: 'boolean', description: 'If true, validate/preview without writing (default true).' },
        confirm: { type: 'boolean', description: 'Must be true to execute when dryRun is false.' },
      },
      required: ['applicationId', 'records'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_record',
    description: 'Update an existing record. Requires readwrite or admin mode. Only supply fields you want to change.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        recordId: { type: 'string', description: 'The record ID to update' },
        fields: {
          type: 'object',
          description: 'Fields to update, keyed by slug',
        },
      },
      required: ['applicationId', 'recordId', 'fields'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_records',
    description: 'Batch update multiple records. Supports dry-run mode. Requires readwrite or admin mode.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        records: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              recordId: { type: 'string' },
              fields: { type: 'object' },
            },
            required: ['recordId', 'fields'],
          },
          description: 'List of records to update',
        },
        dryRun: { type: 'boolean', description: 'If true, validate only without writing (default true)' },
        confirm: { type: 'boolean', description: 'Must be true to execute when dryRun is false' },
      },
      required: ['applicationId', 'records'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_delete_records',
    description: 'Delete records (soft-delete to the trash). Requires readwrite or admin mode AND SMARTSUITE_ENABLE_DELETE=true. Supports dry-run. The response returns the deleted recordIds; they can be recovered with smartsuite_restore_records (when SMARTSUITE_ENABLE_RESTORE=true) or listed via smartsuite_list_deleted_records.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        recordIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs of records to delete',
        },
        dryRun: { type: 'boolean', description: 'If true, show what would be deleted without deleting (default true)' },
        confirm: { type: 'boolean', description: 'Must be true to execute deletion' },
        confirmationText: { type: 'string', description: 'Must match exactly: "DELETE N RECORDS" where N is the count' },
      },
      required: ['applicationId', 'recordIds'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'smartsuite_list_deleted_records',
    description: 'List soft-deleted records in a solution\'s trash (read-only). Solution-scoped — spans all applications in the solution; pass applicationId to filter to one. Returns id, title, applicationId, applicationName, deletedBy (member id), and deletedAt. Use the returned ids with smartsuite_restore_records. Respects allow/deny lists.',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID whose trash to list.' },
        applicationId: { type: 'string', description: 'Optional: only return deleted records from this application.' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Optional extra field slugs to include per deleted record.' },
        pageSize: { type: 'number', description: 'Max deleted records to return (default 100).' },
        cursor: { type: 'string', description: 'Pagination cursor (next_cursor from a previous response).' },
      },
      required: ['solutionId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_restore_records',
    description: 'Restore soft-deleted records from the trash. Requires readwrite or admin mode AND SMARTSUITE_ENABLE_RESTORE=true. Without confirm:true returns a preview; pass confirm:true to restore. Get record IDs from the smartsuite_delete_records response, the audit log, or smartsuite_list_deleted_records.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application the records belong to.' },
        recordIds: { type: 'array', items: { type: 'string' }, description: 'IDs of deleted records to restore.' },
        confirm: { type: 'boolean', description: 'Set true to restore; otherwise returns a dry-run preview.' },
      },
      required: ['applicationId', 'recordIds'],
    },
    annotations: { readOnlyHint: false },
  },

  // ── Comments ───────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_comments',
    description: 'List comments on a SmartSuite record.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        recordId: { type: 'string', description: 'The record ID' },
        limit: { type: 'number', description: 'Max comments to return (default 50)' },
        cursor: { type: 'string', description: 'Pagination cursor' },
      },
      required: ['applicationId', 'recordId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_create_comment',
    description: 'Add a comment to a SmartSuite record. Requires readwrite or admin mode.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        recordId: { type: 'string', description: 'The record ID' },
        text: { type: 'string', description: 'Comment text' },
      },
      required: ['applicationId', 'recordId', 'text'],
    },
    annotations: { readOnlyHint: false },
  },

  // ── Views & Dashboards ───────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_views',
    description: 'List views for a SmartSuite application (grid, kanban, calendar, timeline, gantt, map, chart, form). Dashboards are excluded — use smartsuite_list_dashboards for those. Returns a slim list by default: id, name, type, description, order, and isDefault (the lowest-order view, inferred since SmartSuite has no explicit default flag). Set includeConfig:true to also return each view\'s filters, sort, group-by, and visible/collapsed fields.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        includeConfig: { type: 'boolean', description: 'Include per-view config (filters, sort, groupBy, visibleFields, collapsedFields). Default false.' },
      },
      required: ['applicationId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_describe_view',
    description: 'Get the full configuration for a single SmartSuite view: filters, sort, group-by, visible/collapsed fields, sharing/permission settings, and the raw view state. Use smartsuite_list_views to find view IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        viewId: { type: 'string', description: 'The view ID' },
      },
      required: ['applicationId', 'viewId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_create_view',
    description: 'Create a view (report) in an application. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Supply applicationId, label (must be unique — the tool checks and suggests an alternative if taken), and viewMode (grid, card, kanban, calendar, timeline, gantt, chart, map). Optionally set the initial configuration: visibleFields (array of field slugs), filters (array of {field, comparison, value}) with filterOperator ("and"/"or"), sort (array of {field, direction:"asc"|"desc"}), and groupBy (array of {field,...}). Omit config to create a view with SmartSuite defaults. Field slugs are validated against the schema. Dry-run preview unless confirm:true. (For forms use smartsuite_create_form; dashboards are separate.)',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID the view belongs to.' },
        label: { type: 'string', description: 'The view name (must be unique within the application).' },
        viewMode: { type: 'string', description: 'View type: grid, card, kanban, calendar, timeline, gantt, chart, or map.' },
        description: { type: 'string', description: 'Optional view description.' },
        visibleFields: { type: 'array', description: 'Optional: field slugs to show, in order.', items: { type: 'string' } },
        filters: { type: 'array', description: 'Optional: filter conditions [{field, comparison, value}].', items: { type: 'object' } },
        filterOperator: { type: 'string', enum: ['and', 'or'], description: 'Combine filters with AND or OR (default and).' },
        sort: { type: 'array', description: 'Optional: sort rules [{field, direction:"asc"|"desc"}].', items: { type: 'object' } },
        groupBy: { type: 'array', description: 'Optional: group-by rules [{field, ...}].', items: { type: 'object' } },
        confirm: { type: 'boolean', description: 'Set true to create; otherwise returns a dry-run preview.' },
      },
      required: ['applicationId', 'label', 'viewMode'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_view',
    description: 'Update a view (report): rename it (label), change its description, and/or change its configuration — visibleFields, filters (+filterOperator), sort, groupBy. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Only the parts you pass are changed; each provided config window replaces that window (e.g. passing sort replaces the sort rules). Field slugs are validated. Refuses forms/dashboards (use their own tools). Use smartsuite_list_views / smartsuite_describe_view to find the viewId and current settings.',
    inputSchema: {
      type: 'object',
      properties: {
        viewId: { type: 'string', description: 'The view (report) ID to update.' },
        label: { type: 'string', description: 'New name (optional; checked for uniqueness).' },
        description: { type: 'string', description: 'New description (optional).' },
        visibleFields: { type: 'array', description: 'Replacement visible field slugs (optional).', items: { type: 'string' } },
        filters: { type: 'array', description: 'Replacement filter conditions [{field, comparison, value}] (optional).', items: { type: 'object' } },
        filterOperator: { type: 'string', enum: ['and', 'or'], description: 'AND/OR for filters (default and).' },
        sort: { type: 'array', description: 'Replacement sort rules [{field, direction}] (optional).', items: { type: 'object' } },
        groupBy: { type: 'array', description: 'Replacement group-by rules (optional).', items: { type: 'object' } },
      },
      required: ['viewId'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_delete_view',
    description: 'Delete a view (report). Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true AND SMARTSUITE_ENABLE_DELETE=true. Refuses to delete the only remaining view of an application, and refuses forms/dashboards (use their own tools). Without confirm:true returns a preview; pass confirm:true to permanently delete. Destructive — cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        viewId: { type: 'string', description: 'The view (report) ID to delete.' },
        confirm: { type: 'boolean', description: 'Set true to permanently delete; otherwise returns a dry-run preview.' },
      },
      required: ['viewId'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_list_dashboards',
    description: 'List dashboards for a SmartSuite application. Returns id, name, description, order, tab count, and the tab list (id/name/order) for each dashboard. Use smartsuite_describe_dashboard for branding and widget detail.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
      },
      required: ['applicationId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_describe_dashboard',
    description: 'Get the full configuration for a single SmartSuite dashboard: tabs, footer/branding, style, and sharing settings. Set includeWidgets:true to also fetch every widget on every tab (type, name, position, size, and parsed params). Widget types include content widgets (hero, simple-banner, heading, faq, text-block, divider) and data widgets (chart, pivot, summary-card, progress, comparison, list-view, card-view, kanban-view, calendar-view, timeline-view, record-details, filter, data-schema).',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        dashboardId: { type: 'string', description: 'The dashboard (report) ID' },
        includeWidgets: { type: 'boolean', description: 'Fetch all widgets for every tab. Default false. Each tab triggers one extra API call.' },
      },
      required: ['applicationId', 'dashboardId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_create_dashboard',
    description: 'Create a dashboard in an application. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Supply applicationId and a unique label (checked; suggests an alternative if taken). Optionally pass tabs (array of tab names, or {name, order} objects) — otherwise one default tab is created. Add widgets afterward with smartsuite_add_dashboard_widget. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID the dashboard belongs to.' },
        label: { type: 'string', description: 'Dashboard name (unique within the application).' },
        description: { type: 'string', description: 'Optional description.' },
        tabs: { type: 'array', description: 'Optional tab names (strings) or {name, order} objects. Default: one tab named "Tab".', items: { type: ['string', 'object'] } },
        confirm: { type: 'boolean', description: 'Set true to create; otherwise returns a dry-run preview.' },
      },
      required: ['applicationId', 'label'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_dashboard',
    description: 'Update a dashboard: rename (label), change description, and/or edit tabs, footer, and style. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. tabs REPLACES the tab set — pass the full desired list as {id?, name, order?}; include a tab\'s existing id to rename/reorder it (get ids from smartsuite_describe_dashboard), omit id to add a new tab, drop a tab to remove it (its widgets go too). tabsEnabled toggles the tab bar; tabsPosition is "left"/"top". footer/style are merged onto the existing config.',
    inputSchema: {
      type: 'object',
      properties: {
        dashboardId: { type: 'string', description: 'The dashboard (report) ID.' },
        label: { type: 'string', description: 'New name (optional; checked for uniqueness).' },
        description: { type: 'string', description: 'New description (optional).' },
        tabs: { type: 'array', description: 'Replacement tab set: [{id?, name, order?}]. Keep ids to preserve/rename tabs; omit id to add; drop to remove.', items: { type: ['string', 'object'] } },
        tabsEnabled: { type: 'boolean', description: 'Show/hide the tab bar.' },
        tabsPosition: { type: 'string', description: 'Tab bar position: "left" or "top".' },
        footer: { type: 'object', description: 'Footer config overrides (merged).' },
        style: { type: 'object', description: 'Style overrides, e.g. {width, background_color} (merged).' },
      },
      required: ['dashboardId'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_delete_dashboard',
    description: 'Delete a dashboard and all its widgets. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true AND SMARTSUITE_ENABLE_DELETE=true. Refuses non-dashboard reports. Without confirm:true returns a preview; pass confirm:true to permanently delete. Destructive — cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        dashboardId: { type: 'string', description: 'The dashboard (report) ID to delete.' },
        confirm: { type: 'boolean', description: 'Set true to permanently delete; otherwise returns a dry-run preview.' },
      },
      required: ['dashboardId'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_add_dashboard_widget',
    description: 'Add a widget to a dashboard tab. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Supply dashboardId, widgetType, and optionally tabId (defaults to the first tab), name, position {x,y}, size {width,height}, and params. VALID widgetType values — content: text-block-widget, heading-widget, simple-banner-widget, hero-widget, faq-widget, divider-widget; data: list-view-widget, card-view-widget, kanban-view-widget, calendar-view-widget, timeline-view-widget, chart-widget, pivot-widget, summary-card-widget, progress-widget, comparison-widget, filter-widget, record-details-widget, data-schema-widget; other: spacing-widget, button-row-widget, webpage-widget, record-picker-widget, countdown-widget, world-clock-widget (these last six have no auto-fill template — supply params). LAYOUT: x/width are column units (4 = full width), y/height are pixels. If you omit position/size, the widget gets its natural per-type default size (e.g. summary-card/progress/comparison are width 1, height 128; charts width 2; list/calendar width 4) — so metric cards render at the right height. If you omit position, the widget is appended BELOW existing widgets on the tab (not stacked at 0,0, which would overlap/hide widgets) — set position only to place deliberately (e.g. side-by-side metric cards need explicit x). The widget is created with a valid accent color and non-null description/collapsed defaults so the UI highlight-color editor works; pass `color` (hex) to choose the accent. PARAMS is widget-type-specific and passed through as-is. It is now OPTIONAL: if you omit params, the tool fills a minimal valid template for the widget type (data widgets default to showing the dashboard\'s own application with sensible default fields), so any of the 19 types can be created with just dashboardId + widgetType. Supply params only to customize — e.g. text-block/heading {content:<prosemirror doc>}, divider {color}, data widgets {solution, application, source, ...window objects, filters, fields}. To customize a data widget precisely, describe an existing widget of the same type (smartsuite_describe_dashboard includeWidgets:true) and adapt it. The response includes filledFromTemplate:true when a default template was used.',
    inputSchema: {
      type: 'object',
      properties: {
        dashboardId: { type: 'string', description: 'The dashboard (report) ID.' },
        tabId: { type: 'string', description: 'Tab id to place the widget on (default: first tab).' },
        widgetType: { type: 'string', description: 'One of the 19 valid widget types (content or data) listed in the tool description.' },
        name: { type: 'string', description: 'Widget name/title (optional).' },
        position: { type: 'object', description: 'Grid position {x, y} — x is column units, y is pixels. Default {0,0}.', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        size: { type: 'object', description: 'Size {width, height} — width is column units, height is pixels. Default {width:4, height:200}.', properties: { width: { type: 'number' }, height: { type: 'number' } } },
        params: { type: 'object', description: 'Widget-type-specific configuration, passed through. Data widgets need a source; copy the shape from an existing widget of the same type.' },
        color: { type: 'string', description: 'Optional accent color (hex, e.g. "#3A86FF"). Defaults to a valid color so the UI highlight-color editor works.' },
      },
      required: ['dashboardId', 'widgetType'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_dashboard_widget',
    description: 'Update a dashboard widget\'s settings and/or layout. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Change position {x,y} and size {width,height} to move/resize (x/width columns, y/height pixels), rename (name), toggle showName/collapsedByDefault, set color/description, move to another tab (tabId), or replace params. NOTE: params is replaced wholesale — to tweak it, read the widget first via smartsuite_describe_dashboard(includeWidgets:true) and pass the full new params object.',
    inputSchema: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'The widget ID (from describe_dashboard).' },
        name: { type: 'string', description: 'New name (optional).' },
        position: { type: 'object', description: 'New position {x, y} (optional).', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        size: { type: 'object', description: 'New size {width, height} (optional).', properties: { width: { type: 'number' }, height: { type: 'number' } } },
        params: { type: 'object', description: 'Replacement params object (optional; replaces wholesale).' },
        showName: { type: 'boolean', description: 'Show the widget title (optional).' },
        collapsedByDefault: { type: 'boolean', description: 'Collapse the widget by default (optional).' },
        color: { type: 'string', description: 'Widget accent color (optional).' },
        description: { type: 'string', description: 'Widget description (optional).' },
        tabId: { type: 'string', description: 'Move the widget to a different tab (optional).' },
      },
      required: ['widgetId'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_remove_dashboard_widget',
    description: 'Remove a widget from a dashboard. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true AND SMARTSUITE_ENABLE_DELETE=true. Without confirm:true returns a preview; pass confirm:true to permanently delete. Destructive — cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'The widget ID to delete.' },
        confirm: { type: 'boolean', description: 'Set true to permanently delete; otherwise returns a dry-run preview.' },
      },
      required: ['widgetId'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_normalize_dashboard_widgets',
    description: 'Reset existing widgets on a dashboard to their natural per-type size. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Fixes dashboards whose widgets were created with a wrong/uniform size — e.g. metric/summary cards left too tall (which re-saving in the UI does not correct). Dry-run preview (before→after per widget) unless confirm:true. By default only HEIGHT is normalized (leaving width/position so row layouts aren\'t reflowed); pass dimension:"both" to also fix width. Restrict with widgetTypes (e.g. ["summary-card-widget"]) or tabId. Note: sizes are corrected in place; it does not re-flow surrounding widgets, so a shrunk widget may leave a gap.',
    inputSchema: {
      type: 'object',
      properties: {
        dashboardId: { type: 'string', description: 'The dashboard (report) ID.' },
        tabId: { type: 'string', description: 'Optional: only normalize widgets on this tab.' },
        widgetTypes: { type: 'array', items: { type: 'string' }, description: 'Optional: only normalize these widget types (e.g. ["summary-card-widget"]).' },
        dimension: { type: 'string', enum: ['height', 'both'], description: '"height" (default) fixes height only; "both" also fixes width.' },
        confirm: { type: 'boolean', description: 'Set true to apply; otherwise returns a dry-run preview of the changes.' },
      },
      required: ['dashboardId'],
    },
    annotations: { readOnlyHint: false },
  },

  // ── Forms ──────────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_forms',
    description: 'List forms (form-type report views) for a SmartSuite application. Returns each form\'s id, name, description, page count, bound-field count, sharing state, and public form URL (when sharing is enabled). Forms are how external/internal users submit records; in ITSM dashboards they are launched from button-row widgets.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
      },
      required: ['applicationId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_describe_form',
    description: 'Get the full structure of a SmartSuite form for review: settings (title, description, submit label, redirect, branding, logo), sharing (enabled, public URL, password protection), and the page-by-page layout. Each page is an input (form), review, or submission page. Input-page items are parsed into bound fields (slug, label, required, help text) and content elements (heading, html_block/paragraph, callout, consent, divider, image, video, recaptcha, pdf_viewer), including section groupings and conditional-visibility flags.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        formId: { type: 'string', description: 'The form (report) ID' },
      },
      required: ['applicationId', 'formId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_create_form',
    description: 'Create a new form for a SmartSuite application. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. The label is checked for uniqueness and any supplied field slugs are validated against the application schema first. Without confirm:true returns a dry-run preview; set confirm:true to create. Optionally seed the first input page with fields and set form settings.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID the form submits into' },
        label: { type: 'string', description: 'Form name (must be unique among the application\'s reports)' },
        fields: {
          type: 'array',
          description: 'Optional fields to place on the first input page. Each item is a field slug string, or an object { slug, required, label, helpText }.',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  slug: { type: 'string' },
                  required: { type: 'boolean' },
                  label: { type: 'string' },
                  helpText: { type: 'string' },
                },
                required: ['slug'],
              },
            ],
          },
        },
        title: { type: 'string', description: 'Form title shown to submitters' },
        description: { type: 'string', description: 'Form description' },
        submitLabel: { type: 'string', description: 'Submit button label' },
        redirectToUrl: { type: 'string', description: 'URL to redirect to after submission' },
        displaySmartSuiteBranding: { type: 'boolean', description: 'Show SmartSuite branding on the form' },
        confirm: { type: 'boolean', description: 'Must be true to create. Omit/false for a dry-run preview.' },
      },
      required: ['applicationId', 'label'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_form',
    description: 'Update a form\'s settings and/or structure. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Provide any of: settings (title/description/submitLabel/redirectToUrl/displaySmartSuiteBranding) to merge; `fields` to replace the first input page\'s fields (slugs validated against the schema); or `formState` as a full raw form_state object (advanced escape hatch, replaces everything). Without confirm:true returns a dry-run preview; set confirm:true to apply.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        formId: { type: 'string', description: 'The form (report) ID' },
        fields: {
          type: 'array',
          description: 'Replace the first input page\'s fields. Each item is a slug string or { slug, required, label, helpText }.',
          items: {
            oneOf: [
              { type: 'string' },
              { type: 'object', properties: { slug: { type: 'string' }, required: { type: 'boolean' }, label: { type: 'string' }, helpText: { type: 'string' } }, required: ['slug'] },
            ],
          },
        },
        formState: { type: 'object', description: 'Advanced: a complete form_state object ({ pages: [...] , ...settings }) that replaces the form structure wholesale. Mutually exclusive with fields.' },
        title: { type: 'string' },
        description: { type: 'string' },
        submitLabel: { type: 'string' },
        redirectToUrl: { type: 'string' },
        displaySmartSuiteBranding: { type: 'boolean' },
        confirm: { type: 'boolean', description: 'Must be true to apply. Omit/false for a dry-run preview.' },
      },
      required: ['applicationId', 'formId'],
    },
    annotations: { readOnlyHint: false },
  },

  {
    name: 'smartsuite_submit_form',
    description: 'Submit a SmartSuite form — creates a record through the form\'s submission pipeline, exactly as a user filling out the form would. Two-step: call WITHOUT `values` to get the form\'s input spec (fields to collect, with type and choice hints); then call WITH `values` (keyed by field slug, using normal SmartSuite record value shapes) to submit. Validates that supplied fields are on the form and that required fields are present. Submitting requires readwrite or admin mode (it creates a record).',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID the form belongs to' },
        formId: { type: 'string', description: 'The form (report) ID — from smartsuite_list_forms' },
        values: { type: 'object', description: 'Field values keyed by slug (same shapes as record create). Omit to preview the form\'s fields first.' },
      },
      required: ['applicationId', 'formId'],
    },
    annotations: { readOnlyHint: false },
  },

  // ── Automations ────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_automations',
    description: 'List automations for a solution. Automations are scoped per solution (not per table). Returns each automation\'s id, name, enabled state, trigger reference, action count/types, and generated description.',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID' },
      },
      required: ['solutionId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_describe_automation',
    description: 'Get the full configuration for one automation: trigger config and all action groups, plus name, enabled state, and timezone. Use smartsuite_list_automations to find automation IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID' },
        automationId: { type: 'string', description: 'The automation ID' },
      },
      required: ['solutionId', 'automationId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_describe_automation_step',
    description: 'Resolve the full schema of one automation step — its trigger (default) or a chosen action — by calling the automation engine\'s dynamic description. For a trigger: returns label, inputs (with dropdown options), context outputs, the fields the trigger exposes to downstream actions, and the fields usable in conditions. For an action: returns label, integration, and inputs (with options). Use smartsuite_describe_automation first to see the action list; select an action with actionIndex or actionInstanceId. This view is for UNDERSTANDING a step (labels, types, option values) and is slimmed — do NOT feed it back into update_automation to edit an action; it omits full input encodings (e.g. an AI action\'s model), and saving a rebuild from it can strip those settings.',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID' },
        automationId: { type: 'string', description: 'The automation ID' },
        step: { type: 'string', enum: ['trigger', 'action'], description: 'Which step to resolve (default trigger).' },
        actionIndex: { type: 'number', description: 'When step=action: 0-based index across the automation\'s actions (default 0).' },
        actionInstanceId: { type: 'number', description: 'When step=action: select the action by its action_reference.instance_id instead of index.' },
      },
      required: ['solutionId', 'automationId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_get_automation_limits',
    description: 'Get the workspace\'s automation run usage and plan limit (account-wide). Returns plan category (e.g. enterprise), the automation run limit, runs used, remaining, percent used, and whether the limit is enforced. Use this for "how much of our automation quota are we using?" and plan-type questions.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_list_automation_credentials',
    description: 'List the integration credentials configured for a solution\'s automations (e.g. Gmail, Slack, Microsoft Teams, webhooks, SmartSuite). Returns each credential\'s id, integration, auth method, and label. Use this to review which external integrations a solution\'s automations connect to.',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID' },
      },
      required: ['solutionId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_list_solution_members',
    description: 'List the members available to a solution (id, name, email, job title, status). These are the members automations can assign work to or run as. Also useful for resolving member ids seen in records, assignments, and credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID' },
      },
      required: ['solutionId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_create_automation',
    description: 'Create an automation in a solution. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. You supply the trigger (an object with trigger_reference.trigger_id and inputs) and the actions; use smartsuite_describe_automation_step on a similar existing automation to learn the exact trigger/action/input shapes and option values. Pass actions either as the native nested actionGroups ([{actions:{actions:[...]}}]) or as a flat actions array (wrapped into one group automatically). Pass credentialId once to fill it onto the trigger and every action that omits one. automaticDescription (the UI display phrase) and timezone are optional.',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID the automation belongs to.' },
        label: { type: 'string', description: 'Automation name.' },
        trigger: { type: 'object', description: 'Trigger object: { trigger_reference:{integration_id, trigger_id}, credential_id?, inputs:[...], conditions?:{...} }.' },
        actionGroups: { type: 'array', description: 'Native action groups: [{actions:{actions:[<action>...]}}]. Mutually exclusive with `actions`.', items: { type: 'object' } },
        actions: { type: 'array', description: 'Flat list of action objects; wrapped into a single action group. Each: { action_reference:{integration_id, action_id, instance_id}, credential_id?, inputs:[...], record_list?:{...} }.', items: { type: 'object' } },
        credentialId: { type: 'string', description: 'Optional: fill this credential_id onto the trigger and any action missing one.' },
        automaticDescription: { type: 'string', description: 'Optional UI display phrase (phrase-builder JSON string). Omit to leave blank.' },
        timezone: { type: 'string', description: 'Optional IANA timezone (e.g. America/Chicago).' },
      },
      required: ['solutionId', 'label', 'trigger'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_automation',
    description: 'Update an existing automation. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Fetches the current automation and applies only the fields you provide — label, trigger, actionGroups/actions, automaticDescription, timezone — preserving the rest (including first_created and the untouched trigger/actions). Pass credentialId to fill missing credentials. IMPORTANT — preserve fidelity: trigger and action groups you supply REPLACE the existing ones wholesale (no per-action merge). To change only the label/description, OMIT trigger and actions so they are preserved byte-for-byte. Do NOT rebuild an action or trigger from smartsuite_describe_automation_step output — that view is SLIMMED (it drops input encodings such as an AI action\'s model setting); reconstructing from it and saving will strip those settings and can leave the automation invalid (which the engine then marks disabled). If you must edit one action, start from the raw automation object and change only the target input. The `enabled` state is engine-computed from validity — you cannot set it directly; a disabled result means the automation is invalid (see the returned statusReason).',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID the automation belongs to.' },
        automationId: { type: 'string', description: 'The automation ID to update.' },
        label: { type: 'string', description: 'New name (optional).' },
        trigger: { type: 'object', description: 'Replacement trigger object (optional).' },
        actionGroups: { type: 'array', description: 'Replacement native action groups (optional). Mutually exclusive with `actions`.', items: { type: 'object' } },
        actions: { type: 'array', description: 'Replacement flat action list, wrapped into one group (optional).', items: { type: 'object' } },
        credentialId: { type: 'string', description: 'Optional: fill this credential_id onto the trigger and any action missing one.' },
        automaticDescription: { type: 'string', description: 'New UI display phrase (optional).' },
        timezone: { type: 'string', description: 'New IANA timezone (optional).' },
      },
      required: ['solutionId', 'automationId'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_delete_automation',
    description: 'Delete an automation. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true AND SMARTSUITE_ENABLE_DELETE=true. Without confirm:true it returns a preview of what would be deleted; pass confirm:true to permanently delete. Destructive — cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'The solution ID the automation belongs to.' },
        automationId: { type: 'string', description: 'The automation ID to delete.' },
        confirm: { type: 'boolean', description: 'Must be true to actually delete (default false = preview only).' },
      },
      required: ['solutionId', 'automationId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },

  // ── My Work ──────────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_my_work',
    description: 'List the authenticated user\'s assigned work ("My Work") — comment mentions, assigned checklist items, and records assigned via people fields — for answering questions like "what\'s on my plate?", "how many open items are overdue?", or "what\'s assigned to me in this solution?". Returns a summary (totals, overdue count, breakdowns by item type / priority / solution) plus the items themselves (with a truncated text preview). Defaults to open items; set status:"resolved" for completed work (which also returns per-period counts).',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'resolved'], description: 'open (default) = unresolved assigned items; resolved = completed items.' },
        period: { type: 'string', enum: ['today', 'this_week', 'this_month', 'previous_month', 'last_year'], description: 'Optional time bucket filter (most useful with status:resolved).' },
        solutionId: { type: 'string', description: 'Filter to one solution ID' },
        applicationId: { type: 'string', description: 'Filter to one application ID' },
        itemType: { type: 'string', enum: ['comment', 'checklist_item', 'record'], description: 'Filter by item type' },
        priority: { type: 'string', description: 'Filter by priority value (e.g. "high")' },
        overdueOnly: { type: 'boolean', description: 'Only items with a due date in the past (open items)' },
        limit: { type: 'number', description: 'Max items to return (default 50). The summary always reflects the full filtered set.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_update_my_work',
    description: 'Update one of the authenticated user\'s My Work items: mark it resolved/open and/or set its due date. Requires readwrite or admin mode. Use smartsuite_list_my_work to find the item id. Returns the updated item.',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string', description: 'The My Work item id (the "id" field from smartsuite_list_my_work)' },
        status: { type: 'string', enum: ['open', 'resolved'], description: 'Mark the item resolved or reopen it.' },
        dueDate: { type: ['string', 'null'], description: 'Set the due date (ISO 8601, e.g. "2026-07-01T00:00:00Z"), or null to clear it.' },
      },
      required: ['itemId'],
    },
    annotations: { readOnlyHint: false },
  },

  // ── SmartDocs ──────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_get_smartdoc_content',
    description: 'Retrieve the content of a SmartDoc field as plain text and raw value.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        recordId: { type: 'string', description: 'The record ID' },
        fieldSlug: { type: 'string', description: 'The SmartDoc field slug' },
      },
      required: ['applicationId', 'recordId', 'fieldSlug'],
    },
    annotations: { readOnlyHint: true },
  },
  // ── Files ──────────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_get_file_url',
    description: [
      'Resolve a SmartSuite file handle to a signed CDN download URL.',
      'SmartSuite file fields (type: filefield) return an array of file objects — each has a "handle" property.',
      'Pass that handle here to get a temporary URL for downloading the file.',
      'Example field value: [{ "handle": "abc123", "filename": "report.pdf", "size": 12345, "mimetype": "application/pdf" }]',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        fileHandle: { type: 'string', description: 'The Filestack handle from a file field value (the "handle" property)' },
      },
      required: ['fileHandle'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_upload_file',
    description: 'Upload a file from the local filesystem to a SmartSuite file field. Requires readwrite or admin mode. The file is read from the local path and posted as multipart form data.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        recordId: { type: 'string', description: 'The record ID' },
        fieldSlug: { type: 'string', description: 'The file field slug' },
        filePath: { type: 'string', description: 'Absolute or relative path to the file on the local filesystem' },
        filename: { type: 'string', description: 'Override the filename sent to SmartSuite (defaults to the basename of filePath)' },
      },
      required: ['applicationId', 'recordId', 'fieldSlug', 'filePath'],
    },
    annotations: { readOnlyHint: false },
  },

  {
    name: 'smartsuite_append_smartdoc_content',
    description: 'Append markdown content to a SmartDoc field. Requires readwrite or admin mode. Does not replace existing content.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        recordId: { type: 'string', description: 'The record ID' },
        fieldSlug: { type: 'string', description: 'The SmartDoc field slug' },
        content: { type: 'string', description: 'Markdown content to append' },
        confirm: { type: 'boolean', description: 'Must be true to execute' },
      },
      required: ['applicationId', 'recordId', 'fieldSlug', 'content'],
    },
    annotations: { readOnlyHint: false },
  },

  // ── Record-view layout (sections) ─────────────────────────────────────────────
  {
    name: 'smartsuite_add_layout_section',
    description: 'Add a section (a labeled grouping) to an application\'s record-view layout. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE. A section groups the fields that follow it (until the next section) in the record detail view. By default edits the top-level layout; pass tabId to edit a specific tab\'s layout when tabs are enabled. Place it after a field with afterField (the section appears just after that field; fields after it fall under the section), or omit to append at the end. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        title: { type: 'string', description: 'Section title.' },
        description: { type: 'string', description: 'Optional section description (plain text; blank lines start new paragraphs).' },
        afterField: { type: 'string', description: 'Optional field slug to place the section after (default: append at end).' },
        collapsed: { type: 'boolean', description: 'Start collapsed (default false).' },
        hidden: { type: 'boolean', description: 'Hidden section (default false).' },
        tabId: { type: 'string', description: 'Which layout to edit when tabs are enabled (REQUIRED then): a tab id, "all" for every tab, or "top" for the hidden top-level layout. Omit only when tabs are disabled.' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'title'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_layout_section',
    description: 'Update an existing record-view layout section (title, description, collapsed, hidden) by its section__… slug. Requires schema-write. Pass description:"" to clear it. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        slug: { type: 'string', description: 'The section slug (section__…).' },
        title: { type: 'string', description: 'New title.' },
        description: { type: 'string', description: 'New description (plain text; "" clears it).' },
        collapsed: { type: 'boolean', description: 'Collapsed state.' },
        hidden: { type: 'boolean', description: 'Hidden state.' },
        tabId: { type: 'string', description: 'Which layout to edit when tabs are enabled (REQUIRED then): a tab id, "all" for every tab, or "top" for the hidden top-level layout. Omit only when tabs are disabled.' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'slug'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_remove_layout_section',
    description: 'Remove a section from an application\'s record-view layout by its section__… slug. Requires schema-write. Removes only the section grouping; fields that were under it are preserved (they just rejoin the surrounding layout). Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        slug: { type: 'string', description: 'The section slug (section__…) to remove.' },
        tabId: { type: 'string', description: 'Which layout to edit when tabs are enabled (REQUIRED then): a tab id, "all" for every tab, or "top" for the hidden top-level layout. Omit only when tabs are disabled.' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'slug'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'smartsuite_add_layout_tab',
    description: 'Add a tab to an application\'s record-view layout. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE. Enables tabs if not already on (the first tab mirrors the current top-level layout so existing fields stay visible; later tabs start empty). Optional description, position (0-based; default end), and tab-bar style ("basic"/"process"/"journey") / align (container-level). Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        name: { type: 'string', description: 'Tab name.' },
        description: { type: 'string', description: 'Optional tab description (plain text).' },
        position: { type: 'number', description: 'Optional 0-based position (default: append at end).' },
        style: { type: 'string', enum: ['basic', 'process', 'journey'], description: 'Optional tab-bar style for the whole table.' },
        align: { type: 'string', description: 'Optional tab-bar alignment (e.g. "left").' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'name'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_layout_tab',
    description: 'Update a record-view tab (name, description, position) by its tab id, and/or the tab-bar style/align. Requires schema-write. Pass description:"" to clear it. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        tabId: { type: 'string', description: 'The tab id to update.' },
        name: { type: 'string', description: 'New tab name.' },
        description: { type: 'string', description: 'New description (plain text; "" clears it).' },
        position: { type: 'number', description: 'New 0-based position (reorders tabs).' },
        style: { type: 'string', enum: ['basic', 'process', 'journey'], description: 'Tab-bar style for the whole table.' },
        align: { type: 'string', description: 'Tab-bar alignment (e.g. "left").' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'tabId'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_remove_layout_tab',
    description: 'Remove a tab from an application\'s record-view layout by its tab id. Requires schema-write. Fields remain in the top-level layout (not deleted). Removing the last tab disables tabs. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        tabId: { type: 'string', description: 'The tab id to remove.' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'tabId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'smartsuite_move_layout_field',
    description: 'Move/arrange a field in the record-view layout — reorder it, place it under a section, or move it to a different tab. Requires readwrite/admin + SMARTSUITE_ENABLE_SCHEMA_WRITE. To move a field to ANOTHER tab, pass toTab = the destination tab id: the field is removed from its current tab and added to the destination (this is the cross-tab move — plain reorder can\'t pull a field in from another tab). Otherwise it reorders within the current layout. Pass afterField = a field slug OR a section__ slug to position this field right after it (right after a section marker = first field under that section); omit afterField for the end. In two-column layouts the field is placed as its own full-width row. When tabs are enabled and toTab is NOT used, tabId is required (a tab id, "all", or "top"). Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        slug: { type: 'string', description: 'The field slug to move.' },
        toTab: { type: 'string', description: 'Destination tab id — moves the field to that tab (removing it from its current tab). Use this for cross-tab moves.' },
        afterField: { type: 'string', description: 'Field slug or section__ slug to place this field after (default: end).' },
        tabId: { type: 'string', description: 'For within-layout reorder when tabs are enabled (required then): a tab id, "all", or "top". Ignored when toTab is set. Omit when tabs are disabled.' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'slug'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_update_application',
    description: 'Update table (application) attributes — rename the table (name) and/or change its record term (e.g. "record" → "invoice"). Requires readwrite/admin + SMARTSUITE_ENABLE_SCHEMA_WRITE. Dry-run preview unless confirm:true. (This is the table rename tool; for field renames use smartsuite_update_field.)',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        name: { type: 'string', description: 'New table name.' },
        recordTerm: { type: 'string', description: 'Optional: singular record term for the table (e.g. "invoice").' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_set_field_visibility',
    description: 'Hide or show a field in the record view. Requires readwrite/admin + SMARTSUITE_ENABLE_SCHEMA_WRITE. hidden:true hides the field (adds it to the layout\'s record-wide hidden_fields list); hidden:false shows it. Hidden fields stay in the layout structure but aren\'t displayed; this is record-wide (not per-tab). Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        slug: { type: 'string', description: 'The field slug to hide or show.' },
        hidden: { type: 'boolean', description: 'true = hide the field, false = show it.' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'slug', 'hidden'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'smartsuite_set_display_logic',
    description: 'Add, modify, or remove display (visibility) logic on a field, section, or tab — show it only when conditions on other fields are met. Requires readwrite/admin + SMARTSUITE_ENABLE_SCHEMA_WRITE. Set target ("field"|"section"|"tab") + targetId (field slug / section__ slug / tab id) and conditions: an array of {comparison, field, value} combined by operator ("and"/"or"); pass clear:true to remove the rule. Example: show the Priority field only when Status is complete → target:"field", targetId:"priority", conditions:[{comparison:"is", field:"status", value:"complete"}]. Common comparisons: is, is_not, is_empty, is_not_empty, contains. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        target: { type: 'string', enum: ['field', 'section', 'tab'], description: 'What the rule controls.' },
        targetId: { type: 'string', description: 'Field slug, section__ slug, or tab id (matching target).' },
        operator: { type: 'string', enum: ['and', 'or'], description: 'How multiple conditions combine (default and).' },
        conditions: { type: 'array', description: 'Conditions: [{comparison, field, value}]. The target shows when these are met.', items: { type: 'object', properties: { comparison: { type: 'string' }, field: { type: 'string', description: 'Slug of the field the condition checks.' }, value: {} }, required: ['comparison', 'field'] } },
        clear: { type: 'boolean', description: 'Remove the existing rule from the target (ignores conditions).' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'target', 'targetId'],
    },
    annotations: { readOnlyHint: false },
  },

  {
    name: 'smartsuite_move_attachments',
    description: 'Move attachments (files) from one file field to another. Requires readwrite/admin mode. Copies the source field\'s files into the target field (handles reference existing storage — no re-upload) and clears the source. Target one record with recordId, or every record that has source files with allRecords:true (capped at SMARTSUITE_MAX_RECORDS). mode "append" (default) keeps the target\'s existing files; "replace" overwrites. Set clearSource:false to copy instead of move. Both fields must be filefield type. Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        sourceFieldSlug: { type: 'string', description: 'File field slug to move attachments FROM.' },
        targetFieldSlug: { type: 'string', description: 'File field slug to move attachments TO.' },
        recordId: { type: 'string', description: 'Move for a single record (omit to use allRecords).' },
        allRecords: { type: 'boolean', description: 'Move for every record that has source files (capped at SMARTSUITE_MAX_RECORDS).' },
        mode: { type: 'string', enum: ['append', 'replace'], description: 'append (default) keeps target\'s existing files; replace overwrites the target.' },
        clearSource: { type: 'boolean', description: 'Clear the source field after copying (default true = move; false = copy).' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'sourceFieldSlug', 'targetFieldSlug'],
    },
    annotations: { readOnlyHint: false },
  },

  // ── Solution migration / schema diff ──────────────────────────────────────────
  {
    name: 'smartsuite_match_solutions',
    description: 'Step 1 of solution migration: match solutions in a lower-environment workspace to those in your primary (production) workspace by exact name, since object ids differ across workspaces. Set your primary workspace to production (the migration target). Requires SMARTSUITE_ENABLE_CROSS_WORKSPACE. Without confirm, returns proposed matches (exact / ambiguous / unmatched) for review. Re-call with confirm:true to confirm unambiguous matches, and overrides:[{sourceId,prodId}] to resolve ambiguous/unmatched ones. Persists to a project mapping file.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Migration project name (namespaces the saved mapping/diff files).' },
        sourceWorkspace: { type: 'string', description: 'The lower-environment workspace slug or name (must be allow-listed and differ from primary).' },
        nameFilter: { type: 'string', description: 'Optional: only consider source solutions whose name contains this string.' },
        confirm: { type: 'boolean', description: 'Confirm unambiguous (1:1) name matches. Default false (propose only).' },
        overrides: { type: 'array', description: 'Manual resolutions: [{sourceId, prodId}] to pin a source solution to a specific prod solution.', items: { type: 'object', properties: { sourceId: { type: 'string' }, prodId: { type: 'string' } }, required: ['sourceId', 'prodId'] } },
      },
      required: ['project', 'sourceWorkspace'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_match_applications',
    description: 'Step 2 of solution migration: for one confirmed solution pair, match its tables (applications) by exact name (table ids AND slugs both regenerate across workspaces, so name is the only handle). Same confirm/overrides flow as match_solutions. Persists the lower→prod table-id map into the project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Migration project name.' },
        solution: { type: 'string', description: 'Name of a confirmed solution pair (from match_solutions).' },
        confirm: { type: 'boolean', description: 'Confirm unambiguous table matches. Default false.' },
        overrides: { type: 'array', description: 'Manual table resolutions: [{sourceId, prodId}].', items: { type: 'object', properties: { sourceId: { type: 'string' }, prodId: { type: 'string' } }, required: ['sourceId', 'prodId'] } },
      },
      required: ['project', 'solution'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_diff_schemas',
    description: 'Step 3 of solution migration: compare table/field schemas (lower → prod) for confirmed mappings and write the diff package. Fields match by slug (stable across cloned workspaces); cross-table references are remapped via the table map and system-generated values are ignored, so only real differences surface. With scope "all" (default) it also diffs views and forms in full and dashboards at the report-config level (matched by name); scope "schema" limits to tables + fields. Classifies added / removed / modified (with per-property detail and compatible/risky risk). Writes diff.json and returns a summary.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Migration project name.' },
        solution: { type: 'string', description: 'Optional: limit to one confirmed solution (default: all confirmed).' },
        scope: { type: 'string', enum: ['all', 'schema'], description: 'all (default) = tables, fields, views, forms, dashboards; schema = tables + fields only.' },
      },
      required: ['project'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_export_diff',
    description: 'Step 4 of solution migration: render the project diff as a human-readable XLSX (summary tab + per-change detail) alongside the JSON. Run smartsuite_diff_schemas first. Returns the written file paths.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Migration project name.' },
        format: { type: 'string', enum: ['xlsx', 'json', 'both'], description: 'Output format (default both).' },
      },
      required: ['project'],
    },
    annotations: { readOnlyHint: true },
  },
] as const;
