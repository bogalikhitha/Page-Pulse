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
  app.get('/', (req, res) => {
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Page Pulse</title></head>
        <body style="font-family: sans-serif; max-width: 600px; margin: 60px auto; line-height: 1.6;">
          <h1>Page Pulse</h1>
          <p>A production-grade URL audit service.</p>
          <p>API: <code>POST /v1/audit</code> with <code>{ "url": "https://example.com" }</code></p>
          <p>Health check: <a href="/v1/health">/v1/health</a></p>
          <hr>
          <footer>
            <p>Built for <a href="https://digitalheroesco.com">Digital Heroes Training Task</a></p>
          </footer>
        </body>
      </html>
    `);
  });

  app.use('/v1', auditRoutes);

  app.use('/v1', auditRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
