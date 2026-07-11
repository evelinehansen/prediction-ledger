# Prediction Ledger

A static, local-first web tool for logging small predictions about your own life ("I'll finish the report by Friday") together with a confidence percentage and a resolve-by date. When the date arrives, the tool asks what actually happened. Over time it draws your personal calibration curve: when you say 80 percent, how often are you actually right?

Sibling project to DecisionBuilder, sharing its design system.

## Privacy

- No backend, no accounts, no cookies, no analytics, no AI.
- Zero external network requests at runtime.
- All data stays in your browser (localStorage), with one-tap JSON export and import for backup.

Browsers can evict localStorage after long disuse (Safari after about 7 days), so export regularly. The header shows how long ago your last backup was.

## Running it

It is plain HTML, CSS, and JavaScript with no build step. Because the scripts are ES modules, open it through any static server rather than the file system, for example:

```
python3 -m http.server
```

then visit `http://localhost:8000`. Or use the GitHub Pages deployment.

## Files

| File | Role |
|---|---|
| `index.html` | markup for all three views (ledger, calibration, history) |
| `styles.css` | design tokens and styling, shared identity with DecisionBuilder |
| `engine.js` | pure scoring functions: buckets, hit rates, Brier, headline copy |
| `storage.js` | localStorage persistence, export, import validation |
| `app.js` | UI wiring and rendering |

## How calibration works

Resolved predictions are grouped into confidence buckets (50 to 59, 60 to 69, 70 to 79, 80 to 89, 90 to 99). A bucket only renders once it holds 5 resolved predictions; until then it shows as a locked slot. Void resolutions (question turned out unjudgeable) are excluded from all statistics. All statistics are derived from the prediction list on the fly and never stored.

A category filter appears above all three views once at least one prediction has a category. It narrows the ledger, the calibration statistics, and the history to that category; the same minimum-data rule applies, so a category's calibration only unlocks bucket by bucket as it earns 5 resolved predictions in a range.
