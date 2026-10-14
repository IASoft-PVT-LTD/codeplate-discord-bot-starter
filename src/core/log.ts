// Structured logging: one JSON object per line (easy to search in journald,
// Docker or a log service), or readable lines with LOG_FORMAT=pretty.
//   log.info('poll created', { guildId, pollId })
//   const l = log.child({ command: 'poll' }); l.warn('...')
// Never log tokens, keys or whole message contents.

export type Level = 'debug' | 'info' | 'warn' | 'error';
export type Fields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogLine extends Fields {
  time: string;
  level: Level;
  msg: string;
}

export type Sink = (line: LogLine) => void;

// Errors become { name, message, stack } so they survive JSON.stringify.
function serialize(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack, ...('code' in v ? { code: v.code } : {}) } : v;
  }
  return out;
}

export function jsonSink(write: (s: string) => void = (s) => process.stdout.write(s)): Sink {
  return (line) => write(`${JSON.stringify(line)}\n`);
}

export function prettySink(write: (s: string) => void = (s) => process.stdout.write(s)): Sink {
  return ({ time, level, msg, ...rest }) => {
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    write(`${time.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg}${extra}\n`);
  };
}

export function createLogger(opts: { level?: Level; sink?: Sink; now?: () => number; fields?: Fields } = {}): Logger {
  const min = ORDER[opts.level ?? 'info'];
  const sink = opts.sink ?? jsonSink();
  const now = opts.now ?? Date.now;
  const base = opts.fields ?? {};
  const emit = (level: Level, msg: string, fields: Fields = {}) => {
    if (ORDER[level] < min) return;
    sink({ time: new Date(now()).toISOString(), level, msg, ...serialize({ ...base, ...fields }) });
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger({ ...opts, fields: { ...base, ...fields } }),
  };
}

// For tests: keeps every line in memory.
export function memoryLogger(level: Level = 'debug'): Logger & { lines: LogLine[] } {
  const lines: LogLine[] = [];
  return Object.assign(createLogger({ level, sink: (l) => lines.push(l) }), { lines });
}
