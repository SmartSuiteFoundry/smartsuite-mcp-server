interface OffsetCursor {
  type: 'offset';
  offset: number;
}

export function encodeCursor(offset: number): string {
  const payload: OffsetCursor = { type: 'offset', offset };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function decodeCursor(cursor: string): number {
  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as OffsetCursor;
    if (payload.type === 'offset' && typeof payload.offset === 'number') {
      return payload.offset;
    }
  } catch {
    // ignore invalid cursors
  }
  return 0;
}
