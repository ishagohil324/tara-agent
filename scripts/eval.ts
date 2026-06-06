import * as dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.EVAL_URL ?? "http://localhost:3000";

interface EvalCase {
  id: string;
  question: string;
  check: (answer: string) => boolean;
  description: string;
}

const cases: EvalCase[] = [
  // ── Single lookup ─────────────────────────────────────────────────────────
  {
    id: "E01",
    question: "How much did I spend on food in March 2025 after refunds?",
    check: (a) => /₹|inr|march|food/i.test(a) && /\d+\.\d{2}/.test(a),
    description: "Food spend March 2025 with refunds applied",
  },
  {
    id: "E02",
    question: "What was my single biggest expense?",
    check: (a) => /₹|inr|\d+\.\d{2}/.test(a),
    description: "Single biggest transaction",
  },

  // ── Date filtering ────────────────────────────────────────────────────────
  {
    id: "E03",
    question: "What was my total actual spending in Q1 2025? Ignore transfers.",
    check: (a) => /₹|inr|\d+\.\d{2}/.test(a) && !/transfer/i.test(a.toLowerCase().slice(0, 40)),
    description: "Q1 2025 spend excluding transfers",
  },
  {
    id: "E04",
    question: "Did my food spending increase from February to March 2025?",
    check: (a) => /(increas|decreas|higher|lower|same|february|march)/i.test(a),
    description: "Food spend month-over-month comparison",
  },

  // ── Refunds ───────────────────────────────────────────────────────────────
  {
    id: "E05",
    question: "How much did I spend on food in January 2025 before and after refunds?",
    check: (a) => /refund|net|gross/i.test(a) && /\d+\.\d{2}/.test(a),
    description: "Shows gross vs net spend with refunds",
  },

  // ── Merchant aliases ──────────────────────────────────────────────────────
  {
    id: "E06",
    question: "How much did I spend on Swiggy in total including all Swiggy variants?",
    check: (a) => /₹|inr|\d+/.test(a),
    description: "Merchant alias grouping for Swiggy",
  },

  // ── Transfers ─────────────────────────────────────────────────────────────
  {
    id: "E07",
    question: "Ignore transfers. What were my top 5 merchants by net spend between January and March 2025?",
    check: (a) => {
      const lines = a.split("\n").filter(l => /\d/.test(l));
      return lines.length >= 3;
    },
    description: "Top 5 merchants, transfers excluded",
  },

  // ── Category comparison ───────────────────────────────────────────────────
  {
    id: "E08",
    question: "Compare my food and travel spending month by month. Which grew faster?",
    check: (a) => /(food|travel)/i.test(a) && /(faster|grew|increas|month)/i.test(a),
    description: "Food vs travel month-over-month growth comparison",
  },
  {
    id: "E09",
    question: "Which category had the biggest increase from February to March 2025?",
    check: (a) => /category|increas|\d+/.test(a),
    description: "Category with biggest MoM increase",
  },

  // ── Recurring subscriptions ───────────────────────────────────────────────
  {
    id: "E10",
    question: "Which transactions look like recurring subscriptions?",
    check: (a) => /subscri|recurring|monthly|regular/i.test(a) || /\d+/.test(a),
    description: "Recurring subscription detection",
  },

  // ── No-data case ──────────────────────────────────────────────────────────
  {
    id: "E11",
    question: "Do I have any data for rent in April 2025?",
    check: (a) => /(no data|not found|don't have|no transactions|april 2025)/i.test(a),
    description: "Honest no-data response for future date",
  },

  // ── Fund period return ────────────────────────────────────────────────────
  {
    id: "E12",
    question: "Rank all my funds by their one-year return between 2024-01-01 and 2025-01-01, and show the spread.",
    check: (a) => /spread|%|\d+\.\d{2}/.test(a) && /(best|worst|top|rank)/i.test(a),
    description: "Fund ranking with spread between best and worst",
  },

  // ── Holding realised return ───────────────────────────────────────────────
  {
    id: "E13",
    question: "What is my realised return on each of my holdings?",
    check: (a) => /%|\d+\.\d{2}/.test(a) && /(return|gain|profit|loss)/i.test(a),
    description: "Realised return per holding",
  },

  // ── Portfolio summary ─────────────────────────────────────────────────────
  {
    id: "E14",
    question: "What is my portfolio worth today, and how much have I made on it in absolute INR?",
    check: (a) => /₹|inr|\d+\.\d{2}/.test(a) && /(worth|value|gain|made)/i.test(a),
    description: "Total portfolio value and absolute gain",
  },

  // ── Mixed fund vs holding ─────────────────────────────────────────────────
  {
    id: "E15",
    question: "Of the funds I own, which gave me the best realised return, and how does it compare to the same fund's period return over the same window?",
    check: (a) =>
      /(realised|realised return|holding)/i.test(a) &&
      /(period return|fund return|nav)/i.test(a),
    description: "Best holding return vs fund period return comparison",
  },
];

// ── runner ────────────────────────────────────────────────────────────────────

async function ask(question: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { answer?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return data.answer ?? "";
}

async function runEvals() {
  console.log(`\n🧪 Tara Eval Suite — ${cases.length} questions\n`);
  console.log(`   Target: ${BASE_URL}\n`);
  console.log("─".repeat(60));

  let passed = 0;
  let failed = 0;
  const failures: { id: string; question: string; answer: string }[] = [];

  for (const c of cases) {
    process.stdout.write(`  [${c.id}] ${c.description}… `);

    try {
      const answer = await ask(c.question);
      const ok = c.check(answer);

      if (ok) {
        console.log("✅ PASS");
        passed++;
      } else {
        console.log("❌ FAIL");
        failed++;
        failures.push({ id: c.id, question: c.question, answer });
      }
    } catch (err: any) {
      console.log(`❌ ERROR: ${err.message}`);
      failed++;
      failures.push({ id: c.id, question: c.question, answer: `ERROR: ${err.message}` });
    }

    // Small delay between calls to be kind to rate limits
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log("\n" + "─".repeat(60));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${cases.length}\n`);

  if (failures.length > 0) {
    console.log("❌ Failed cases:\n");
    for (const f of failures) {
      console.log(`  [${f.id}] ${f.question}`);
      console.log(`  Answer: ${f.answer.slice(0, 200)}\n`);
    }
  } else {
    console.log("🎉 All tests passed!\n");
  }

  process.exit(failed > 0 ? 1 : 0);
}

runEvals();
