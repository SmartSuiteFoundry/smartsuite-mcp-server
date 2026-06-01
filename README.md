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
| `SMARTSUITE_ENABLE_SCHEMA_WRITE` | `false` | Enable schema write tools |
| `SMARTSUITE_ENABLE_SMARTDOC_WRITE` | `false` | Enable SmartDoc append tools |
| `SMARTSUITE_ALLOWED_SOLUTIONS` | _(all)_ | Comma-separated solution IDs to allow |
| `SMARTSUITE_ALLOWED_APPLICATIONS` | _(all)_ | Comma-separated application IDs to allow |
| `SMARTSUITE_DENIED_APPLICATIONS` | _(none)_ | Comma-separated application IDs to block |
| `SMARTSUITE_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `SMARTSUITE_LOG_FILE` | stderr | Path to write logs (default: stderr) |
| `SMARTSUITE_REQUEST_TIMEOUT_MS` | `30000` | HTTP request timeout in milliseconds |
| `SMARTSUITE_RETRY_COUNT` | `2` | Number of retries for rate limits and transient errors |
| `SCHEMA_CACHE_TTL_MS` | `300000` | Application schema cache TTL (5 min) |
| `SMARTSUITE_AI_ENRICHED_RECORDS` | `false` | Return field context (label, type, help text, linked field) with every record response |

---

## Tool list

### Discovery & Schema

| Tool | Description |
|------|-------------|
| `smartsuite_diagnostics` | Validate configuration and connectivity |
| `smartsuite_list_solutions` | List accessible SmartSuite solutions |
| `smartsuite_get_solution` | Get solution details |
| `smartsuite_list_applications` | List applications; pass `solutionId` to filter to one solution |
| `smartsuite_describe_application` | Full application schema with field slugs and options |
| `smartsuite_list_fields` | List fields for an application |
| `smartsuite_describe_field` | Detailed field metadata including choice options |

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

### Views

| Tool | Description |
|------|-------------|
| `smartsuite_list_views` | List views for an application |
| `smartsuite_describe_view` | View metadata: fields, filters, sorts |

### SmartDocs

| Tool | Mode | Description |
|------|------|-------------|
| `smartsuite_get_smartdoc_content` | readonly | Read a SmartDoc field as plain text and raw value |
| `smartsuite_append_smartdoc_content` | readwrite + enable_smartdoc_write | Append markdown to a SmartDoc field |

### Files

| Tool | Mode | Description |
|------|------|-------------|
| `smartsuite_get_file_url` | readonly | Resolve a file field handle to a signed CDN download URL |
| `smartsuite_upload_file` | readwrite | Upload a local file to a SmartSuite file field |

---

## Security model

1. **Credentials never reach the LLM.** API key and account ID are loaded from environment variables and never included in tool responses or logs.
2. **Secrets are redacted from all log output.**
3. **Access mode is enforced server-side.** Write tools return a clear error in `readonly` mode.
4. **Destructive operations require explicit opt-in** (`SMARTSUITE_ENABLE_DELETE=true`) and a confirmation argument.
5. **Batch writes require dry-run acknowledgement** or `confirm=true`.
6. **Application allowlists and denylists** prevent access to sensitive tables.
7. **All write operations write a local audit log** (tool, account, application, record, timestamp, success/failure). Field values are not logged by default.

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
  tools/
    registry.ts         Tool definitions (names, schemas, annotations)
    context.ts          Shared tool context type
    diagnostics.ts
    solutions.ts
    applications.ts
    fields.ts
    records.read.ts
    records.write.ts
    files.ts
    comments.ts
    views.ts
    smartdocs.ts
  types/
    config.ts           Config interface
    smartsuite.ts       SmartSuite API types
  utils/
    audit.ts            Audit log writer
    pagination.ts       Cursor encode/decode
    redaction.ts        Secret redaction
    retry.ts            Exponential backoff retry
    safeJson.ts         Safe JSON stringify
```

---

## License

MIT
