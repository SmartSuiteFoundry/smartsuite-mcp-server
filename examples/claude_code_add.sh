#!/usr/bin/env bash
# Add SmartSuite MCP server to Claude Code
claude mcp add smartsuite \
  --env SMARTSUITE_ACCOUNT_ID=your-account-id \
  --env SMARTSUITE_API_KEY=your-api-key \
  --env SMARTSUITE_BASE_URL=https://app.smartsuite.com/api/v1 \
  --env SMARTSUITE_MCP_MODE=readwrite \
  -- smartsuite-mcp
