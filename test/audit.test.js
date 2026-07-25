process.env.FETCH_TIMEOUT_MS = '300'; // fast timeout for the timeout test below

const request = require('supertest');
const { createApp } = require('../src/app');
const { cache, __setFetchImpl, __resetFetchImpl } = require('../src/services/auditService');

const app = createApp();

const SAMPLE_HTML = `
  <html>
    <head>
      <title>Example Domain</title>
      <meta name="description" content="A sample page for testing." />
    </head>
    <body>
      <h1>Welcome</h1>
      <img src="/a.png" alt="a logo" />
      <img src="/b.png" />
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </body>
  </html>
`;

// Builds a minimal object matching the subset of the Fetch API Response
// shape that auditService actually uses (status, ok, url, headers.get, text()).
function fakeResponse({ status = 200, body = '', url, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers: { get: (key) => headers[key.toLowerCase()] || null },
    text: async () => body,
  };
}

beforeEach(() => {
  cache.clear();
});

afterEach(() => {
  __resetFetchImpl();
});

describe('input validation', () => {
  test('rejects missing url', async () => {
    const res = await request(app).post('/v1/audit').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  test('rejects malformed url', async () => {
    const res = await request(app).post('/v1/audit').send({ url: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  test('rejects non-http(s) protocols', async () => {
    const res = await request(app).post('/v1/audit').send({ url: 'ftp://example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  test('blocks private/internal network targets (SSRF guard)', async () => {
    const res = await request(app).post('/v1/audit').send({ url: 'http://127.0.0.1:6379' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('URL_NOT_ALLOWED');
  });
});

describe('successful audit', () => {
  test('returns parsed SEO signals for a reachable page', async () => {
    __setFetchImpl(async (url) =>
      fakeResponse({ status: 200, body: SAMPLE_HTML, url, headers: { 'content-type': 'text/html' } })
    );

    const res = await request(app).post('/v1/audit').send({ url: 'https://example.com/' });

    expect(res.status).toBe(200);
    expect(res.body.data.statusCode).toBe(200);
    expect(res.body.data.seo.title).toBe('Example Domain');
    expect(res.body.data.seo.h1Count).toBe(1);
    expect(res.body.data.seo.images.total).toBe(2);
    expect(res.body.data.seo.images.missingAlt).toBe(1);
    expect(res.body.data.seo.links.total).toBe(2);
    expect(res.body.data.cached).toBe(false);
    expect(res.body.requestId).toBeDefined();
  });

  test('serves repeat audits from cache within the TTL window without refetching', async () => {
    let callCount = 0;
    __setFetchImpl(async (url) => {
      callCount += 1;
      return fakeResponse({ status: 200, body: SAMPLE_HTML, url });
    });

    const first = await request(app).post('/v1/audit').send({ url: 'https://example.com/' });
    expect(first.body.data.cached).toBe(false);

    const second = await request(app).post('/v1/audit').send({ url: 'https://example.com/' });
    expect(second.body.data.cached).toBe(true);

    expect(callCount).toBe(1); // proves the second call never hit the network
  });
});

describe('upstream failure handling', () => {
  test('returns a structured 504 when the target times out', async () => {
    // Simulate a hanging target: the fake fetch never resolves on its own,
    // it only rejects once our AbortController fires.
    __setFetchImpl(
      (url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })
    );

    const res = await request(app).post('/v1/audit').send({ url: 'https://slow.example.com/' });

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('UPSTREAM_TIMEOUT');
  }, 10000);

  test('returns a structured 502 when the target is unreachable', async () => {
    __setFetchImpl(async () => {
      throw new Error('getaddrinfo ENOTFOUND down.example.com');
    });

    const res = await request(app).post('/v1/audit').send({ url: 'https://down.example.com/' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPSTREAM_UNREACHABLE');
    expect(res.body.error.requestId).toBeDefined();
  });

  test('passes through the target status when the target itself errors', async () => {
    __setFetchImpl(async (url) => fakeResponse({ status: 500, body: '<html>oops</html>', url }));

    const res = await request(app).post('/v1/audit').send({ url: 'https://example.com/broken' });

    expect(res.status).toBe(200); // our API call succeeded even though the target 500'd
    expect(res.body.data.statusCode).toBe(500);
    expect(res.body.data.ok).toBe(false);
  });

  test('rejects responses larger than the configured cap', async () => {
    const hugeBody = 'x'.repeat(3 * 1024 * 1024); // 3MB > default 2MB cap
    __setFetchImpl(async (url) => fakeResponse({ status: 200, body: hugeBody, url }));

    const res = await request(app).post('/v1/audit').send({ url: 'https://example.com/huge' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('RESPONSE_TOO_LARGE');
  });
});

describe('rate limiting', () => {
  test('returns 429 once a client exceeds the configured limit', async () => {
    __setFetchImpl(async (url) => fakeResponse({ status: 200, body: SAMPLE_HTML, url }));

    let lastRes;
    for (let i = 0; i < 31; i += 1) {
      lastRes = await request(app)
        .post('/v1/audit')
        .set('x-api-key', 'test-client-1')
        .send({ url: `https://example.com/?i=${i}` }); // vary URL to bypass cache
    }

    expect(lastRes.status).toBe(429);
    expect(lastRes.body.error.code).toBe('RATE_LIMITED');
  });

  test('rate limits are tracked independently per client', async () => {
    __setFetchImpl(async (url) => fakeResponse({ status: 200, body: SAMPLE_HTML, url }));

    for (let i = 0; i < 30; i += 1) {
      await request(app)
        .post('/v1/audit')
        .set('x-api-key', 'client-a')
        .send({ url: `https://example.com/?a=${i}` });
    }
    // client-a is now at the limit; client-b should be unaffected
    const res = await request(app)
      .post('/v1/audit')
      .set('x-api-key', 'client-b')
      .send({ url: 'https://example.com/fresh' });

    expect(res.status).toBe(200);
  });
});

describe('health check', () => {
  test('GET /v1/health returns ok', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
