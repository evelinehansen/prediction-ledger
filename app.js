/*
 * app.js — UI wiring and rendering.
 * All statistics come from engine.js; all persistence from storage.js.
 */

import {
  MIN_BUCKET_SIZE,
  computeBuckets,
  overallStats,
  headline,
  openPredictions,
  resolvedPredictions,
  flipStatement,
  mirrorConfidence,
} from "./engine.js";

import {
  load,
  save,
  newId,
  exportLedger,
  parseImport,
  mergeLedgers,
  daysSinceBackup,
} from "./storage.js";

const $ = (id) => document.getElementById(id);

let data = load();
let activeView = "ledger";
let historyFilter = "all";
let categoryFilter = "all";
let pendingImport = null;
let revealedBuckets = loadRevealed();

/* ---------- Small helpers ---------- */

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function todayStr() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

/* Plain-language distance to a resolve-by date. */
function dueLabel(resolveBy) {
  const today = todayStr();
  if (resolveBy === today) return { text: "due today", overdue: false, due: true };
  if (resolveBy < today) {
    const days = Math.round(
      (new Date(today) - new Date(resolveBy)) / 86400000
    );
    const text = days === 1 ? "overdue by 1 day" : "overdue by " + days + " days";
    return { text, overdue: true, due: true };
  }
  const days = Math.round((new Date(resolveBy) - new Date(today)) / 86400000);
  const text = days === 1 ? "due tomorrow" : "due in " + days + " days";
  return { text, overdue: false, due: false };
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function persist() {
  if (!save(data)) {
    toast("Could not save. Your browser storage may be full.");
  }
  renderBackupNudge();
}

/* Remember which buckets have already played their reveal animation. */
function loadRevealed() {
  try {
    return new Set(
      JSON.parse(sessionStorage.getItem("predictionLedger.revealed") || "[]")
    );
  } catch {
    return new Set();
  }
}
function saveRevealed() {
  try {
    sessionStorage.setItem(
      "predictionLedger.revealed",
      JSON.stringify([...revealedBuckets])
    );
  } catch { /* cosmetic only */ }
}

/* ---------- Category filter (applies to every view) ---------- */

/* Distinct categories, case-insensitive, keeping the first-seen spelling. */
function categoryList() {
  const map = new Map();
  for (const p of data.predictions) {
    const c = (p.category || "").trim();
    if (!c) continue;
    const key = c.toLowerCase();
    if (!map.has(key)) map.set(key, c);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function visiblePredictions() {
  if (categoryFilter === "all") return data.predictions;
  return data.predictions.filter(
    (p) => (p.category || "").trim().toLowerCase() === categoryFilter
  );
}

function renderCategoryFilter() {
  const el = $("categoryFilter");
  const cats = categoryList();
  if (!cats.length) {
    categoryFilter = "all";
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  if (categoryFilter !== "all" && !cats.some(([key]) => key === categoryFilter)) {
    categoryFilter = "all";
  }
  el.hidden = false;
  el.innerHTML =
    '<button class="chip' + (categoryFilter === "all" ? " selected" : "") +
      '" type="button" data-category="all">All categories</button>' +
    cats
      .map(
        ([key, label]) =>
          '<button class="chip' + (categoryFilter === key ? " selected" : "") +
            '" type="button" data-category="' + esc(key) + '">' + esc(label) + "</button>"
      )
      .join("");
}

/* ---------- Tabs ---------- */

function switchView(view) {
  activeView = view;
  for (const tab of document.querySelectorAll(".tab")) {
    tab.setAttribute("aria-selected", String(tab.dataset.view === view));
  }
  $("view-ledger").hidden = view !== "ledger";
  $("view-calibration").hidden = view !== "calibration";
  $("view-history").hidden = view !== "history";
  render();
}

/* ---------- Ledger view ---------- */

const STARTERS = [
  { statement: "I will go to bed before 23:00 tonight", confidence: 70, days: 1 },
  { statement: "I will finish this week's most important task on time", confidence: 80, days: 4 },
  { statement: "I will exercise at least twice in the next 7 days", confidence: 75, days: 7 },
];

function predCardHTML(p, { withResolve } = {}) {
  const due = dueLabel(p.resolveBy);
  const meta = [
    '<span>' + p.confidence + " percent sure</span>",
    '<span class="' + (due.overdue ? "overdue" : "") + '">' + esc(due.text) + "</span>",
  ];
  if (p.category) meta.push('<span class="cat-chip">' + esc(p.category) + "</span>");

  let resolveRow = "";
  if (withResolve) {
    resolveRow =
      '<div class="resolve-row" data-stop>' +
        '<button class="btn happened" type="button" data-resolve="happened">Happened</button>' +
        '<button class="btn didnt" type="button" data-resolve="didnt">Didn\'t</button>' +
        '<button class="btn ghost" type="button" data-resolve="void">Void</button>' +
        '<button class="resolve-note-toggle" type="button" data-note-toggle>add a note</button>' +
      "</div>" +
      '<textarea class="resolve-note" rows="2" placeholder="What actually happened (optional)" hidden data-stop></textarea>';
  }

  return (
    '<article class="pred-card' + (withResolve ? " due" : "") + '" data-id="' + p.id + '" tabindex="0" role="button" aria-label="' + esc(p.statement) + '">' +
      '<p class="pred-statement">' + esc(p.statement) + "</p>" +
      '<div class="pred-meta">' + meta.join("") + "</div>" +
      resolveRow +
    "</article>"
  );
}

function renderLedger() {
  const open = openPredictions(visiblePredictions())
    .slice()
    .sort((a, b) => a.resolveBy.localeCompare(b.resolveBy) || a.created.localeCompare(b.created));

  const today = todayStr();
  const dueNow = open.filter((p) => p.resolveBy <= today);
  const later = open.filter((p) => p.resolveBy > today);

  const isEmpty = data.predictions.length === 0;
  $("emptyState").hidden = !isEmpty;
  $("addBtn").hidden = isEmpty;

  $("dueSection").hidden = dueNow.length === 0;
  $("dueList").innerHTML = dueNow.map((p) => predCardHTML(p, { withResolve: true })).join("");

  $("openSection").hidden = later.length === 0;
  $("openList").innerHTML = later.map((p) => predCardHTML(p)).join("");

  const noneOpen = !isEmpty && open.length === 0;
  $("ledgerEmpty").hidden = !noneOpen;
  $("ledgerEmpty").textContent =
    categoryFilter === "all"
      ? "Nothing open right now. Everything is resolved."
      : "No open predictions in this category.";

  if (isEmpty) renderStarters();
}

function renderStarters() {
  $("starterList").innerHTML = STARTERS.map(
    (s, i) =>
      '<button class="starter-btn" type="button" data-starter="' + i + '">' +
        esc(s.statement) +
        ' <span class="conf">(' + s.confidence + " percent sure, " +
        (s.days === 1 ? "resolves tomorrow" : "resolves in " + s.days + " days") + ")</span>" +
      "</button>"
  ).join("");
}

/* ---------- Resolving ---------- */

function resolvePrediction(id, outcome, note) {
  const p = data.predictions.find((x) => x.id === id);
  if (!p || p.resolution) return;
  p.resolution = {
    outcome,
    resolvedOn: new Date().toISOString(),
    notes: (note || "").trim(),
  };
  persist();

  const card = document.querySelector('.pred-card[data-id="' + id + '"]');
  const wording = {
    happened: "Happened. Recorded.",
    didnt: "Didn't happen. Recorded.",
    void: "Void. Left out of your statistics.",
  };
  toast(wording[outcome]);

  if (card) {
    card.style.maxHeight = card.offsetHeight + "px";
    requestAnimationFrame(() => card.classList.add("leaving"));
    card.addEventListener("transitionend", () => render(), { once: true });
    // Safety net in case transitionend never fires.
    setTimeout(() => render(), 450);
  } else {
    render();
  }
}

/* ---------- Calibration view ---------- */

function renderCalibration() {
  const pool = visiblePredictions();
  const stats = overallStats(pool);
  $("statOpen").textContent = stats.open;
  $("statResolved").textContent = stats.resolved;
  if (stats.hitRate === null) {
    $("statHitRate").textContent = "–";
    $("statHitRateLabel").textContent = "hit rate (nothing resolved yet)";
  } else {
    $("statHitRate").textContent = Math.round(stats.hitRate) + "%";
    $("statHitRateLabel").textContent =
      "right " + stats.hits + " of " + stats.scorableCount + " times";
  }

  const buckets = computeBuckets(pool);
  const head = headline(buckets);
  const headEl = $("headlineStat");
  headEl.textContent = head.text;
  headEl.className = "headline-stat" + (head.tone ? " " + head.tone : "");

  $("chartWrap").innerHTML = chartSVG(buckets);
  renderBuckets(buckets);
}

function toneFor(b) {
  if (b.gap === null) return null;
  return b.gap <= -10 ? "clay" : "sage";
}

/* Hand-rolled SVG: predicted confidence (x) vs actual hit rate (y). */
function chartSVG(buckets) {
  const W = 460, H = 340;
  const L = 52, R = 16, T = 16, B = 48;
  const x = (conf) => L + ((conf - 50) / 50) * (W - L - R);
  const y = (rate) => T + (1 - rate / 100) * (H - T - B);

  let s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Calibration chart: what you said against what actually happened">';

  // Gridlines and ticks
  for (const v of [0, 25, 50, 75, 100]) {
    s += '<line x1="' + L + '" y1="' + y(v) + '" x2="' + (W - R) + '" y2="' + y(v) + '" stroke="#EDECE2" stroke-width="1"/>';
    s += '<text class="chart-tick" x="' + (L - 8) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + v + "</text>";
  }
  for (const v of [50, 60, 70, 80, 90, 100]) {
    s += '<text class="chart-tick" x="' + x(v) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + v + "</text>";
  }

  // Perfect-calibration diagonal
  s += '<line x1="' + x(50) + '" y1="' + y(50) + '" x2="' + x(100) + '" y2="' + y(100) +
       '" stroke="#9A9E90" stroke-width="1.5" stroke-dasharray="5 5"/>';
  s += '<text class="chart-tick" x="' + (x(75) + 10) + '" y="' + (y(75) - 8) +
       '" text-anchor="start" transform="rotate(-33 ' + (x(75) + 10) + " " + (y(75) - 8) + ')">perfectly calibrated</text>';

  // Connecting line through unlocked buckets
  const pts = buckets
    .filter((b) => b.unlocked)
    .map((b) => [x(b.avgConfidence), y(b.hitRate)]);
  if (pts.length >= 2) {
    s += '<polyline fill="none" stroke="#647F5E" stroke-width="2" opacity="0.5" points="' +
      pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ") + '"/>';
  }

  // Locked slots along the diagonal, then unlocked dots
  for (const b of buckets) {
    const mid = (b.min + b.max + 1) / 2;
    if (!b.unlocked) {
      s += '<circle cx="' + x(mid) + '" cy="' + y(mid) + '" r="7" fill="none" stroke="#9A9E90" stroke-width="1.5" stroke-dasharray="3 3"/>';
    } else {
      const fill = toneFor(b) === "clay" ? "#B96F4E" : "#647F5E";
      s += '<circle cx="' + x(b.avgConfidence) + '" cy="' + y(b.hitRate) + '" r="8" fill="' + fill + '" stroke="#FFFFFF" stroke-width="2">' +
           "<title>Said " + Math.round(b.avgConfidence) + " percent, happened " + Math.round(b.hitRate) + " percent (" + b.count + " resolved)</title></circle>";
    }
  }

  // Axis labels
  s += '<text class="chart-axis-label" x="' + (L + (W - L - R) / 2) + '" y="' + (H - 8) + '" text-anchor="middle">how sure you said you were (percent)</text>';
  s += '<text class="chart-axis-label" x="14" y="' + (T + (H - T - B) / 2) + '" text-anchor="middle" transform="rotate(-90 14 ' + (T + (H - T - B) / 2) + ')">how often it actually happened (percent)</text>';

  s += "</svg>";
  return s;
}

function renderBuckets(buckets) {
  $("bucketList").innerHTML = buckets
    .map((b) => {
      if (!b.unlocked) {
        const need = MIN_BUCKET_SIZE - b.count;
        const pct = (b.count / MIN_BUCKET_SIZE) * 100;
        return (
          '<div class="card bucket-card locked">' +
            '<span class="bucket-range">' + b.label + " percent</span>" +
            '<span class="bucket-text">' + b.count + " of " + MIN_BUCKET_SIZE + " resolved. Resolve " +
              need + " more in this range to reveal it.</span>" +
            '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
          "</div>"
        );
      }
      const tone = toneFor(b);
      const verdict =
        b.gap <= -10
          ? '<span class="gap-clay">may be overconfident</span>'
          : b.gap >= 10
            ? '<span class="gap-sage">may be underconfident</span>'
            : '<span class="gap-sage">well calibrated</span>';
      const revealKey = categoryFilter + ":" + b.key;
      const fresh = !revealedBuckets.has(revealKey);
      if (fresh) { revealedBuckets.add(revealKey); }
      return (
        '<div class="card bucket-card' + (fresh ? " revealed" : "") + '" data-tone="' + tone + '">' +
          '<span class="bucket-range">' + b.label + " percent</span>" +
          '<span class="bucket-text">Right ' + b.hits + " of " + b.count + " times (" +
            Math.round(b.hitRate) + " percent). " + verdict + "</span>" +
        "</div>"
      );
    })
    .join("");
  saveRevealed();
}

/* ---------- History view ---------- */

function renderHistory() {
  const resolved = resolvedPredictions(visiblePredictions())
    .slice()
    .sort((a, b) => (b.resolution.resolvedOn || "").localeCompare(a.resolution.resolvedOn || ""));

  const filtered =
    historyFilter === "all"
      ? resolved
      : resolved.filter((p) => p.resolution.outcome === historyFilter);

  const badgeWord = { happened: "Happened", didnt: "Didn't", void: "Void" };

  $("historyList").innerHTML = filtered
    .map((p) => {
      const meta = [
        '<span class="outcome-badge ' + p.resolution.outcome + '">' + badgeWord[p.resolution.outcome] + "</span>",
        "<span>" + p.confidence + " percent sure</span>",
        "<span>resolved " + esc(formatDate(p.resolution.resolvedOn)) + "</span>",
      ];
      if (p.category) meta.push('<span class="cat-chip">' + esc(p.category) + "</span>");
      return (
        '<article class="pred-card" data-id="' + p.id + '" tabindex="0" role="button" aria-label="' + esc(p.statement) + '">' +
          '<p class="pred-statement">' + esc(p.statement) + "</p>" +
          '<div class="pred-meta">' + meta.join("") + "</div>" +
        "</article>"
      );
    })
    .join("");

  const emptyEl = $("historyEmpty");
  emptyEl.hidden = filtered.length > 0;
  emptyEl.textContent =
    resolvedPredictions(data.predictions).length === 0
      ? "Nothing resolved yet. Resolved predictions collect here."
      : "Nothing resolved matches these filters.";
}

/* ---------- Detail modal ---------- */

function openDetail(id) {
  const p = data.predictions.find((x) => x.id === id);
  if (!p) return;

  const rows = [
    "<div class='detail-row'><strong>" + p.confidence + " percent sure</strong> at the time</div>",
    "<div class='detail-row'>Logged " + esc(formatDate(p.created)) + "</div>",
    "<div class='detail-row'>Resolve by " + esc(formatDate(p.resolveBy)) + "</div>",
  ];
  if (p.category) rows.push("<div class='detail-row'>Category: " + esc(p.category) + "</div>");
  if (p.notes) rows.push("<div class='detail-row'>Notes: " + esc(p.notes) + "</div>");
  if (p.resolution) {
    const word = { happened: "Happened", didnt: "Didn't happen", void: "Void" };
    rows.push(
      "<div class='detail-row'><strong>" + word[p.resolution.outcome] + "</strong>, resolved " +
      esc(formatDate(p.resolution.resolvedOn)) + "</div>"
    );
    if (p.resolution.notes) {
      rows.push("<div class='detail-row'>Resolution note: " + esc(p.resolution.notes) + "</div>");
    }
  }

  let resolveBlock = "";
  if (!p.resolution) {
    resolveBlock =
      '<div class="resolve-row">' +
        '<button class="btn happened" type="button" data-resolve="happened">Happened</button>' +
        '<button class="btn didnt" type="button" data-resolve="didnt">Didn\'t</button>' +
        '<button class="btn ghost" type="button" data-resolve="void">Void</button>' +
      "</div>" +
      '<textarea class="resolve-note" id="detailResolveNote" rows="2" placeholder="What actually happened (optional)"></textarea>';
  }

  $("detailBody").innerHTML =
    '<p class="detail-statement" id="detailStatement">' + esc(p.statement) + "</p>" +
    '<div class="detail-rows">' + rows.join("") + "</div>" +
    resolveBlock +
    '<div class="modal-actions">' +
      '<button class="btn danger" type="button" data-delete="' + p.id + '">Delete</button>' +
      '<button class="btn ghost" type="button" data-close-detail>Close</button>' +
    "</div>";

  $("detailBody").dataset.id = p.id;
  $("detailBackdrop").hidden = false;
  $("detailModal").hidden = false;
  $("detailModal").querySelector("[data-close-detail]").focus();
}

function closeDetail() {
  $("detailBackdrop").hidden = true;
  $("detailModal").hidden = true;
}

/* ---------- Entry form ---------- */

function openEntry(prefill) {
  $("entryForm").reset();
  $("fConfidence").value = prefill?.confidence ?? 75;
  $("fStatement").value = prefill?.statement ?? "";
  $("fResolveBy").value = prefill?.resolveBy ?? "";
  $("fResolveBy").min = todayStr();
  $("formError").hidden = true;
  updateConfLabel();
  $("sheetBackdrop").hidden = false;
  $("entrySheet").hidden = false;
  $("fStatement").focus();
}

function closeEntry() {
  $("sheetBackdrop").hidden = true;
  $("entrySheet").hidden = true;
}

function updateConfLabel() {
  const v = Number($("fConfidence").value);
  const label = $("confLabel");
  label.textContent = v + " percent sure";
  label.classList.toggle("low", v < 50);
  $("confHint").hidden = v >= 50;
}

function saveEntry() {
  const statement = $("fStatement").value.trim();
  const confidence = Number($("fConfidence").value);
  const resolveBy = $("fResolveBy").value;
  const errEl = $("formError");

  let error = "";
  if (!statement) {
    error = "Write the statement first (phrase it so it can be true or false).";
  } else if (confidence < 50) {
    error = "Confidence below 50 percent means you think it will not happen. Tap flip it, then save.";
  } else if (!resolveBy) {
    error = "Pick the date when you'll know the answer.";
  }
  if (error) {
    errEl.textContent = error;
    errEl.hidden = false;
    return;
  }

  data.predictions.push({
    id: newId(),
    statement,
    confidence,
    created: new Date().toISOString(),
    resolveBy,
    category: $("fCategory").value.trim(),
    notes: $("fNotes").value.trim(),
    resolution: null,
  });
  persist();
  closeEntry();
  toast("Prediction saved");
  render();
}

/* ---------- Backup nudge ---------- */

function renderBackupNudge() {
  const el = $("backupNudge");
  const days = daysSinceBackup();
  const hasData = data.predictions.length > 0;
  let text;
  if (days === null) text = "Last backup: never";
  else if (days === 0) text = "Last backup: today";
  else if (days === 1) text = "Last backup: 1 day ago";
  else text = "Last backup: " + days + " days ago";
  el.textContent = text;
  el.classList.toggle("stale", hasData && (days === null || days >= 7));
}

/* ---------- Import ---------- */

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const result = parseImport(String(reader.result));
    if (!result.ok) {
      toast(result.error);
      return;
    }
    pendingImport = result.data;
    const n = result.data.predictions.length;
    const existing = data.predictions.length;
    $("importSummary").textContent =
      "The file contains " + n + (n === 1 ? " prediction. " : " predictions. ") +
      "You currently have " + existing + ". Merge adds only the ones you don't already have. " +
      "Replace throws away everything here and keeps only the file.";
    $("importBackdrop").hidden = false;
    $("importModal").hidden = false;
    $("importCancelBtn").focus();
  };
  reader.onerror = () => toast("Could not read that file.");
  reader.readAsText(file);
}

function closeImport() {
  $("importBackdrop").hidden = true;
  $("importModal").hidden = true;
  pendingImport = null;
}

/* ---------- Render root ---------- */

function render() {
  renderCategoryFilter();

  if (activeView === "ledger") renderLedger();
  else if (activeView === "calibration") renderCalibration();
  else renderHistory();

  // Due badge should be correct on every view and follow the category filter,
  // so it always matches the due queue the Ledger tab would show.
  const today = todayStr();
  const dueCount = openPredictions(visiblePredictions()).filter(
    (p) => p.resolveBy <= today
  ).length;
  const badge = $("dueBadge");
  badge.hidden = dueCount === 0;
  badge.textContent = dueCount;

  renderBackupNudge();
}

/* ---------- Events ---------- */

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
}

$("addBtn").addEventListener("click", () => openEntry());
$("emptyAddBtn").addEventListener("click", () => openEntry());

$("starterList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-starter]");
  if (!btn) return;
  const s = STARTERS[Number(btn.dataset.starter)];
  openEntry({
    statement: s.statement,
    confidence: s.confidence,
    resolveBy: addDays(s.days),
  });
});

