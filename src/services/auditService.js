const cheerio = require('cheerio');
const config = require('../config');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { AuditCache } = require('./cache');
const { ConcurrencyLimiter } = require('./concurrencyLimiter');

const cache = new AuditCache();
const limiter = new ConcurrencyLimiter(config.maxConcurrentAudits);

// The fetch implementation is injected rather than hardcoded to the global.
// Two reasons, both "production-grade" concerns rather than nice-to-haves:
//   1. Testability - unit tests swap in a deterministic fake instead of
//      depending on real network behavior or a mocking library that has to
//      match whatever HTTP client the runtime happens to use internally.
//   2. Flexibility - swapping in a proxy-aware or instrumented client later
//      is a one-line change at the composition root, not a refactor.
let fetchImpl = (...args) => globalThis.fetch(...args);
function __setFetchImpl(fn) {
  fetchImpl = fn;
}
function __resetFetchImpl() {
  fetchImpl = (...args) => globalThis.fetch(...args);
}

// Fetch with a hard timeout AND a hard body-size cap, so one huge or
// hanging response can't tie up a worker slot or blow up memory.
async function fetchWithLimits(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);

  let response;
  try {
    response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'PagePulse-Audit/1.0 (+https://digitalheroesco.com)' },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AppError('UPSTREAM_TIMEOUT', `Target did not respond within ${config.fetchTimeoutMs}ms.`, 504);
    }
    throw new AppError('UPSTREAM_UNREACHABLE', `Could not reach target: ${err.message}`, 502);
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.text();
  if (Buffer.byteLength(body, 'utf-8') > config.maxResponseBodyBytes) {
    throw new AppError('RESPONSE_TOO_LARGE', `Response exceeded ${config.maxResponseBodyBytes} byte limit.`, 502);
  }

  return { response, body };
}

function parseAudit(html, finalUrl) {
  const $ = cheerio.load(html);

  const title = $('title').first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || null;
  const h1Count = $('h1').length;
  const images = $('img');
  const imagesTotal = images.length;
  let imagesMissingAlt = 0;
  images.each((_, el) => {
    const alt = $(el).attr('alt');
    if (!alt || alt.trim() === '') imagesMissingAlt += 1;
  });
  const links = $('a[href]');
  const linksTotal = links.length;

  return {
    title,
    metaDescription,
    h1Count,
    images: { total: imagesTotal, missingAlt: imagesMissingAlt },
    links: { total: linksTotal },
    finalUrl,
  };
}

async function auditUrl(url, requestId) {
  const cached = cache.get(url);
  if (cached) {
    logger.info('audit served from cache', { requestId, url });
    return { ...cached, cached: true };
  }

  const result = await limiter.run(async () => {
    const startedAt = Date.now();
    const { response, body } = await fetchWithLimits(url);
    const responseTimeMs = Date.now() - startedAt;

    const parsed = parseAudit(body, response.url || url);

    return {
      url,
      finalUrl: parsed.finalUrl,
      statusCode: response.status,
      ok: response.ok,
      responseTimeMs,
      contentType: response.headers.get('content-type') || null,
      contentLengthBytes: Buffer.byteLength(body, 'utf-8'),
      seo: {
        title: parsed.title,
        metaDescription: parsed.metaDescription,
        h1Count: parsed.h1Count,
        images: parsed.images,
        links: parsed.links,
      },
      auditedAt: new Date().toISOString(),
    };
  });

  cache.set(url, result);
  logger.info('audit completed', { requestId, url, statusCode: result.statusCode, responseTimeMs: result.responseTimeMs });

  return { ...result, cached: false };
}

module.exports = { auditUrl, cache, limiter, __setFetchImpl, __resetFetchImpl };
