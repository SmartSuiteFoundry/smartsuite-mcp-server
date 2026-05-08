# Security Policy

## Credential handling

The SmartSuite MCP server requires a SmartSuite Account ID and API key to operate. These are supplied exclusively through environment variables and are never:

- Returned in tool responses
- Written to stdout
- Included in log output (secrets are actively redacted before any log write)
- Stored on disk by the server itself

When installed as a Claude Desktop extension via `.mcpb`, the API key is stored in OS secure storage (macOS Keychain, Windows Credential Manager) by Claude Desktop — not in any plaintext config file.

## Local execution model

The server runs as a subprocess on your local machine. It communicates with your MCP client (Claude Desktop, Claude Code, etc.) exclusively over stdio. No network ports are opened. All SmartSuite API calls originate from your machine using your own credentials.

## Tool permissions and access modes

Three access modes control what the server is allowed to do:

| Mode | Capabilities |
|------|-------------|
| `readonly` | Schema inspection and record reads only |
| `readwrite` | Adds record creation, updates, and comments |
| `admin` | Adds opt-in destructive and schema operations |

Additional capability gates — `SMARTSUITE_ENABLE_DELETE`, `SMARTSUITE_ENABLE_SCHEMA_WRITE`, `SMARTSUITE_ENABLE_SMARTDOC_WRITE` — must be explicitly enabled even in `readwrite` or `admin` mode.

Application-level allowlists (`SMARTSUITE_ALLOWED_APPLICATIONS`) and denylists (`SMARTSUITE_DENIED_APPLICATIONS`) can restrict access to specific tables.

## Destructive action controls

- Delete operations are disabled by default and require `SMARTSUITE_ENABLE_DELETE=true`
- Batch writes require `dryRun=true` to preview, then `confirm=true` to execute
- Delete operations additionally require an exact confirmation string (`"DELETE N RECORDS"`)
- SmartDoc append requires `confirm=true`

## Audit logging

All write operations (create, update, batch update, delete, comment, SmartDoc append) emit a structured audit log entry to stderr or a configured log file. Log entries include the tool name, account ID, application ID, record ID(s), mode, field slugs modified, and success/failure status. Field *values* are not logged by default (`SMARTSUITE_AUDIT_INCLUDE_VALUES=false`).

## Known risks with local MCP servers

- **Any MCP client connected to this server can invoke all enabled tools.** Use `readonly` mode if you only need inspection access.
- **Prompt injection:** A malicious record value could attempt to instruct the AI to call write tools. Operate in `readonly` mode for untrusted data sources.
- **Log files:** If `SMARTSUITE_LOG_FILE` is set, ensure the file path is not accessible to other users on the system.
- **API key scope:** SmartSuite API keys inherit the permissions of the user who generated them. Use a service account with minimal required permissions.

## Reporting vulnerabilities

To report a security vulnerability, email **security@smartsuite.com**. Please do not open a public GitHub issue for security reports.