/* Entry form */
$("fConfidence").addEventListener("input", updateConfLabel);
$("flipBtn").addEventListener("click", () => {
  const field = $("fStatement");
  if (!field.value.trim()) {
    $("formError").textContent = "Write the statement first, then flip it.";
    $("formError").hidden = false;
    return;
  }
  $("formError").hidden = true;
  field.value = flipStatement(field.value);
  $("fConfidence").value = mirrorConfidence(Number($("fConfidence").value));
  updateConfLabel();
});
$("entryForm").addEventListener("submit", (e) => {
  e.preventDefault();
  saveEntry();
});
$("cancelEntryBtn").addEventListener("click", closeEntry);
$("sheetBackdrop").addEventListener("click", closeEntry);

/* Card interactions (due queue, open list, history) */
function cardListHandler(e) {
  const card = e.target.closest(".pred-card");
  if (!card) return;

  const resolveBtn = e.target.closest("[data-resolve]");
  if (resolveBtn) {
    const note = card.querySelector(".resolve-note");
    resolvePrediction(card.dataset.id, resolveBtn.dataset.resolve, note ? note.value : "");
    return;
  }
  const noteToggle = e.target.closest("[data-note-toggle]");
  if (noteToggle) {
    const note = card.querySelector(".resolve-note");
    note.hidden = !note.hidden;
    if (!note.hidden) note.focus();
    return;
  }
  if (e.target.closest("[data-stop]")) return;
  openDetail(card.dataset.id);
}
$("dueList").addEventListener("click", cardListHandler);
$("openList").addEventListener("click", cardListHandler);
$("historyList").addEventListener("click", cardListHandler);

