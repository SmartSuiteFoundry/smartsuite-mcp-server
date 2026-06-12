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
    name: 'smartsuite_describe_application',
    description: 'Describe a SmartSuite application schema, including field slugs, types, and options, plus the record term (custom record terminology). Always call this before creating or updating records so you know field slugs and valid values. Set includeLayout:true to also return the record-view layout (sections with collapse flags, and the field row arrangement of the active layout mode).',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        includeFields: { type: 'boolean', description: 'Include field definitions (default true)' },
        includeLayout: { type: 'boolean', description: 'Include the record-view layout: { mode, sections (with collapsed flags), rows, hiddenFields }. Default false.' },
        forceRefresh: { type: 'boolean', description: 'Bypass cache and fetch fresh schema' },
      },
      required: ['applicationId'],
    },
    annotations: { readOnlyHint: true },
  },

  // ── Fields ─────────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_fields',
    description: 'List all fields for a SmartSuite application.',
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

  // ── Record reads ───────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_records',
    description: 'List records from a SmartSuite application. Use smartsuite_describe_application first to learn field slugs.',
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
          description: 'Field slugs to include (empty = all fields)',
        },
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
    description: 'Delete records. Requires readwrite or admin mode AND SMARTSUITE_ENABLE_DELETE=true. Supports dry-run. Destructive — cannot be undone.',
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
    description: 'Append markdown content to a SmartDoc field. Requires readwrite or admin mode AND SMARTSUITE_ENABLE_SMARTDOC_WRITE=true. Does not replace existing content.',
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
] as const;
