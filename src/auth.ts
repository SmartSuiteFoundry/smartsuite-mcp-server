export function buildAuthHeaders(apiKey: string, accountId: string): Record<string, string> {
  return {
    'Authorization': `Token ${apiKey}`,
    'ACCOUNT-ID': accountId,
    'Content-Type': 'application/json',
  };
}
