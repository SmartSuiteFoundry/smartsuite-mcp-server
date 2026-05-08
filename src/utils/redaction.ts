const REDACTED = '[REDACTED]';

export function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length > 4) {
      result = result.replaceAll(secret, REDACTED);
    }
  }
  return result;
}

export function redactObject(obj: unknown, secrets: string[]): unknown {
  if (!obj) return obj;
  return JSON.parse(redactSecrets(JSON.stringify(obj), secrets));
}
