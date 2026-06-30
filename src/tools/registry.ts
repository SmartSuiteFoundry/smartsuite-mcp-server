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
    description: 'Create a field of any type in an application. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. You supply fieldType + label and an OPTIONAL sparse params object; SmartSuite fills type defaults, so most fields need no params. Provide params only where they matter, e.g.: singleselectfield/multipleselectfield/statusfield → {choices:[{label,value}]}; linkedrecordfield → {linked_application:"<app id>", entries_allowed:"single"|"multiple"} (the backlink field is created automatically); numberfield → {precision, separator}; currencyfield → {currency:"USD"}; textfield → {max_length}. (For formula fields use smartsuite_create_formula_field.) The slug is generated and the field is placed in the record-view layout. Dry-run preview unless confirm:true. Use smartsuite_describe_application on a table that already has the desired field type to copy its params shape.',
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
    description: 'Update a field\'s label and/or params (any type). Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. params is a PATCH — only the keys you pass are changed (shallow-merged onto the existing params); everything else (choices, nested, links) is preserved. Read the field first with smartsuite_describe_field to see current params. Applies asynchronously. Dry-run preview unless confirm:true. (For help text use smartsuite_set_field_help_text; for formula expressions use smartsuite_update_formula_field.)',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        slug: { type: 'string', description: 'The field slug to update.' },
        label: { type: 'string', description: 'New label (optional).' },
        params: { type: 'object', description: 'Optional params patch (shallow-merged onto existing params).' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'slug'],
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
    description: 'Resolve the full schema of one automation step — its trigger (default) or a chosen action — by calling the automation engine\'s dynamic description. For a trigger: returns label, inputs (with dropdown options), context outputs, the fields the trigger exposes to downstream actions, and the fields usable in conditions. For an action: returns label, integration, and inputs (with options). Use smartsuite_describe_automation first to see the action list; select an action with actionIndex or actionInstanceId.',
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
    description: 'Update an existing automation. Requires readwrite/admin mode AND SMARTSUITE_ENABLE_SCHEMA_WRITE=true. Fetches the current automation and applies only the fields you provide — label, trigger, actionGroups/actions, automaticDescription, timezone — preserving the rest (including first_created). Pass credentialId to fill missing credentials. Note: this replaces the trigger / action groups you supply wholesale (no per-action merge), so pass the complete new trigger or action list.',
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
    description: 'Move/arrange an existing field within the record-view layout — reorder it, or place it under a section. Requires readwrite/admin + SMARTSUITE_ENABLE_SCHEMA_WRITE. Pass afterField = the field slug OR a section__ slug to position this field right after it (a field placed right after a section marker becomes the first field under that section); omit afterField to move to the end. In two-column layouts the moved field is re-inserted as its own full-width row. When tabs are enabled, tabId is required (a tab id, "all", or "top"). Dry-run preview unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application (table) ID.' },
        slug: { type: 'string', description: 'The field slug to move.' },
        afterField: { type: 'string', description: 'Field slug or section__ slug to place this field after (default: end).' },
        tabId: { type: 'string', description: 'When tabs are enabled (required then): a tab id, "all", or "top". Omit when tabs are disabled.' },
        confirm: { type: 'boolean', description: 'Must be true to apply (default false = preview).' },
      },
      required: ['applicationId', 'slug'],
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
