// Walrus Memory on mainnet, through the managed relayer. The relayer embeds,
// SEAL-encrypts and uploads each memory as a Walrus blob, and serves semantic
// recall scoped to (account, namespace).

import { createHash } from "node:crypto";
import { MemWal } from "@mysten-incubation/memwal";

export const NAMESPACE = "hindsight-v1";
export const MAINNET_RELAYER = "https://relayer.memory.walrus.xyz";

export class WalrusStore {
  constructor({ key, accountId, serverUrl = MAINNET_RELAYER, namespace = NAMESPACE }) {
    if (!key || !accountId) throw new Error("WalrusStore needs MEMWAL_KEY and MEMWAL_ACCOUNT_ID (memory.walrus.xyz)");
    this.name = serverUrl === MAINNET_RELAYER ? "walrus-memory-mainnet" : `walrus-memory (${serverUrl})`;
    this.mainnet = serverUrl === MAINNET_RELAYER;
    this.namespace = namespace;
    this.client = MemWal.create({ key, accountId, serverUrl, namespace });
  }

  async health() {
    return this.client.health();
  }

  async remember(text) {
    const r = await this.client.rememberAndWait(text, this.namespace, { timeoutMs: 120_000, idempotencyKey: digest(text) });
    return { blobId: r.blob_id, id: r.id };
  }

  async recall(query, limit = 10) {
    const r = await this.client.recall({ query, limit, namespace: this.namespace, timeoutMs: 30_000 });
    return r.results.map((m) => ({ text: m.text, blobId: m.blob_id, distance: m.distance, createdAt: m.created_at }));
  }

  /** Re-index this namespace from its Walrus blobs (the relayer re-embeds anything missing). */
  async restore(limit = 100) {
    return this.client.restore(this.namespace, limit);
  }
}

// Same text, same key: a retried write after a timeout cannot create a duplicate memory.
const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 32);
