import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive a canonical merchant name from raw merchant string + memo.
 * We cluster by shared root tokens so "Swiggy", "SWIGGY*ORDER",
 * "Swiggy Instamart", "SWIGGY BANGALORE" all become "Swiggy".
 * No hardcoded lists — we normalise then take the shortest token cluster.
 */
function canonicalize(merchant: string, memo: string = ""): string {
  // Pull the most meaningful word out of UPI/NEFT memos
  // e.g. "UPI/571548185986/SWIGGY/swiggy@ybl" → "SWIGGY"
  const upiMatch = memo.match(/UPI\/\d+\/([^\/]+)/i);
  const neftMatch = memo.match(/NEFT[- ].*?([A-Z][A-Z0-9 ]+)/i);
  const source = upiMatch?.[1] ?? neftMatch?.[1] ?? merchant;

  return source
    .replace(/[^a-zA-Z0-9 ]/g, " ") // strip punctuation
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")[0]                    // take first meaningful token
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase()); // Title-case
}

function isTransfer(category: string, merchant: string, memo: string): boolean {
  const haystack = `${category} ${merchant} ${memo}`.toLowerCase();
  return (
    category.toLowerCase() === "transfer" ||
    /self.?transfer|own.?account|neft.*self|imps.*self/.test(haystack)
  );
}

function isRefund(amount: number, memo: string): boolean {
  if (amount >= 0) return false;
  const m = memo?.toLowerCase() ?? "";
  return /refund|reversal|cashback|credit|return/.test(m) || amount < 0;
}

// ── schema ───────────────────────────────────────────────────────────────────

async function applySchema(client: any) {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await client.query(sql);
  console.log("✔ Schema applied");
}

// ── ingest transactions ───────────────────────────────────────────────────────

async function ingestTransactions(client: any, dataDir: string) {
  const filePath = path.join(dataDir, "transactions.json");
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ No transactions.json found at ${filePath}`);
    return;
  }

  const rows: any[] = JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(`  Ingesting ${rows.length} transactions…`);

  // Clear existing data for this snapshot reload
  await client.query("DELETE FROM transactions");

  for (const row of rows) {
    const memo = row.memo ?? "";
    const canonical = canonicalize(row.merchant, memo);
    const transfer = isTransfer(row.category, row.merchant, memo);
    const refund = isRefund(Number(row.amount), memo);

    await client.query(
      `INSERT INTO transactions
         (id, date, merchant, category, amount, currency, memo,
          merchant_canonical, is_transfer, is_refund)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         date = EXCLUDED.date,
         merchant = EXCLUDED.merchant,
         category = EXCLUDED.category,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         memo = EXCLUDED.memo,
         merchant_canonical = EXCLUDED.merchant_canonical,
         is_transfer = EXCLUDED.is_transfer,
         is_refund = EXCLUDED.is_refund`,
      [
        row.id,
        row.date,
        row.merchant,
        row.category ?? "uncategorized",
        row.amount,
        row.currency ?? "INR",
        memo,
        canonical,
        transfer,
        refund,
      ]
    );
  }
  console.log("  ✔ Transactions done");
}

// ── ingest funds + NAV ────────────────────────────────────────────────────────

async function ingestFunds(client: any, dataDir: string) {
  const filePath = path.join(dataDir, "funds.json");
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ No funds.json found at ${filePath}`);
    return;
  }

  const funds: any[] = JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(`  Ingesting ${funds.length} funds…`);

  await client.query("DELETE FROM fund_nav");
  await client.query("DELETE FROM funds");

  for (const fund of funds) {
    await client.query(
      `INSERT INTO funds (id, name, category)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category`,
      [fund.id, fund.name, fund.category]
    );

    // NAV history is an array of { date, nav } objects
   const navPoints: { date: string; nav: number }[] = (fund.nav_history ?? fund.nav ?? []).map((p: any) => ({
  date: p.date,
  nav: p.nav ?? p.value,
}));
    for (const point of navPoints) {
      await client.query(
        `INSERT INTO fund_nav (fund_id, nav_date, nav)
         VALUES ($1, $2, $3)
         ON CONFLICT (fund_id, nav_date) DO UPDATE SET nav = EXCLUDED.nav`,
        [fund.id, point.date, point.nav]
      );
    }
  }
  console.log("  ✔ Funds + NAV done");
}

// ── ingest holdings ───────────────────────────────────────────────────────────

async function ingestHoldings(client: any, dataDir: string) {
  const filePath = path.join(dataDir, "holdings.json");
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ No holdings.json found at ${filePath}`);
    return;
  }

  const holdings: any[] = JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(`  Ingesting ${holdings.length} holdings…`);

  await client.query("DELETE FROM holdings");

  for (const h of holdings) {
    const id = h.id ?? `${h.fund_id}-holding`;
    await client.query(
      `INSERT INTO holdings (id, fund_id, fund_name, units, purchase_date, purchase_nav)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         fund_id = EXCLUDED.fund_id,
         fund_name = EXCLUDED.fund_name,
         units = EXCLUDED.units,
         purchase_date = EXCLUDED.purchase_date,
         purchase_nav = EXCLUDED.purchase_nav`,
      [id, h.fund_id, h.fund_name, h.units, h.purchase_date, h.purchase_nav]
    );
  }
  console.log("  ✔ Holdings done");
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) {
    console.error("ERROR: DATA_DIR env var is not set.");
    process.exit(1);
  }

  if (!fs.existsSync(dataDir)) {
    console.error(`ERROR: DATA_DIR path does not exist: ${dataDir}`);
    process.exit(1);
  }

  console.log(`\n🚀 Starting ingest from: ${dataDir}\n`);

  const client = await pool.connect();
  try {
    await applySchema(client);
    await ingestTransactions(client, dataDir);
    await ingestFunds(client, dataDir);
    await ingestHoldings(client, dataDir);
    console.log("\n✅ Ingest complete!\n");
  } catch (err) {
    console.error("Ingest failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
