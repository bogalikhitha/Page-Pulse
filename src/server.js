const { createApp } = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('Page Pulse listening', { port: config.port });
});

// Don't let the process hang forever on shutdown — cap graceful drain time.
function shutdown(signal) {
  logger.info('shutdown initiated', { signal });
  server.close(() => {
    logger.info('shutdown complete');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
