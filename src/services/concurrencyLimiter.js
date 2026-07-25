// A plain counting semaphore. No dependency needed — this is ~20 lines
// and it's the kind of thing worth understanding rather than importing.
// Caps how many outbound audit fetches run at once, across ALL clients.
class ConcurrencyLimiter {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.queue = [];
  }

  async run(task) {
    if (this.active >= this.maxConcurrent) {
      await new Promise((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  stats() {
    return { active: this.active, queued: this.queue.length };
  }
}

module.exports = { ConcurrencyLimiter };
