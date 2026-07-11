/*
 * engine.js — pure scoring and calibration functions.
 * No DOM, no storage, no side effects. Everything here is derived
 * from the predictions array; nothing is ever stored.
 */

export const MIN_BUCKET_SIZE = 5;

export const BUCKETS = [
  { key: "50s", min: 50, max: 59, label: "50 to 59" },
  { key: "60s", min: 60, max: 69, label: "60 to 69" },
  { key: "70s", min: 70, max: 79, label: "70 to 79" },
  { key: "80s", min: 80, max: 89, label: "80 to 89" },
  { key: "90s", min: 90, max: 99, label: "90 to 99" },
];

export function bucketFor(confidence) {
  return BUCKETS.find((b) => confidence >= b.min && confidence <= b.max) || null;
}

/* Resolved predictions that count for statistics (voids excluded). */
export function scorable(predictions) {
  return predictions.filter(
    (p) => p.resolution && p.resolution.outcome !== "void"
  );
}

export function openPredictions(predictions) {
  return predictions.filter((p) => !p.resolution);
}

export function resolvedPredictions(predictions) {
  return predictions.filter((p) => p.resolution);
}

/*
 * Per-bucket calibration stats.
 * Returns one entry per bucket:
 * { key, label, min, max, count, hits, avgConfidence, hitRate, unlocked, gap }
 * hitRate and avgConfidence are percentages (0 to 100), null while locked.
 * gap = hitRate - avgConfidence (negative means overconfident).
 */
export function computeBuckets(predictions) {
  const pool = scorable(predictions);
  return BUCKETS.map((b) => {
    const inBucket = pool.filter(
      (p) => p.confidence >= b.min && p.confidence <= b.max
    );
    const count = inBucket.length;
    const hits = inBucket.filter(
      (p) => p.resolution.outcome === "happened"
    ).length;
    const unlocked = count >= MIN_BUCKET_SIZE;
    const avgConfidence = unlocked
      ? inBucket.reduce((s, p) => s + p.confidence, 0) / count
      : null;
    const hitRate = unlocked ? (hits / count) * 100 : null;
    return {
      ...b,
      count,
      hits,
      avgConfidence,
      hitRate,
      unlocked,
      gap: unlocked ? hitRate - avgConfidence : null,
    };
  });
}

/* Overall counters for the calibration view. */
export function overallStats(predictions) {
  const open = openPredictions(predictions).length;
  const resolved = resolvedPredictions(predictions).length;
  const pool = scorable(predictions);
  const hits = pool.filter((p) => p.resolution.outcome === "happened").length;
  const voids = predictions.filter(
    (p) => p.resolution && p.resolution.outcome === "void"
  ).length;
  return {
    open,
    resolved,
    voids,
    scorableCount: pool.length,
    hits,
    hitRate: pool.length ? (hits / pool.length) * 100 : null,
  };
}

/*
 * Brier score over scorable predictions (0 is perfect, 0.25 is coin flipping).
 * Computed from day one, surfaced in Phase 2. Returns null with no data.
 */
export function brierScore(predictions) {
  const pool = scorable(predictions);
  if (!pool.length) return null;
  const sum = pool.reduce((s, p) => {
    const forecast = p.confidence / 100;
    const outcome = p.resolution.outcome === "happened" ? 1 : 0;
    return s + (forecast - outcome) ** 2;
  }, 0);
  return sum / pool.length;
}

/*
 * The single headline accuracy line, in plain words.
 * Picks the unlocked bucket with the largest calibration gap
 * (most data breaks ties). Tone: "clay" for overconfident,
 * "sage" for well calibrated or underconfident, null when locked.
 */
export function headline(bucketStats) {
  const unlocked = bucketStats.filter((b) => b.unlocked);
  if (!unlocked.length) {
    const total = bucketStats.reduce((s, b) => s + b.count, 0);
    return {
      text:
        total === 0
          ? "Your calibration curve appears here once you have resolved enough predictions."
          : "Keep resolving. Each confidence range unlocks at " +
            MIN_BUCKET_SIZE +
            " resolved predictions.",
      tone: null,
      bucket: null,
    };
  }
  const pick = [...unlocked].sort(
    (a, b) => Math.abs(b.gap) - Math.abs(a.gap) || b.count - a.count
  )[0];
  const said = pick.label;
  const actual = Math.round(pick.hitRate);
  let text =
    "When you say " + said + " percent, you're right " + actual +
    " percent of the time.";
  let tone = "sage";
  if (pick.gap <= -10) {
    text += " You may be overconfident in this range.";
    tone = "clay";
  } else if (pick.gap >= 10) {
    text += " You may be underconfident in this range.";
  } else {
    text += " That is well calibrated.";
  }
  return { text, tone, bucket: pick.key };
}

/*
 * Flip a statement to its negation (or back). Best-effort text
 * transform; the user can always adjust the wording afterwards.
 */
export function flipStatement(text) {
  const t = text.trim();
  const PREFIX = "It will not happen that ";
  if (t.startsWith(PREFIX)) return t.slice(PREFIX.length);

  // Un-negate first, so flipping twice returns the original.
  const unNegate = [
    [/\bwill not\b/i, "will"],
    [/\bwon't\b/i, "will"],
    [/\bis not going to\b/i, "is going to"],
    [/\bisn't going to\b/i, "is going to"],
    [/\bam not going to\b/i, "am going to"],
    [/\bare not going to\b/i, "are going to"],
    [/\baren't going to\b/i, "are going to"],
  ];
  for (const [re, rep] of unNegate) {
    if (re.test(t)) return t.replace(re, rep);
  }

  const negate = [
    [/\bI'll\b/, "I won't"],
    [/\bwill\b/i, "will not"],
    [/\bis going to\b/i, "is not going to"],
    [/\bam going to\b/i, "am not going to"],
    [/\bare going to\b/i, "are not going to"],
  ];
  for (const [re, rep] of negate) {
    if (re.test(t)) return t.replace(re, rep);
  }
  return PREFIX + t;
}

/* Mirror a confidence value across the 50 midpoint (60 becomes 40). */
export function mirrorConfidence(confidence) {
  return Math.min(99, Math.max(1, 100 - confidence));
}
