// Every memory is a plain-English sentence (so Walrus Memory's semantic recall
// finds it by meaning) followed by a machine tag (so Hindsight can rebuild its
// exact state from recall results alone, with no other database).

import { describe } from "./markets.js";
import { pct } from "./scoring.js";

const TAG = /\[hs1 (\{.*\})\]\s*$/s;

export function encode(record) {
  return `${sentence(record)} [hs1 ${JSON.stringify(record)}]`;
}

export function decode(text) {
  const m = TAG.exec(text ?? "");
  if (!m) return null;
  try {
    const r = JSON.parse(m[1]);
    return r && typeof r.t === "string" ? r : null;
  } catch {
    return null;
  }
}

function sentence(r) {
  switch (r.t) {
    case "forecast":
      return `Hindsight forecast by ${r.f.voice}: ${describe(r.f)}. Stated ${pct(r.f.p)} YES.${r.f.note ? ` Reason: ${r.f.note.replace(/[.!?]+$/, "")}.` : ""}`;
    case "resolution": {
      const right = r.outcome === r.f.p >= 0.5;
      return (
        `Hindsight resolution: ${r.f.voice} said ${pct(r.f.p)} that ${describe(r.f)}. ` +
        `${r.outcome ? "YES" : "NO"} happened, so the call was ${right ? "right" : "wrong"}. ` +
        `Observed ${r.observed} at Sui checkpoint ${r.evidence.checkpointSeq}.`
      );
    }
    case "lesson":
      return r.lesson.text;
    default:
      throw new Error(`unknown record type ${r.t}`);
  }
}
