const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const requestId = require('./middleware/requestId');
const rateLimiter = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const auditRoutes = require('./routes/audit');

// Split from server.js on purpose: app.js exports a configured Express app
// with no open sockets, so tests can require it directly with supertest
// without binding a real port.
function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '10kb' })); // requests to US are tiny; cap it
  app.use(requestId);
  app.use('/v1', rateLimiter);

  app.use('/v1', auditRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
