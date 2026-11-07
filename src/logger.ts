/**
 * Minimal structured logger — no dependency added since the need here is
 * just "level + timestamp + scope + message as one greppable JSON line",
 * not log rotation, transports, or anything a full library like pino
 * would add. Replaces the `console.log`/`console.warn`/`console.error`
 * calls that used to carry a hand-written `[module]` prefix; `scope` is
 * that same module name, now a structured field instead of free text.
 *
 * Output is one JSON object per line on stdout (info/warn) or stderr
 * (error), which is what most log aggregators (and a plain `grep`) want.
 */
type Level = "info" | "warn" | "error";

export interface LogMeta {
  [key: string]: unknown;
}

function emit(level: Level, scope: string, message: string, meta?: LogMeta): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    scope,
    message,
    ...(meta !== undefined ? { meta } : {}),
  });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (scope: string, message: string, meta?: LogMeta) => emit("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: LogMeta) => emit("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: LogMeta) => emit("error", scope, message, meta),
};

/**
 * `JSON.stringify` on a bare `Error` produces `{}` — `message`/`stack` are
 * non-enumerable. Call this when putting a caught error into log meta so
 * it actually shows up in the output.
 */
export function serializeError(err: unknown): LogMeta {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { value: err };
}
