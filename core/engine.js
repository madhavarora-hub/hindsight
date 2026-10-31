// Hindsight's engine. The only durable state is what it has written to memory:
// forecasts, resolutions and lessons. load() rebuilds everything from recall,
// so a fresh machine with the same Walrus Memory account picks up exactly
// where the last one stopped.

import { encode, decode } from "./codec.js";
import { KINDS, validateForecast, settle, describe } from "./markets.js";
import { voiceStats, calibrationBuckets, suggest, lessons, lessonChanged } from "./scoring.js";

// Recall is semantic and capped at 100 results per query, so state is rebuilt
// from a few queries phrased like the memories themselves, then de-duplicated.
export const STATE_QUERIES = [
  "Hindsight forecast stated YES",
  "Hindsight resolution: the call was right",
  "Hindsight resolution: the call was wrong",
  "Lesson: overconfident underconfident treat a call as",
];

export class Hindsight {
  constructor({ store, sui, rate = null, now = () => Date.now() }) {
    this.store = store;
    this.sui = sui;
    this.rate = rate; // optional off-chain reference price (Tatum Data API)
    this.now = now;
    this.reset();
  }

  reset() {
    this.forecasts = new Map();
    this.resolutions = new Map();
    this.lessonByKey = new Map();
    this.log = []; // { t, text, blobId, at }
  }

  async load() {
    this.reset();
    const seen = new Set();
    const batches = this.store.all ? [await this.store.all()] : [];
    if (!this.store.all) for (const q of STATE_QUERIES) batches.push(await this.store.recall(q, 100));
    for (const m of batches.flat()) {
      if (seen.has(m.text)) continue;
      seen.add(m.text);
      const r = decode(m.text);
      if (r) this.apply(r, { text: m.text, blobId: m.blobId, at: m.createdAt });
    }
    this.log.sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
    return this;
  }

  apply(r, meta) {
    if (r.t === "forecast") this.forecasts.set(r.f.id, r.f);
    if (r.t === "resolution") {
      this.resolutions.set(r.f.id, r);
      if (!this.forecasts.has(r.f.id)) this.forecasts.set(r.f.id, r.f);
    }
    if (r.t === "lesson") {
      const prev = this.lessonByKey.get(r.lesson.key);
      if (!prev || (prev.atMs ?? 0) <= (r.lesson.atMs ?? 0)) this.lessonByKey.set(r.lesson.key, r.lesson);
    }
    this.log.push({ t: r.t, text: meta.text, blobId: meta.blobId, at: meta.at ?? new Date(this.now()).toISOString() });
  }

  async write(record) {
    const text = encode(record);
    const { blobId } = await this.store.remember(text);
    this.apply(record, { text, blobId, at: new Date(this.now()).toISOString() });
    return blobId;
  }

  resolved() {
    return [...this.resolutions.values()].map((r) => ({ voice: r.f.voice, kind: r.f.kind, p: r.f.p, outcome: r.outcome }));
  }

  open() {
    return [...this.forecasts.values()].filter((f) => !this.resolutions.has(f.id)).sort((a, b) => a.deadlineMs - b.deadlineMs);
  }

  /** Live readings for every market kind, plus a cross-source price check. */
  async snapshot({ address } = {}) {
    const [cp, price, gas] = await Promise.all([this.sui.checkpoint(), this.sui.suiPrice(), this.sui.referenceGasPrice()]);
    const back = await this.sui.checkpointAt(Math.max(0, cp.seq - 1000));
    const txPerSec =
      ((cp.networkTotalTransactions - back.networkTotalTransactions) * 1000) / Math.max(1, cp.timestampMs - back.timestampMs);
    const out = { source: this.sui.name, checkpoint: cp, suiUsd: price.usd, gasPrice: gas, txPerSec, reference: null };
    if (this.rate) {
      try {
        const ref = await this.rate();
        out.reference = { ...ref, gap: (price.usd - ref.usd) / ref.usd };
      } catch (e) {
        out.reference = { error: String(e.message ?? e) };
      }
    }
    if (address) out.balance = await this.sui.balanceSui(address);
    return out;
  }

