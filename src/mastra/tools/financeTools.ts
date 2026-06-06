import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../db";

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 1 — query_transactions
// One expressive tool that handles all spending questions:
// filters by category, merchant, date range, and can aggregate.
// ─────────────────────────────────────────────────────────────────────────────

export const queryTransactions = createTool({
  id: "query_transactions",
  description: `Query and aggregate the user's transactions.
Use this for any spending question: totals, top merchants, category comparison,
month-over-month, recurring subscriptions, refund handling, transfer exclusion.
All filters are optional — combine them as needed.`,

  inputSchema: z.object({
    // ── filters ──────────────────────────────────────────────────────────────
    category: z
      .string()
      .optional()
      .describe("Filter by category name (case-insensitive partial match)"),
    merchant: z
      .string()
      .optional()
      .describe("Filter by merchant name (matches canonical name, case-insensitive)"),
    date_from: z
      .string()
      .optional()
      .describe("Start date inclusive, ISO format YYYY-MM-DD"),
    date_to: z
      .string()
      .optional()
      .describe("End date inclusive, ISO format YYYY-MM-DD"),
    exclude_transfers: z
      .boolean()
      .optional()
      .default(true)
      .describe("Exclude self-transfers from results (default true)"),
    include_refunds: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include refunds (negative amounts reduce totals, default true)"),

    // ── aggregation ───────────────────────────────────────────────────────────
    aggregate: z
      .enum(["none", "total", "by_month", "by_category", "by_merchant", "top_merchants"])
      .optional()
      .default("none")
      .describe("How to aggregate results"),
    top_n: z
      .number()
      .optional()
      .default(5)
      .describe("For top_merchants: how many to return"),

    // ── recurring detection ───────────────────────────────────────────────────
    find_recurring: z
      .boolean()
      .optional()
      .default(false)
      .describe("Return merchants that appear on a regular monthly cadence (subscriptions)"),
  }),

  execute: async ({ context }) => {
    const {
      category,
      merchant,
      date_from,
      date_to,
      exclude_transfers = true,
      include_refunds = true,
      aggregate = "none",
      top_n = 5,
      find_recurring = false,
    } = context;

    // ── build WHERE clauses ───────────────────────────────────────────────────
    const conditions: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (exclude_transfers) {
      conditions.push(`is_transfer = FALSE`);
    }

    if (!include_refunds) {
      conditions.push(`is_refund = FALSE`);
    }

    if (category) {
      conditions.push(`LOWER(category) LIKE LOWER($${p++})`);
      params.push(`%${category}%`);
    }

    if (merchant) {
      conditions.push(
        `(LOWER(merchant_canonical) LIKE LOWER($${p++}) OR LOWER(merchant) LIKE LOWER($${p++}))`
      );
      params.push(`%${merchant}%`, `%${merchant}%`);
    }

    if (date_from) {
      conditions.push(`date >= $${p++}`);
      params.push(date_from);
    }

    if (date_to) {
      conditions.push(`date <= $${p++}`);
      params.push(date_to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // ── recurring subscriptions ───────────────────────────────────────────────
    if (find_recurring) {
      const sql = `
        SELECT
          merchant_canonical AS merchant,
          COUNT(DISTINCT DATE_TRUNC('month', date)) AS months_active,
          COUNT(*) AS total_txns,
          ROUND(AVG(amount)::numeric, 2) AS avg_amount,
          ROUND(SUM(amount)::numeric, 2) AS total_spent
        FROM transactions
        WHERE is_transfer = FALSE
          AND amount > 0
        GROUP BY merchant_canonical
        HAVING COUNT(DISTINCT DATE_TRUNC('month', date)) >= 3
           AND STDDEV(amount) < AVG(amount) * 0.2
        ORDER BY months_active DESC, total_spent DESC
        LIMIT 20
      `;
      const result = await db.query(sql);
      return {
        type: "recurring_subscriptions",
        count: result.rows.length,
        subscriptions: result.rows,
      };
    }

    // ── aggregate: total ─────────────────────────────────────────────────────
    if (aggregate === "total") {
      const sql = `
        SELECT
          ROUND(SUM(amount)::numeric, 2)           AS net_total,
          ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)::numeric, 2) AS gross_spend,
          ROUND(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)::numeric, 2) AS total_refunds,
          COUNT(*) AS transaction_count
        FROM transactions ${where}
      `;
      const result = await db.query(sql, params);
      return { type: "total", ...result.rows[0] };
    }

    // ── aggregate: by_month ───────────────────────────────────────────────────
    if (aggregate === "by_month") {
      const sql = `
        SELECT
          TO_CHAR(DATE_TRUNC('month', date), 'YYYY-MM') AS month,
          ROUND(SUM(amount)::numeric, 2)                AS net_total,
          ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)::numeric, 2) AS gross_spend,
          COUNT(*) AS transaction_count
        FROM transactions ${where}
        GROUP BY DATE_TRUNC('month', date)
        ORDER BY DATE_TRUNC('month', date)
      `;
      const result = await db.query(sql, params);
      return { type: "by_month", rows: result.rows };
    }

    // ── aggregate: by_category ────────────────────────────────────────────────
    if (aggregate === "by_category") {
      const sql = `
        SELECT
          category,
          ROUND(SUM(amount)::numeric, 2) AS net_total,
          ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)::numeric, 2) AS gross_spend,
          COUNT(*) AS transaction_count
        FROM transactions ${where}
        GROUP BY category
        ORDER BY gross_spend DESC
      `;
      const result = await db.query(sql, params);
      return { type: "by_category", rows: result.rows };
    }

    // ── aggregate: by_merchant ────────────────────────────────────────────────
    if (aggregate === "by_merchant") {
      const sql = `
        SELECT
          merchant_canonical AS merchant,
          ROUND(SUM(amount)::numeric, 2) AS net_total,
          COUNT(*) AS transaction_count
        FROM transactions ${where}
        GROUP BY merchant_canonical
        ORDER BY net_total DESC
      `;
      const result = await db.query(sql, params);
      return { type: "by_merchant", rows: result.rows };
    }

    // ── aggregate: top_merchants ──────────────────────────────────────────────
    if (aggregate === "top_merchants") {
      const sql = `
        SELECT
          merchant_canonical AS merchant,
          ROUND(SUM(amount)::numeric, 2) AS net_total,
          COUNT(*) AS transaction_count
        FROM transactions ${where}
        GROUP BY merchant_canonical
        ORDER BY SUM(amount) DESC
        LIMIT $${p++}
      `;
      params.push(top_n);
      const result = await db.query(sql, params);
      return { type: "top_merchants", rows: result.rows };
    }

    // ── no aggregate: return raw rows (capped at 200) ─────────────────────────
    const sql = `
      SELECT id, date, merchant, merchant_canonical, category, amount, currency, memo,
             is_transfer, is_refund
      FROM transactions ${where}
      ORDER BY date DESC
      LIMIT 200
    `;
    const result = await db.query(sql, params);
    return {
      type: "rows",
      count: result.rows.length,
      rows: result.rows,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 2 — query_portfolio
// Handles all fund and holding questions:
// fund period returns, holding realised returns, portfolio value.
// ─────────────────────────────────────────────────────────────────────────────

export const queryPortfolio = createTool({
  id: "query_portfolio",
  description: `Query mutual fund NAV data and the user's holdings.
Use this for: fund period returns, holding realised returns, portfolio value,
fund rankings, best/worst performers.`,

  inputSchema: z.object({
    query_type: z
      .enum([
        "portfolio_summary",   // total portfolio value + overall gain
        "holding_returns",     // realised return per holding (or one specific)
        "fund_period_return",  // a specific fund's NAV change between two dates
        "fund_ranking",        // rank all funds by period return
        "latest_nav",          // latest NAV for a fund
      ])
      .describe("What kind of fund/portfolio data to retrieve"),

    fund_id: z
      .string()
      .optional()
      .describe("Fund ID for fund-specific queries"),
    fund_name: z
      .string()
      .optional()
      .describe("Fund name (partial match) — used when fund_id is unknown"),

    date_from: z
      .string()
      .optional()
      .describe("Period start date YYYY-MM-DD (for period_return / fund_ranking)"),
    date_to: z
      .string()
      .optional()
      .describe("Period end date YYYY-MM-DD (for period_return / fund_ranking)"),
  }),

  execute: async ({ context }) => {
    const { query_type, fund_id, fund_name, date_from, date_to } = context;

    // helper: find closest NAV on or before a given date
    async function navOnOrBefore(fid: string, date: string): Promise<number | null> {
      const res = await db.query(
        `SELECT nav FROM fund_nav
         WHERE fund_id = $1 AND nav_date <= $2
         ORDER BY nav_date DESC LIMIT 1`,
        [fid, date]
      );
      return res.rows[0]?.nav ?? null;
    }

    // helper: latest available NAV for a fund
    async function latestNav(fid: string): Promise<{ nav: number; nav_date: string } | null> {
      const res = await db.query(
        `SELECT nav, nav_date FROM fund_nav
         WHERE fund_id = $1
         ORDER BY nav_date DESC LIMIT 1`,
        [fid]
      );
      return res.rows[0] ?? null;
    }

    // helper: resolve fund_id from partial name
    async function resolveFundId(name: string): Promise<string | null> {
      const res = await db.query(
        `SELECT id FROM funds WHERE LOWER(name) LIKE LOWER($1) LIMIT 1`,
        [`%${name}%`]
      );
      return res.rows[0]?.id ?? null;
    }

    // ── latest NAV ────────────────────────────────────────────────────────────
    if (query_type === "latest_nav") {
      const fid = fund_id ?? (fund_name ? await resolveFundId(fund_name) : null);
      if (!fid) return { error: "Fund not found. Please check the fund name or ID." };
      const nav = await latestNav(fid);
      if (!nav) return { error: `No NAV data found for fund ${fid}` };
      const fundRes = await db.query("SELECT name FROM funds WHERE id = $1", [fid]);
      return {
        type: "latest_nav",
        fund_id: fid,
        fund_name: fundRes.rows[0]?.name,
        nav: nav.nav,
        nav_date: nav.nav_date,
      };
    }

    // ── fund period return ────────────────────────────────────────────────────
    if (query_type === "fund_period_return") {
      const fid = fund_id ?? (fund_name ? await resolveFundId(fund_name) : null);
      if (!fid) return { error: "Fund not found." };
      if (!date_from || !date_to) return { error: "date_from and date_to are required." };

      const navStart = await navOnOrBefore(fid, date_from);
      const navEnd = await navOnOrBefore(fid, date_to);

      if (!navStart || !navEnd) {
        return { error: `Insufficient NAV data for this date range.` };
      }

      const periodReturnPct = ((navEnd - navStart) / navStart) * 100;
      const fundRes = await db.query("SELECT name FROM funds WHERE id = $1", [fid]);

      return {
        type: "fund_period_return",
        fund_id: fid,
        fund_name: fundRes.rows[0]?.name,
        date_from,
        date_to,
        nav_start: Number(navStart),
        nav_end: Number(navEnd),
        period_return_pct: Math.round(periodReturnPct * 100) / 100,
      };
    }

    // ── fund ranking ──────────────────────────────────────────────────────────
    if (query_type === "fund_ranking") {
      if (!date_from || !date_to) return { error: "date_from and date_to are required." };

      const fundsRes = await db.query("SELECT id, name, category FROM funds");
      const results = [];

      for (const fund of fundsRes.rows) {
        const navStart = await navOnOrBefore(fund.id, date_from);
        const navEnd = await navOnOrBefore(fund.id, date_to);
        if (!navStart || !navEnd) continue;

        const returnPct = ((navEnd - navStart) / navStart) * 100;
        results.push({
          fund_id: fund.id,
          fund_name: fund.name,
          category: fund.category,
          nav_start: Number(navStart),
          nav_end: Number(navEnd),
          period_return_pct: Math.round(returnPct * 100) / 100,
        });
      }

      results.sort((a, b) => b.period_return_pct - a.period_return_pct);
      const spread =
        results.length >= 2
          ? Math.round((results[0].period_return_pct - results[results.length - 1].period_return_pct) * 100) / 100
          : 0;

      return {
        type: "fund_ranking",
        date_from,
        date_to,
        ranked_funds: results,
        best: results[0],
        worst: results[results.length - 1],
        spread_pct: spread,
      };
    }

    // ── holding returns ───────────────────────────────────────────────────────
    if (query_type === "holding_returns") {
      let holdingsQuery = "SELECT * FROM holdings";
      const holdingParams: any[] = [];

      if (fund_id) {
        holdingsQuery += " WHERE fund_id = $1";
        holdingParams.push(fund_id);
      } else if (fund_name) {
        holdingsQuery += " WHERE LOWER(fund_name) LIKE LOWER($1)";
        holdingParams.push(`%${fund_name}%`);
      }

      const holdingsRes = await db.query(holdingsQuery, holdingParams);
      if (holdingsRes.rows.length === 0) {
        return { error: "No holdings found matching that fund." };
      }

      const results = [];
      for (const h of holdingsRes.rows) {
        const latest = await latestNav(h.fund_id);
        if (!latest) continue;

        const currentValue = Number(h.units) * Number(latest.nav);
        const purchaseCost = Number(h.units) * Number(h.purchase_nav);
        const absoluteGain = currentValue - purchaseCost;
        const realisedReturnPct = (absoluteGain / purchaseCost) * 100;

        // Also compute same-window period return for comparison
        const navAtPurchase = await navOnOrBefore(h.fund_id, h.purchase_date);
        const fundPeriodReturnPct =
          navAtPurchase && latest.nav
            ? ((Number(latest.nav) - Number(navAtPurchase)) / Number(navAtPurchase)) * 100
            : null;

        results.push({
          fund_id: h.fund_id,
          fund_name: h.fund_name,
          units: Number(h.units),
          purchase_date: h.purchase_date,
          purchase_nav: Number(h.purchase_nav),
          current_nav: Number(latest.nav),
          current_nav_date: latest.nav_date,
          purchase_cost_inr: Math.round(purchaseCost * 100) / 100,
          current_value_inr: Math.round(currentValue * 100) / 100,
          absolute_gain_inr: Math.round(absoluteGain * 100) / 100,
          realised_return_pct: Math.round(realisedReturnPct * 100) / 100,
          fund_period_return_pct: fundPeriodReturnPct
            ? Math.round(fundPeriodReturnPct * 100) / 100
            : null,
        });
      }

      results.sort((a, b) => b.realised_return_pct - a.realised_return_pct);
      return { type: "holding_returns", holdings: results };
    }

    // ── portfolio summary ─────────────────────────────────────────────────────
    if (query_type === "portfolio_summary") {
      const holdingsRes = await db.query("SELECT * FROM holdings");
      if (holdingsRes.rows.length === 0) {
        return { error: "No holdings found in the database." };
      }

      let totalCurrentValue = 0;
      let totalPurchaseCost = 0;
      const breakdown = [];

      for (const h of holdingsRes.rows) {
        const latest = await latestNav(h.fund_id);
        if (!latest) continue;

        const currentValue = Number(h.units) * Number(latest.nav);
        const purchaseCost = Number(h.units) * Number(h.purchase_nav);
        totalCurrentValue += currentValue;
        totalPurchaseCost += purchaseCost;

        breakdown.push({
          fund_name: h.fund_name,
          current_value_inr: Math.round(currentValue * 100) / 100,
          purchase_cost_inr: Math.round(purchaseCost * 100) / 100,
          gain_inr: Math.round((currentValue - purchaseCost) * 100) / 100,
        });
      }

      const totalGain = totalCurrentValue - totalPurchaseCost;
      const overallReturnPct = (totalGain / totalPurchaseCost) * 100;

      return {
        type: "portfolio_summary",
        total_current_value_inr: Math.round(totalCurrentValue * 100) / 100,
        total_purchase_cost_inr: Math.round(totalPurchaseCost * 100) / 100,
        total_gain_inr: Math.round(totalGain * 100) / 100,
        overall_return_pct: Math.round(overallReturnPct * 100) / 100,
        breakdown,
      };
    }

    return { error: `Unknown query_type: ${query_type}` };
  },
});

