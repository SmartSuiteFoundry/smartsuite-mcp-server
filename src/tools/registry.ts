export const TOOL_DEFINITIONS = [
  // ── Diagnostics ────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_diagnostics',
    description: 'Validate SmartSuite MCP server configuration and connectivity. Returns server version, mode, and account info. Does not return the API key.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true, openWorldHint: false },
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
    description: 'List SmartSuite applications (tables). Optionally filter by solution.',
    inputSchema: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'Filter by solution ID' },
        limit: { type: 'number', description: 'Maximum results (default 100)' },
        cursor: { type: 'string', description: 'Pagination cursor' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'smartsuite_describe_application',
    description: 'Describe a SmartSuite application schema, including field slugs, types, and options. Always call this before creating or updating records so you know field slugs and valid values.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string', description: 'The application ID' },
        includeFields: { type: 'boolean', description: 'Include field definitions (default true)' },
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
    description: 'Get detailed metadata for a single field in a SmartSuite application.',
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

  // ── Views ──────────────────────────────────────────────────────────────────
  {
    name: 'smartsuite_list_views',
    description: 'List views for a SmartSuite application.',
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
    name: 'smartsuite_describe_view',
    description: 'Get metadata for a SmartSuite view, including visible fields, filters, and sort.',
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
