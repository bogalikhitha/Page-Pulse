const crypto = require('crypto');
const logger = require('../utils/logger');

// Every request gets an ID. It goes on the request object, in the response
// header, and in every log line for that request — so a client reporting
// "it broke" can hand you one string and you can grep straight to it.
function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.requestId = incoming || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);

  const start = Date.now();
  res.on('finish', () => {
    logger.info('request completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      clientId: req.clientId,
    });
  });

  next();
}

module.exports = requestId;
