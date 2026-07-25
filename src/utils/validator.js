const { AppError } = require('../middleware/errorHandler');

// Deliberately strict. This service fetches whatever URL it's handed, so
// loose validation here is a straight line to an SSRF hole (imagine
// "http://169.254.169.254/latest/meta-data" or "http://localhost:6379").
const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const PRIVATE_IP_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local / cloud metadata
];

function validateAuditUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new AppError('INVALID_URL', 'Field "url" is required and must be a non-empty string.', 400);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError('INVALID_URL', `"${rawUrl}" is not a valid URL.`, 400);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new AppError('INVALID_URL', 'Only http and https URLs are allowed.', 400);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || PRIVATE_IP_PATTERNS.some((re) => re.test(hostname))) {
    throw new AppError('URL_NOT_ALLOWED', 'URLs pointing to local or private network addresses are not allowed.', 400);
  }

  return parsed.toString();
}

module.exports = { validateAuditUrl };
