/*
 * storage.js — persistence, export and import.
 * The ledger lives in localStorage and is autosaved on every change.
 * The last-backup timestamp is stored separately: it is device state,
 * not ledger data, so it never travels inside an export file.
 */

export const SCHEMA_VERSION = 1;

const DATA_KEY = "predictionLedger.data.v1";
const BACKUP_KEY = "predictionLedger.lastBackup";

export function newLedger() {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    created: now,
    modified: now,
    predictions: [],
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return newLedger();
    const data = JSON.parse(raw);
    if (data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.predictions)) {
      return newLedger();
    }
    return data;
  } catch {
    return newLedger();
  }
}

export function save(data) {
  data.modified = new Date().toISOString();
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
  );
}

/* ---- Backup age ---- */

export function markBackedUp() {
  try {
    localStorage.setItem(BACKUP_KEY, new Date().toISOString());
  } catch {
    /* nudge will simply keep showing */
  }
}

/* Returns null (never backed up) or whole days since last export. */
export function daysSinceBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const then = new Date(raw).getTime();
    if (Number.isNaN(then)) return null;
    return Math.max(0, Math.floor((Date.now() - then) / 86400000));
  } catch {
    return null;
  }
}

/* ---- Export ---- */

export function exportLedger(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = "prediction-ledger-" + stamp + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  markBackedUp();
}

/* ---- Import ---- */

const OUTCOMES = new Set(["happened", "didnt", "void"]);

/*
 * Parse and validate an import file's text.
 * Returns { ok: true, data } or { ok: false, error } with a
 * plain-language error message.
 */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, error: "That file does not look like a ledger export." };
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        "This file uses schema version " + String(data.schemaVersion) +
        ", but this app expects version " + SCHEMA_VERSION + ".",
    };
  }
  if (!Array.isArray(data.predictions)) {
    return { ok: false, error: "That file has no predictions list." };
  }
  for (const p of data.predictions) {
    const valid =
      p && typeof p === "object" &&
      typeof p.id === "string" &&
      typeof p.statement === "string" &&
      Number.isFinite(p.confidence) &&
      typeof p.resolveBy === "string" &&
      (p.resolution === null ||
        (p.resolution &&
          typeof p.resolution === "object" &&
          OUTCOMES.has(p.resolution.outcome)));
    if (!valid) {
      return { ok: false, error: "A prediction in that file is malformed." };
    }
  }
  return { ok: true, data };
}

/* Merge: keep everything current, add imported predictions with new ids. */
export function mergeLedgers(current, imported) {
  const seen = new Set(current.predictions.map((p) => p.id));
  const added = imported.predictions.filter((p) => !seen.has(p.id));
  current.predictions.push(...added);
  return added.length;
}
