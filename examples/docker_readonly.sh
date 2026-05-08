#!/usr/bin/env bash
# Run SmartSuite MCP server via Docker in read-only mode
docker run --rm -i \
  -e SMARTSUITE_ACCOUNT_ID=your-account-id \
  -e SMARTSUITE_API_KEY=your-api-key \
  -e SMARTSUITE_BASE_URL=https://app.smartsuite.com/api/v1 \
  -e SMARTSUITE_MCP_MODE=readonly \
  smartsuite/mcp-server:latest
