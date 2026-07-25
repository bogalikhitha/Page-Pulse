// Central place for every tunable knob. Nothing production-relevant should
// be a magic number buried in a route file — it should be here, with a
// sane default, overridable by env var.

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,

  // How long we wait for the target site to respond before we give up.
  fetchTimeoutMs: parseInt(process.env.FETCH_TIMEOUT_MS, 10) || 8000,

  // How many outbound audit fetches we allow in flight at once, globally.
  // Protects OUR process (sockets, memory) and is polite to targets.
  maxConcurrentAudits: parseInt(process.env.MAX_CONCURRENT_AUDITS, 10) || 10,

  // Repeat audits of the same URL within this window are served from cache.
  cacheTtlMs: parseInt(process.env.AUDIT_CACHE_TTL_MS, 10) || 5 * 60 * 1000, // 5 min

  // Max cached entries before we evict the oldest (simple LRU-ish cap).
  cacheMaxEntries: parseInt(process.env.CACHE_MAX_ENTRIES, 10) || 500,

  // Rate limiting: requests per window, per client.
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000, // 1 min
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 30,
  },

  maxResponseBodyBytes: parseInt(process.env.MAX_RESPONSE_BODY_BYTES, 10) || 2 * 1024 * 1024, // 2MB
};
