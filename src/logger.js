import { createConsoleLogger, noopLogger } from 'merchantid';

/**
 * Logger untuk gateway.
 *
 * `merchantid` memanggil `logger.info(...)`, jadi logger yang hanya punya
 * `log`/`warn`/`error` akan membuat gateway crash saat membuat pembayaran.
 * Fungsi ini menormalkan bentuk logger apa pun menjadi interface lengkap.
 */
export function normalizeLogger(logger) {
  if (!logger) return createConsoleLogger();

  const level = (method) => {
    if (typeof logger[method] === 'function') {
      return logger[method].bind(logger);
    }
    if (method === 'log' && typeof logger.log === 'function') {
      return logger.log.bind(logger);
    }
    return () => {};
  };

  return {
    debug: level('debug'),
    info: level('info'),
    warn: level('warn'),
    error: level('error'),
  };
}

export { noopLogger };