/* Keyboard activation for cards */
function cardKeyHandler(e) {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest(".pred-card");
  if (!card || e.target !== card) return;
  e.preventDefault();
  openDetail(card.dataset.id);
}
$("dueList").addEventListener("keydown", cardKeyHandler);
$("openList").addEventListener("keydown", cardKeyHandler);
$("historyList").addEventListener("keydown", cardKeyHandler);

/* Detail modal */
$("detailBackdrop").addEventListener("click", closeDetail);
$("detailBody").addEventListener("click", (e) => {
  const id = $("detailBody").dataset.id;

  if (e.target.closest("[data-close-detail]")) {
    closeDetail();
    return;
  }
  const resolveBtn = e.target.closest("[data-resolve]");
  if (resolveBtn) {
    const note = $("detailResolveNote");
    closeDetail();
    resolvePrediction(id, resolveBtn.dataset.resolve, note ? note.value : "");
    return;
  }
  const delBtn = e.target.closest("[data-delete]");
  if (delBtn) {
    if (delBtn.dataset.armed) {
      data.predictions = data.predictions.filter((p) => p.id !== id);
      persist();
      closeDetail();
      toast("Prediction deleted");
      render();
    } else {
      delBtn.dataset.armed = "1";
      delBtn.textContent = "Really delete? This cannot be undone.";
    }
  }
});

