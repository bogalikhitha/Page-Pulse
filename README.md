# Page Pulse

A production-grade URL audit service. POST a URL, get back a status/timing/SEO
audit. Built for Digital Heroes SDE Task A.

**Built for Digital Heroes Training Task** — https://digitalheroesco.com

## Why it's structured this way

The brief said "built to run in production, not to demo." Concretely, that meant:

| Concern | What's here |
|---|---|
| Input validation | Rejects malformed URLs, non-http(s) schemes, and private/internal network targets (SSRF guard) before ever making a request |
| Timeouts | `AbortController` with a configurable timeout (`FETCH_TIMEOUT_MS`, default 8s) — a hanging target can't hang a worker |
| Concurrency limits | A counting semaphore caps simultaneous outbound fetches (`MAX_CONCURRENT_AUDITS`, default 10), independent of how many HTTP requests arrive |
| Response size caps | Bodies over `MAX_RESPONSE_BODY_BYTES` (default 2MB) are rejected rather than buffered without limit |
| Structured errors | Every error response is `{ error: { code, message, requestId } }` — never an HTML stack trace or an unstructured string |
| Caching | Repeat audits of the same URL within `AUDIT_CACHE_TTL_MS` (default 5 min) are served from an in-memory TTL cache, no refetch |
| Rate limiting | Per-client (via `x-api-key`, falling back to IP), configurable window/max |
| Structured logging | Every log line is one JSON object; every request gets a UUID that appears in logs and in the `X-Request-Id` response header |
| Tests | 13 tests covering validation, success, caching, timeouts, upstream failures, oversized responses, and per-client rate limiting |
| CI | GitHub Actions runs the suite on Node 18 and 20 on every push |

## Running it

```bash
npm install
npm start          # listens on PORT (default 3000)
npm test           # runs the full suite
npm run dev         # auto-restart on file change
```

## API contract

### `POST /v1/audit`

**Request**

```json
{ "url": "https://example.com" }
```

**Response — 200**

```json
{
  "data": {
    "url": "https://example.com/",
    "finalUrl": "https://example.com/",
    "statusCode": 200,
    "ok": true,
    "responseTimeMs": 143,
    "contentType": "text/html; charset=utf-8",
    "contentLengthBytes": 1256,
    "seo": {
      "title": "Example Domain",
      "metaDescription": "...",
      "h1Count": 1,
      "images": { "total": 4, "missingAlt": 1 },
      "links": { "total": 12 }
    },
    "auditedAt": "2026-07-25T02:00:00.000Z",
    "cached": false
  },
  "requestId": "d1a7a820-0b12-4a74-9729-f07a014c4ef2"
}
```

Note: `statusCode` and `ok` reflect the **target's** response. A `200` from
Page Pulse with `statusCode: 500` inside `data` means the audit itself
succeeded — it's correctly telling you the target is broken.

**Error responses** — always this shape, with an appropriate HTTP status:

```json
{ "error": { "code": "INVALID_URL", "message": "...", "requestId": "..." } }
```

| Code | HTTP | When |
|---|---|---|
| `INVALID_URL` | 400 | Missing, malformed, or non-http(s) URL |
| `URL_NOT_ALLOWED` | 400 | URL points to a private/internal address |
| `RATE_LIMITED` | 429 | Client exceeded its request quota |
| `UPSTREAM_TIMEOUT` | 504 | Target didn't respond in time |
| `UPSTREAM_UNREACHABLE` | 502 | DNS failure, connection refused, etc. |
| `RESPONSE_TOO_LARGE` | 502 | Target's response exceeded the size cap |
| `NOT_FOUND` | 404 | Unknown route |
| `INTERNAL_ERROR` | 500 | Unexpected bug — logged server-side with a stack trace |

### `GET /v1/health`

Returns `{ "status": "ok", "requestId": "..." }`. Use for uptime checks.

## Configuration (env vars)

All of these have defaults — see `src/config.js` for the full list and
current values: `PORT`, `FETCH_TIMEOUT_MS`, `MAX_CONCURRENT_AUDITS`,
`AUDIT_CACHE_TTL_MS`, `CACHE_MAX_ENTRIES`, `RATE_LIMIT_WINDOW_MS`,
`RATE_LIMIT_MAX`, `MAX_RESPONSE_BODY_BYTES`.

## Known limitations (deliberate, not oversights)

- **Cache and rate limiter are in-memory**, so they're correct for a single
  instance only. Running more than one instance means each instance has its
  own cache and its own rate-limit counters — a client could get 2x the
  intended quota by hitting different instances. This is fine for a demo
  service; see Task B's writeup for what changes at real scale (short
  version: Redis for both).
- **Response size is checked after full download**, not mid-stream, because
  that keeps the fetch layer trivially testable with a plain fake `Response`
  object instead of a real streaming body. It still protects memory — it
  just isn't the earliest possible bail-out. A streaming version is a
  contained change to `fetchWithLimits()` if that trade-off ever matters.
