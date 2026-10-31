// Scoring and the learning loop. Everything here is pure: it takes resolved
// forecasts (as recalled from Walrus Memory) and returns numbers and words.
//
// A resolved forecast is { voice, kind, p, outcome } where p is the stated
// probability of YES and outcome is whether YES happened.

export const PRIOR_STRENGTH = 4; // pseudo-calls that keep thin evidence close to the stated number
const BAND = 0.1;
const MIN_EVIDENCE = 3;
export const LESSON_GAP = 0.15;

export const brier = (p, outcome) => (p - (outcome ? 1 : 0)) ** 2;
export const confidence = (p) => Math.max(p, 1 - p);
export const isHit = (r) => r.outcome === r.p >= 0.5;

function tally(rs) {
  const n = rs.length;
  const hits = rs.filter(isHit).length;
  const meanConf = n ? rs.reduce((s, r) => s + confidence(r.p), 0) / n : 0;
  const meanBrier = n ? rs.reduce((s, r) => s + brier(r.p, r.outcome), 0) / n : 0;
  return { n, hits, hitRate: n ? hits / n : 0, meanConf, meanBrier };
}

export function calibrationBuckets(resolved) {
  const edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    const t = tally(resolved.filter((r) => confidence(r.p) >= lo && confidence(r.p) < hi));
    return { lo, hi: Math.min(hi, 1), ...t };
  });
}

export function voiceStats(resolved) {
  const byVoice = groupBy(resolved, (r) => r.voice);
  return Object.entries(byVoice)
    .map(([voice, rs]) => {
      const t = tally(rs);
      // Brier skill vs. always saying 50%: 1 is perfect, 0 is a coin, negative is worse than a coin.
      const skill = 1 - t.meanBrier / 0.25;
      const gap = t.meanConf - t.hitRate;
      return { voice, ...t, skill, gap, verdict: verdict(t.n, skill, gap) };
    })
    .sort((a, b) => b.skill - a.skill || b.n - a.n);
}

function verdict(n, skill, gap) {
  if (n < MIN_EVIDENCE) return "not enough calls yet";
  if (gap >= LESSON_GAP) return "overconfident";
  if (gap <= -LESSON_GAP) return "underconfident";
  if (skill > 0.1) return "calibrated, adds signal";
  if (skill < -0.1) return "worse than a coin flip";
  return "calibrated, little signal";
}

/**
 * Coach a draft call. Looks for the draft voice's past calls at similar
 * confidence (same market kind first, then any kind), then shrinks the
 * realised hit rate toward the stated confidence by PRIOR_STRENGTH.
 */
export function suggest(draft, resolved) {
  const c = confidence(draft.p);
  const yes = draft.p >= 0.5;
  const mine = resolved.filter((r) => r.voice === draft.voice);
  const near = (r) => Math.abs(confidence(r.p) - c) <= BAND + 1e-9;
  const scopes = [
    { scope: `${draft.voice} on ${draft.kind} calls near ${pct(c)}`, rs: mine.filter((r) => r.kind === draft.kind && near(r)) },
    { scope: `${draft.voice} on any call near ${pct(c)}`, rs: mine.filter(near) },
    { scope: `${draft.voice} on all calls`, rs: mine, offset: true },
  ];
  const pick = scopes.find((s) => s.rs.length >= MIN_EVIDENCE);
  if (!pick) {
    return { p: draft.p, delta: 0, basis: null, message: `No track record yet for ${draft.voice} (${mine.length} resolved). Hindsight keeps your number.` };
  }
  const t = tally(pick.rs);
  const w = t.n / (t.n + PRIOR_STRENGTH);
  const adjConf = pick.offset
    ? c + w * (t.hitRate - t.meanConf) // shift by the voice's average over/under-confidence
    : (t.hits + PRIOR_STRENGTH * c) / (t.n + PRIOR_STRENGTH);
  const clamped = Math.min(0.99, Math.max(0.01, adjConf));
  const p = yes ? clamped : 1 - clamped;
  const delta = p - draft.p;
  const message =
    Math.abs(delta) < 0.02
      ? `Track record backs ${pct(draft.p)}: ${t.hits}/${t.n} hits for ${pick.scope}.`
      : `${pick.scope}: ${t.hits}/${t.n} came true (stated ~${pct(t.meanConf)}). Hindsight suggests ${pct(p)} instead of ${pct(draft.p)}.`;
  return { p, delta, basis: { scope: pick.scope, ...t }, message };
}

/** Durable, human-readable lessons. Written to Walrus Memory when they change. */
export function lessons(resolved) {
  const out = [];
  const consider = (voice, kind, rs) => {
    const t = tally(rs);
    if (t.n < MIN_EVIDENCE) return;
    const gap = t.meanConf - t.hitRate;
    if (Math.abs(gap) < LESSON_GAP) return;
    const direction = gap > 0 ? "overconfident" : "underconfident";
    const where = kind ? `${kind} calls` : "calls overall";
    const shade = (t.hits + PRIOR_STRENGTH * t.meanConf) / (t.n + PRIOR_STRENGTH);
    out.push({
      key: `${voice}|${kind ?? "*"}|${direction}`,
      voice,
      kind: kind ?? null,
      direction,
      n: t.n,
      hits: t.hits,
      meanConf: t.meanConf,
      gap,
      text:
        `Lesson: ${voice} is ${direction} on ${where}. Said ~${pct(t.meanConf)} on average, ` +
        `was right ${t.hits}/${t.n} (${pct(t.hitRate)}). Treat a ${pct(t.meanConf)} call from ${voice} as ~${pct(shade)}.`,
    });
  };
  for (const [voice, rs] of Object.entries(groupBy(resolved, (r) => r.voice))) {
    consider(voice, null, rs);
    for (const [kind, krs] of Object.entries(groupBy(rs, (r) => r.kind))) consider(voice, kind, krs);
  }
  return out;
}

/** A lesson is worth a new memory if it is new or its gap moved by 10+ points. */
export function lessonChanged(prev, next) {
  return !prev || Math.abs(prev.gap - next.gap) >= 0.1;
}

export function pct(x) {
  return `${Math.round(x * 100)}%`;
}

function groupBy(xs, f) {
  const out = {};
  for (const x of xs) (out[f(x)] ??= []).push(x);
  return out;
}
