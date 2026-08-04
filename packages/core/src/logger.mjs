const priorities = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info', base = {}) {
  const threshold = priorities[level] ?? priorities.info;
  const write = (severity, message, fields = {}) => {
    if ((priorities[severity] ?? 100) < threshold) return;
    const record = {
      time: new Date().toISOString(),
      severity,
      message,
      ...base,
      ...fields
    };
    const stream = severity === 'error' ? process.stderr : process.stdout;
    stream.write(`${JSON.stringify(record)}\n`);
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger(level, { ...base, ...fields })
  };
}
