const rateLimit = require('express-rate-limit');
const config = require('../config');

// Rate limiting is per CLIENT, not per process. A client is identified by
// an API key header if present (the real-world case — every legitimate
// caller should be issued one), falling back to IP for anonymous/dev use.
// This is what stops one noisy caller from starving everyone else.
function clientKey(req) {
  return req.headers['x-api-key'] || req.ip;
}

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true, // adds RateLimit-* headers
  legacyHeaders: false,
  keyGenerator: clientKey,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Limit is ${config.rateLimit.max} per ${config.rateLimit.windowMs / 1000}s.`,
        requestId: req.requestId,
      },
    });
  },
});

module.exports = limiter;
