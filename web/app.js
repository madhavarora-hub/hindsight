// Hindsight UI. Talks to the Node server when there is one (Walrus Memory on
// mainnet, Tatum RPC). On a static host it runs the same engine in the
// browser against public Sui GraphQL, with memory kept in localStorage, and
// labels itself as such.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x) => `${Math.round(x * 100)}%`;
const ago = (ms) => {
  const s = Math.round((ms - Date.now()) / 1000);
  if (s <= 0) return "due now";
  return s < 120 ? `in ${s}s` : s < 7200 ? `in ${Math.round(s / 60)} min` : `in ${Math.round(s / 3600)} h`;
};

async function connect() {
  try {
    const r = await fetch("api/info", { cache: "no-store" });
    if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) {
      const info = await r.json();
      const call = async (method, path, body) => {
        const res = await fetch(`api/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        return json;
      };
      return {
        info,
        state: () => call("GET", "state"),
        snapshot: () => call("GET", "snapshot"),
        coach: (d) => call("POST", "coach", d),
        forecast: (d) => call("POST", "forecast", d),
        resolve: () => call("POST", "resolve", {}),
        bots: () => call("POST", "bots", { windowMin: 3 }),
      };
    }
  } catch {}
  return browserEngine();
}

async function browserEngine() {
  const [{ Hindsight }, { LocalStore }, { SuiGraphQL }, { runBots, BOTS }] = await Promise.all([
    import("../core/engine.js"),
    import("../core/local-store.js"),
    import("../core/sui.js"),
    import("../core/bots.js"),
  ]);
  const KEY = "hindsight-memories-v1";
  const store = new LocalStore({
    initial: JSON.parse(localStorage.getItem(KEY) ?? "[]"),
    onChange: (items) => localStorage.setItem(KEY, JSON.stringify(items)),
  });
  store.name = "this browser (not on Walrus)";
  const engine = await new Hindsight({ store, sui: new SuiGraphQL() }).load();
  return {
    info: { store: store.name, mainnet: false, source: engine.sui.name, bots: BOTS, browser: true },
    state: async () => engine.state(),
    snapshot: () => engine.snapshot(),
    coach: (d) => engine.coach(d),
    forecast: (d) => engine.forecast(d, { acceptSuggestion: Boolean(d.acceptSuggestion) }),
    resolve: () => engine.resolveDue(),
    bots: () => runBots(engine, { windowMin: 3 }),
  };
}

const api = await connect();
let snap = null;
let mainnet = api.info.mainnet;

function blobLink(id) {
  if (!id) return "";
  if (!mainnet || String(id).startsWith("local-")) return `<small>${esc(id)}</small>`;
  return `<small>blob <a href="https://walruscan.com/mainnet/blob/${encodeURIComponent(id)}" target="_blank" rel="noopener">${esc(id)}</a></small>`;
}

function badges() {
  const m = api.info.mainnet;
  const tatum = api.info.source.startsWith("tatum");
  $("#badges").innerHTML =
    `<span class="badge ${m ? "on" : "off"}">memory: ${esc(api.info.store)}</span>` +
    `<span class="badge ${tatum ? "on" : "off"}">chain: ${esc(api.info.source)}</span>`;
}

async function refreshLive() {
  try {
    snap = await api.snapshot();
    const ref = snap.reference && !snap.reference.error
      ? `<span>Tatum rate <b>$${snap.reference.usd.toFixed(4)}</b> (${snap.reference.gap >= 0 ? "+" : ""}${(snap.reference.gap * 100).toFixed(2)}% vs pool${Math.abs(snap.reference.gap) > 0.01 ? ", <b class=miss>sources disagree</b>" : ""})</span>`
      : "";
    $("#live").innerHTML =
      `<span>SUI on Cetus <b>$${snap.suiUsd.toFixed(4)}</b></span>${ref}` +
      `<span>gas <b>${snap.gasPrice}</b> MIST</span>` +
      `<span>throughput <b>${snap.txPerSec.toFixed(1)}</b> tx/s</span>` +
      `<span>checkpoint <b>${snap.checkpoint.seq.toLocaleString()}</b></span>`;
    prefillThreshold(false);
  } catch (e) {
    $("#live").textContent = `Could not read Sui: ${e.message}`;
  }
}

// ---- form + live coaching -------------------------------------------------

const form = $("#form");
let coached = null;

function draft() {
  const fd = new FormData(form);
  const d = {
    voice: fd.get("voice").trim(),
    kind: fd.get("kind"),
    op: fd.get("op"),
    threshold: Number(fd.get("threshold")),
    p: Number(fd.get("p")) / 100,
    deadlineMs: Date.now() + Number(fd.get("window")) * 60_000,
    note: fd.get("note") || undefined,
  };
  if (d.kind === "balance") d.params = { address: fd.get("address").trim() };
  return d;
}

function prefillThreshold(force) {
  const t = form.elements.threshold;
  if (!snap || (t.value && !force)) return;
  const kind = form.elements.kind.value;
  const min = Number(form.elements.window.value);
  t.value = kind === "sui_price" ? snap.suiUsd.toFixed(4) : kind === "gas_price" ? snap.gasPrice : kind === "network_tx" ? Math.round(snap.txPerSec * min * 60) : "";
}

let coachTimer;
function scheduleCoach() {
  clearTimeout(coachTimer);
  coachTimer = setTimeout(runCoach, 250);
}

async function runCoach() {
  const d = draft();
  $("#p-out").textContent = pct(d.p);
  if (!d.voice) {
    $("#coach").innerHTML = `<span class="muted">Type a name and Hindsight will check that voice's track record in memory.</span>`;
    $("#coached-btn").disabled = true;
    return;
  }
  try {
    const c = await api.coach(d);
    coached = c.basis ? c : null;
    $("#coached-btn").disabled = !coached || Math.abs(c.delta) < 0.02;
    $("#coached-btn").textContent = coached ? `Log Hindsight's number (${pct(c.p)})` : "Log Hindsight's number";
    const mem = c.recalled.filter((m) => m.distance < 0.9).slice(0, 3);
    $("#coach").innerHTML =
      `<div class="big">${esc(c.message)}</div>` +
      (c.lessons.length ? `<ul>${c.lessons.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "") +
      (mem.length ? `<details><summary>Recalled from memory (${mem.length})</summary><ul>${mem.map((m) => `<li>${esc(m.text)}</li>`).join("")}</ul></details>` : "");
  } catch (e) {
    $("#coach").textContent = e.message;
  }
}

form.addEventListener("input", (e) => {
  if (e.target.name === "kind") {
    $("#addr-row").hidden = form.elements.kind.value !== "balance";
    prefillThreshold(true);
  }
  if (e.target.name === "window" && form.elements.kind.value === "network_tx") prefillThreshold(true);
  scheduleCoach();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = draft();
  d.acceptSuggestion = e.submitter?.value === "coached";
  busy(true);
  try {
    await api.forecast(d);
    form.elements.note.value = "";
    await render();
    await runCoach();
  } catch (err) {
    alert(err.message);
  } finally {
    busy(false);
  }
});

function busy(on) {
  for (const b of document.querySelectorAll("button")) b.disabled = on || (b.id === "coached-btn" && !coached);
  document.body.style.cursor = on ? "progress" : "";
}

$("#resolve").onclick = async () => {
  busy(true);
  try { await api.resolve(); await render(); } catch (e) { alert(e.message); } finally { busy(false); }
};
$("#bots").onclick = async () => {
  busy(true);
  try { await api.bots(); await render(); } catch (e) { alert(e.message); } finally { busy(false); }
};

// ---- rendering --------------------------------------------------------------

async function render() {
  const s = await api.state();
  mainnet = s.mainnet;
  $("#open").innerHTML = s.open.length
    ? s.open.map((f) => `<li><b>${esc(f.voice)}</b> ${pct(f.p)}: ${esc(f.text)} <small>${ago(f.deadlineMs)}${f.statedP ? ` · coached from ${pct(f.statedP)}` : ""}</small></li>`).join("")
    : `<li class="muted">No open calls. Log one, or run the house bots.</li>`;
  $("#settled").innerHTML = s.resolutions.length
    ? s.resolutions.slice(0, 12).map((r) =>
        `<li><span class="${r.hit ? "hit" : "miss"}">${r.hit ? "✓ right" : "✗ wrong"}</span> <b>${esc(r.voice)}</b> said ${pct(r.p)}: ${esc(r.text)}` +
        `<small>${r.outcome ? "YES" : "NO"}, observed ${esc(r.observed)} at checkpoint ${esc(r.evidence.checkpointSeq)} via ${esc(r.evidence.source)}</small></li>`).join("")
    : `<li class="muted">Nothing settled yet.</li>`;
  $("#voices tbody").innerHTML = s.voices.map((v) =>
    `<tr><td>${esc(v.voice)}</td><td>${v.hits}/${v.n}</td><td>${pct(v.meanConf)}</td><td>${v.skill.toFixed(2)}</td><td>${esc(v.verdict)}</td></tr>`).join("") ||
    `<tr><td colspan="5" class="muted">No settled calls yet.</td></tr>`;
  $("#buckets tbody").innerHTML = s.buckets.map((b) =>
    `<tr><td>${pct(b.lo)}–${pct(b.hi)}</td><td>${b.n}</td><td>${b.n ? pct(b.hitRate) : "–"}</td></tr>`).join("");
  chart(s.buckets);
  $("#lessons").innerHTML = s.lessons.length
    ? s.lessons.map((l) => `<li class="${l.active ? "" : "stale"}">${esc(l.text)}${l.active ? "" : " <small>(no longer true: the record has since improved)</small>"}</li>`).join("")
    : `<li class="muted">Lessons appear after a voice has 3+ settled calls that drift from what it said.</li>`;
  $("#mem-count").textContent = `${s.writes} memories in ${s.store}`;
  $("#memories").innerHTML = s.memories.slice(0, 25).map((m) =>
    `<li>${esc(m.text.replace(/\s*\[hs1 .*\]\s*$/s, ""))}${blobLink(m.blobId)}</li>`).join("");
}

// Calibration: stated confidence (x) vs how often it came true (y). One series,
// so no legend; the dashed diagonal is "perfectly calibrated".
function chart(buckets) {
  const W = 360, H = 240, L = 40, R = 12, T = 12, B = 34;
  const x = (v) => L + ((v - 0.5) / 0.5) * (W - L - R);
  const y = (v) => T + (1 - v) * (H - T - B);
  const pts = buckets.filter((b) => b.n > 0).map((b) => ({ ...b, cx: x(b.meanConf), cy: y(b.hitRate) }));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="10">${pct(v)}</text>`).join("");
  const xt = [0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v) => `<text x="${x(v)}" y="${H - B + 14}" text-anchor="middle" fill="var(--muted)" font-size="10">${pct(v)}</text>`).join("");
  const line = pts.length > 1 ? `<polyline points="${pts.map((p) => `${p.cx},${p.cy}`).join(" ")}" fill="none" stroke="var(--series-1)" stroke-width="2"/>` : "";
  const dots = pts.map((p, i) => `<circle cx="${p.cx}" cy="${p.cy}" r="5" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2" data-i="${i}"/><circle cx="${p.cx}" cy="${p.cy}" r="14" fill="transparent" data-i="${i}"/>`).join("");
  $("#chart").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calibration chart: stated confidence against how often calls came true">` +
    grid + xt +
    `<line x1="${x(0.5)}" y1="${y(0.5)}" x2="${x(1)}" y2="${y(1)}" stroke="var(--muted)" stroke-dasharray="4 4" stroke-width="1"/>` +
    `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" fill="var(--text-secondary)" font-size="10">stated confidence</text>` +
    line + dots +
    (pts.length ? "" : `<text x="${(L + W) / 2}" y="${y(0.25)}" text-anchor="middle" fill="var(--muted)" font-size="12">No settled calls yet</text>`) +
    `</svg><div class="tip" hidden></div>`;
  const tip = $("#chart .tip");
  $("#chart svg").addEventListener("pointermove", (e) => {
    const i = e.target.dataset?.i;
    if (i === undefined) return (tip.hidden = true);
    const p = pts[i];
    tip.hidden = false;
    tip.innerHTML = `said ~${pct(p.meanConf)} · came true ${pct(p.hitRate)} · ${p.n} call${p.n > 1 ? "s" : ""}`;
    const box = $("#chart").getBoundingClientRect();
    tip.style.left = `${e.clientX - box.left + 10}px`;
    tip.style.top = `${e.clientY - box.top - 30}px`;
  });
  $("#chart svg").addEventListener("pointerleave", () => (tip.hidden = true));
}

async function ledger() {
  try {
    const r = await fetch("ledger.json", { cache: "no-store" });
    if (!r.ok) return;
    const l = await r.json();
    if (!l.memories?.length) return;
    $("#ledger-card").hidden = false;
    $("#ledger-meta").textContent = `${l.memories.length} memories in ${l.store}, exported ${l.exportedAt.slice(0, 16).replace("T", " ")} UTC`;
    const wasMainnet = mainnet;
    mainnet = l.mainnet;
    $("#ledger").innerHTML = l.memories.map((m) => `<li>${esc(m.text.replace(/\s*\[hs1 .*\]\s*$/s, ""))}${blobLink(m.blobId)}</li>`).join("");
    mainnet = wasMainnet;
  } catch {}
}

badges();
await Promise.all([refreshLive(), render(), ledger()]);
runCoach();
setInterval(refreshLive, 30_000);
// Settle due calls automatically while the page is open.
setInterval(async () => {
  const s = await api.state();
  if (s.open.some((f) => f.deadlineMs <= Date.now())) {
    await api.resolve().catch(() => {});
  }
  await render();
}, 20_000);
