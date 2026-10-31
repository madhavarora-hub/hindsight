// A dependency-free stand-in for Walrus Memory, used by the keyless demo (in
// the browser and in Node). Same interface as WalrusStore, but nothing leaves
// the machine, and every result says so.

export class LocalStore {
  constructor({ initial = [], onChange = () => {} } = {}) {
    this.name = "local (not on Walrus)";
    this.mainnet = false;
    this.items = initial.map((m) => (typeof m === "string" ? { text: m } : m));
    this.onChange = onChange;
  }

  async health() {
    return { status: "ok", mode: "local" };
  }

  async remember(text) {
    const item = { text, blobId: `local-${this.items.length + 1}`, createdAt: new Date().toISOString() };
    this.items.push(item);
    this.onChange(this.items);
    return { blobId: item.blobId, id: item.blobId };
  }

  // Token-overlap ranking: enough for the demo, and deterministic.
  async recall(query, limit = 10) {
    const q = new Set(tokens(query));
    return this.items
      .map((m) => {
        const hits = tokens(m.text).filter((w) => q.has(w)).length;
        return { ...m, distance: 1 - Math.min(1, hits / Math.max(1, q.size)) };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  async all() {
    return this.items.slice();
  }

  async restore() {
    return { restored: 0, skipped: this.items.length, failed: 0, total: this.items.length };
  }
}

const tokens = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
