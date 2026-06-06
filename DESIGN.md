# DESIGN.md — Tara Finance Agent

## 1. Postgres Schema

### Tables

**`transactions`**
Stores all spending/income rows from the JSON snapshots.
- `id` TEXT PK — original transaction ID
- `date` DATE — transaction date
- `merchant` TEXT — raw merchant name as-shipped
- `merchant_canonical` TEXT — normalised merchant name (alias-grouped)
- `category` TEXT — e.g. "food", "travel", "transfer", "uncategorized"
- `amount` NUMERIC(12,2) — negative for refunds/reversals
- `currency` TEXT — default INR
- `memo` TEXT — raw free-text memo (UPI/NEFT refs etc.)
- `is_transfer` BOOLEAN — self-transfers excluded from spend by default
- `is_refund` BOOLEAN — negative entries flagged as refunds

Indexes: `date`, `category`, `merchant_canonical`, `is_transfer`, `amount`

---

**`funds`**
Metadata about each mutual fund.
- `id` TEXT PK
- `name` TEXT
- `category` TEXT

---

**`fund_nav`**
One row per (fund, date) NAV data point.
- `fund_id` TEXT FK → funds.id
- `nav_date` DATE
- `nav` NUMERIC(12,4)
- PK: (fund_id, nav_date)

Index: `(fund_id, nav_date)` — the primary access pattern for period return queries.

---

**`holdings`**
What the user actually owns.
- `id` TEXT PK
- `fund_id` TEXT FK → funds.id
- `fund_name` TEXT
- `units` NUMERIC(14,4)
- `purchase_date` DATE
- `purchase_nav` NUMERIC(12,4)

Index: `fund_id`

---

## 2. Tool Design

Two tools, intentionally broad:

### `query_transactions`
Handles ALL spending questions via parameterised filters + an `aggregate` mode.
- Filters: category, merchant, date_from, date_to, exclude_transfers, include_refunds
- Aggregates: none | total | by_month | by_category | by_merchant | top_merchants
- Special: `find_recurring: true` for subscription detection

**Why one tool?** Fewer tools = lower token cost and better selection accuracy. A single expressive tool with parameters beats four narrow tools in both cost and reliability.

### `query_portfolio`
Handles ALL fund and holding questions via a `query_type` parameter:
- `portfolio_summary` — total portfolio value + overall gain
- `holding_returns` — realised return per holding
- `fund_period_return` — NAV change between two dates for one fund
- `fund_ranking` — all funds ranked by period return
- `latest_nav` — most recent NAV for a fund

---

## 3. Grounding Guarantee

Every number Tara states comes from a tool result. The agent instructions explicitly prohibit prose arithmetic. SQL computes all aggregates, totals, returns, and rankings. The model explains; it does not calculate.

---

## 4. Key Formulas

**Spend (net)**
```
net_spend = SUM(amount) WHERE is_transfer = FALSE
```
Includes refunds (negative amounts reduce the total).

**Gross Spend**
```
gross_spend = SUM(amount) WHERE amount > 0 AND is_transfer = FALSE
```

**Merchant Canonical Matching**
The `canonicalize()` function in `ingest.ts`:
1. Extracts the meaningful token from UPI/NEFT memo patterns
2. Strips punctuation and special characters
3. Takes the first meaningful token and title-cases it
4. No hardcoded merchant lists — works on any snapshot

**Recurring Detection**
A merchant is flagged as recurring if:
- It appears in ≥ 3 distinct calendar months
- `STDDEV(amount) < AVG(amount) * 0.20` (charges are consistent)

**Fund Period Return**
```
period_return_pct = ((nav_end - nav_start) / nav_start) * 100
```
Where `nav_start` = closest NAV on or before `date_from`, `nav_end` = closest NAV on or before `date_to`.

**Holding Realised Return**
```
purchase_cost = units × purchase_nav
current_value = units × current_nav
absolute_gain = current_value - purchase_cost
realised_return_pct = (absolute_gain / purchase_cost) * 100
```
This is **different** from the fund's period return. The agent is instructed to name this distinction explicitly in answers.

---

## 5. Relative Date Handling

All relative dates are resolved server-side by the agent before calling tools:
- "last month" → calendar month before the latest transaction date in the DB
- "this month" → current calendar month
- "Q1 2025" → 2025-01-01 to 2025-03-31

Tools always receive explicit `YYYY-MM-DD` strings, never relative expressions.

---

## 6. Data Complications

| Complication | Handling |
|---|---|
| Refunds | Negative amounts included by default; reduce net spend |
| Self-transfers | `is_transfer = TRUE`; excluded from spend by default |
| Merchant aliases | `canonicalize()` groups by first normalised token |
| Uncategorized rows | Included in all queries; filterable by date/merchant |
| Noisy memos | Treated as untrusted data; never executed or followed as instructions |
| Missing NAV dates | `navOnOrBefore()` finds closest prior date |

---

## 7. Evals

15 questions covering:
- Single lookup (E01, E02)
- Date filtering (E03, E04)
- Refunds (E05)
- Merchant aliases (E06)
- Transfers excluded (E07)
- Category comparison (E08, E09)
- Recurring subscriptions (E10)
- No-data case (E11)
- Fund period return / ranking (E12)
- Holding realised return (E13)
- Portfolio summary (E14)
- Fund vs holding return distinction (E15)

Run with: `npm run eval`

---

## 8. Observability

Each `/ask` request logs to `logs/tara.log` (JSON lines):
- `request_id`, `question`, `tools_called`, `tool_inputs` (sanitized), `tables_read`, `latency_ms`, `status`, `error`

To inspect a failed run:
```bash
cat logs/tara.log | grep '"status":"failure"' | tail -5
```

---

## 9. Async Milestone

Not implemented in this version. All tools run synchronously. Decision rationale: the DB queries are fast (sub-100ms for typical aggregates), and adding a job queue would increase complexity without clear user-facing benefit given the data sizes. With more time and larger datasets, BullMQ + a jobs table in Postgres would be the right path.

---

## 10. Deployment Tradeoffs

- Free-tier Postgres (Neon/Supabase) has connection limits — pool capped at 10 to stay within limits
- Free hosting platforms (Render/Railway) may cold-start after inactivity — first request may be slow
- The ingest script must be run manually after deploying to populate the hosted DB

---

## 11. Known Failure Modes

1. **Ambiguous merchant names** — if a new snapshot has merchants with single-character names, the canonicalize first-token heuristic may group incorrectly
2. **NAV gaps** — if a fund has missing NAV months, period return uses the nearest prior date, which may introduce small error
3. **Non-deterministic tool selection** — on unusual phrasings the model may pick the wrong aggregate mode; the Zod schema validation catches bad inputs but can't fully prevent wrong aggregates
4. **Relative dates near month boundaries** — "last month" resolved at request time; concurrent requests near midnight on month-end could differ by one month