/* History filter */
document.querySelector("#view-history .filter-row").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  historyFilter = chip.dataset.filter;
  for (const c of document.querySelectorAll("#view-history .filter-row .chip")) {
    c.classList.toggle("selected", c === chip);
  }
  renderHistory();
});

/* Category filter */
$("categoryFilter").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-category]");
  if (!chip) return;
  categoryFilter = chip.dataset.category;
  render();
});

/* Export / import */
$("exportBtn").addEventListener("click", () => {
  exportLedger(data);
  renderBackupNudge();
  toast("Ledger exported");
});
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) handleImportFile(file);
});
$("importCancelBtn").addEventListener("click", closeImport);
$("importBackdrop").addEventListener("click", closeImport);
$("importMergeBtn").addEventListener("click", () => {
  const added = mergeLedgers(data, pendingImport);
  persist();
  closeImport();
  toast(added === 1 ? "Merged. 1 prediction added." : "Merged. " + added + " predictions added.");
  render();
});
$("importReplaceBtn").addEventListener("click", () => {
  data = pendingImport;
  persist();
  closeImport();
  toast("Ledger replaced from file");
  render();
});

/* Escape closes any open layer */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("entrySheet").hidden) closeEntry();
  else if (!$("detailModal").hidden) closeDetail();
  else if (!$("importModal").hidden) closeImport();
});

/* ---------- Boot ---------- */

render();
