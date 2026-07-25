const config = require('../config');

// Simple in-memory TTL cache, keyed by URL. This is intentionally NOT
// Redis — for a single-instance service this is the right amount of
// complexity. The moment you run more than one instance, this cache stops
// being globally correct (see Task B: at scale it moves to Redis).
class AuditCache {
  constructor({ ttlMs = config.cacheTtlMs, maxEntries = config.cacheMaxEntries } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map(); // key -> { value, expiresAt }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      // Evict the oldest entry (Maps preserve insertion order).
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  size() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { AuditCache };
