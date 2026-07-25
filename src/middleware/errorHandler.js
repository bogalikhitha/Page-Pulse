const logger = require('../utils/logger');

// A typed error we throw deliberately from inside services, carrying an
// HTTP status and a machine-readable code. Anything NOT thrown as one of
// these is treated as unexpected (500) and logged loudly.
class AppError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

// Every error response in this service — validation, timeout, upstream
// failure, or genuine bug — comes out in this exact shape. Clients can
// branch on `error.code` without ever parsing prose.
function errorHandler(err, req, res, _next) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_ERROR';
  const message = isAppError ? err.message : 'An unexpected error occurred.';

  if (!isAppError) {
    logger.error('unhandled error', {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
      requestId: req.requestId,
    },
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.originalUrl}`,
      requestId: req.requestId,
    },
  });
}

module.exports = { AppError, errorHandler, notFoundHandler };
