import fs from 'node:fs';
import { Config, LogLevel } from './types/config.js';
import { redactSecrets } from './utils/redaction.js';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(config: Pick<Config, 'logLevel' | 'logFile' | 'apiKey' | 'accountId'>): Logger {
  const minLevel = LEVELS[config.logLevel];
  const secrets = [config.apiKey];
  let fileStream: fs.WriteStream | null = null;
  if (config.logFile) {
    fileStream = fs.createWriteStream(config.logFile, { flags: 'a' });
  }

  function write(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVELS[level] < minLevel) return;
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: redactSecrets(msg, secrets),
      ...(data ? { data: JSON.parse(redactSecrets(JSON.stringify(data), secrets)) } : {}),
    });
    if (fileStream) {
      fileStream.write(entry + '\n');
    } else {
      process.stderr.write(entry + '\n');
    }
  }

  return {
    debug: (msg, data) => write('debug', msg, data),
    info:  (msg, data) => write('info',  msg, data),
    warn:  (msg, data) => write('warn',  msg, data),
    error: (msg, data) => write('error', msg, data),
  };
}
