// The Studio's log: lines for a terminal (LOG_FORMAT=text, the default), or one JSON object a line for a log collector
// (LOG_FORMAT=json), as a container's output is read. A logger answers info, warn, error and log, so it stands where
// the console stood; a string alone is a message, an event name with fields is a record. Request records carry a
// route pattern, never a try's id, a preview token or a ballot: those travel in URLs, and a log must not keep them.

const LEVELS = Object.freeze({ info: 'info', log: 'info', warn: 'warn', error: 'error' });

/**
 * A URL path as a log keeps it: hexadecimal ids, UUIDs and any other long segment become placeholders, and the
 * segments after a file route (a try's report files, a gallery entry's files) are folded to one.
 */
export function routePattern(pathname) {
  const parts = String(pathname || '/').split('?')[0].split('/').filter(Boolean).map(part => {
    if (/^[a-f0-9]{32,}$/u.test(part) || /^[a-f0-9-]{36}$/u.test(part)) return ':id';
    if (part.length > 24) return ':long';
    return part;
  });
  const file = parts.findIndex((part, index) => ['files', 'report', 'out', 'before', 'progress'].includes(part) && index > 0);
  const kept = file >= 0 ? [...parts.slice(0, file + 1), '*'] : parts;
  return `/${kept.join('/')}`;
}

/**
 * A logger. `format` is text or json; `redact` is applied to every string field; `stdout` and `stderr` are writable
 * streams (the process's by default), `now` gives the time.
 */
export function createLogger({ format = 'text', redact = value => value, stdout = process.stdout, stderr = process.stderr, now = () => new Date() } = {}) {
  const clean = value => {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
    return value;
  };
  function write(level, event, fields) {
    const record = typeof event === 'string' && fields === undefined ? { message: event } : { event: String(event), ...(fields && typeof fields === 'object' ? fields : { message: String(fields) }) };
    const entry = clean(record);
    if (format === 'json') {
      stdout.write(`${JSON.stringify({ time: now().toISOString(), level, ...entry })}\n`);
      return;
    }
    const { message, event: name, ...rest } = entry;
    const text = [name, message, Object.keys(rest).length ? JSON.stringify(rest) : ''].filter(Boolean).join(' ');
    (level === 'info' ? stdout : stderr).write(`${level === 'info' ? '' : `${level}: `}${text}\n`);
  }
  const logger = {};
  for (const [method, level] of Object.entries(LEVELS)) logger[method] = (event, fields) => write(level, event, fields);
  logger.format = format;
  return logger;
}
