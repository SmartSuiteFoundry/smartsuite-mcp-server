import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../src/utils/retry.js';
import { SmartSuiteError } from '../../src/errors.js';

const rateLimited = (retryAfterMs?: number) =>
  new SmartSuiteError('SMARTSUITE_RATE_LIMITED', '429', retryAfterMs != null ? { retryAfterMs } : undefined, 429);

describe('withRetry — Retry-After', () => {
  it('waits the advised interval instead of its own backoff', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const p = withRetry(async () => { if (++calls === 1) throw rateLimited(5000); return 'ok'; }, { maxAttempts: 3, baseDelayMs: 500 });
    await vi.advanceTimersByTimeAsync(600);   // past the 500ms default backoff...
    expect(calls).toBe(1);                     // ...but the server said 5s, so no retry yet
    await vi.advanceTimersByTimeAsync(4600);
    await expect(p).resolves.toBe('ok');
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it('falls back to exponential backoff when the server advises nothing', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const p = withRetry(async () => { if (++calls === 1) throw rateLimited(); return 'ok'; }, { maxAttempts: 3, baseDelayMs: 500 });
    await vi.advanceTimersByTimeAsync(700);
    await expect(p).resolves.toBe('ok');
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it('still gives up after maxAttempts and rethrows', async () => {
    vi.useFakeTimers();
    const p = withRetry(async () => { throw rateLimited(10); }, { maxAttempts: 2, baseDelayMs: 1 });
    const assertion = expect(p).rejects.toThrow('429');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });

  it('does not retry a non-retryable status', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new SmartSuiteError('SMARTSUITE_NOT_FOUND', '404', undefined, 404); },
      { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow('404');
    expect(calls).toBe(1);
  });
});