  /** Coach a draft: the numeric suggestion plus the memories that justify it. */
  async coach(draft) {
    const d = { ...draft, p: Number(draft.p) };
    const s = suggest(d, this.resolved());
    const recalled = await this.store.recall(`Lesson: how reliable is ${d.voice} on ${d.kind} calls?`, 5);
    return {
      ...s,
      lessons: [...this.lessonByKey.values()].filter((l) => l.voice === d.voice).map((l) => l.text),
      recalled: recalled.map((m) => ({ text: m.text.replace(/\s*\[hs1 .*\]\s*$/s, ""), blobId: m.blobId, distance: m.distance })),
    };
  }

  /** Log a call. The baseline is read from chain at the moment of logging. */
  async forecast(input, { acceptSuggestion = false } = {}) {
    const createdMs = this.now();
    const f = {
      id: input.id ?? `${createdMs.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      voice: String(input.voice ?? "").trim(),
      kind: input.kind,
      op: input.op,
      threshold: Number(input.threshold),
      p: Number(input.p),
      createdMs,
      deadlineMs: Number(input.deadlineMs),
    };
    if (input.note) f.note = String(input.note).slice(0, 200);
    if (input.params) f.params = input.params;
    validateForecast(f);
    if (acceptSuggestion) {
      const s = suggest(f, this.resolved());
      if (s.basis) {
        f.statedP = f.p;
        f.p = Math.round(s.p * 100) / 100;
      }
    }
    f.baseline = await KINDS[f.kind].baseline(this.sui, f);
    f.source = this.sui.name;
    const blobId = await this.write({ t: "forecast", f });
    return { f, blobId, text: describe(f) };
  }

  /** Settle every call whose deadline has passed, then refresh lessons. */
  async resolveDue() {
    const due = this.open().filter((f) => f.deadlineMs <= this.now());
    if (!due.length) return { resolved: [], lessons: [] };
    const cp = await this.sui.checkpoint();
    const resolved = [];
    for (const f of due) {
      if (cp.timestampMs < f.deadlineMs) continue; // chain hasn't reached the deadline yet
      const m = await KINDS[f.kind].measure(this.sui, f, cp);
      const outcome = settle(f.op, m.value, f.threshold);
      const evidence = { checkpointSeq: cp.seq, checkpointDigest: cp.digest, timestampMs: cp.timestampMs, source: this.sui.name, ...m.extra };
      const blobId = await this.write({ t: "resolution", f, outcome, observed: round(m.value), evidence });
      resolved.push({ id: f.id, voice: f.voice, text: describe(f), p: f.p, outcome, observed: m.value, blobId });
    }
    return { resolved, lessons: await this.refreshLessons() };
  }

  async refreshLessons() {
    const written = [];
    for (const l of lessons(this.resolved())) {
      if (!lessonChanged(this.lessonByKey.get(l.key), l)) continue;
      const blobId = await this.write({ t: "lesson", lesson: { ...l, atMs: this.now() } });
      written.push({ text: l.text, blobId });
    }
    return written;
  }

  state() {
    const resolved = this.resolved();
    const live = new Set(lessons(resolved).map((l) => l.key));
    const resolutions = [...this.resolutions.values()]
      .sort((a, b) => b.evidence.timestampMs - a.evidence.timestampMs)
      .map((r) => ({
        ...r.f,
        text: describe(r.f),
        outcome: r.outcome,
        observed: r.observed,
        evidence: r.evidence,
        hit: r.outcome === r.f.p >= 0.5,
      }));
    return {
      store: this.store.name,
      mainnet: Boolean(this.store.mainnet),
      source: this.sui.name,
      open: this.open().map((f) => ({ ...f, text: describe(f) })),
      resolutions,
      voices: voiceStats(resolved),
      buckets: calibrationBuckets(resolved),
      lessons: [...this.lessonByKey.values()].map((l) => ({ ...l, active: live.has(l.key) })),
      memories: this.log.slice().reverse(),
      writes: this.log.length,
    };
  }
}

const round = (x) => Math.round(x * 1e6) / 1e6;
