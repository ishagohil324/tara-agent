import express from "express";
import * as dotenv from "dotenv";
import { taraAgent } from "./mastra/agents/tara";
import { logRun, generateRequestId } from "./logger";

dotenv.config();

const app = express();
app.use(express.json());

// ── POST /ask ─────────────────────────────────────────────────────────────────

app.post("/ask", async (req, res) => {
  const requestId = generateRequestId();
  const start = Date.now();

  const { question } = req.body ?? {};

  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "Request body must include a non-empty 'question' field." });
  }

  const toolsCalled: string[] = [];
  const toolInputs: any[] = [];

  try {
    // Run Tara — stream the full response
    const response = await taraAgent.generate(question.trim(), {
      onStepFinish: (step: any) => {
        // Capture tool calls for observability (no API keys in inputs)
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            toolsCalled.push(tc.toolName);
            // Sanitize — never log sensitive values
            const sanitized = { ...tc.args };
            delete sanitized.api_key;
            delete sanitized.token;
            toolInputs.push({ tool: tc.toolName, input: sanitized });
          }
        }
      },
    });

    const answer = response.text ?? "I was unable to generate an answer.";
    const latency = Date.now() - start;

    // Infer which tables were read from tool names
    const tablesRead: string[] = [];
    if (toolsCalled.includes("query_transactions")) tablesRead.push("transactions");
    if (toolsCalled.includes("query_portfolio")) tablesRead.push("funds", "fund_nav", "holdings");

    logRun({
      request_id: requestId,
      question: question.trim(),
      tools_called: toolsCalled,
      tool_inputs: toolInputs,
      tables_read: tablesRead,
      latency_ms: latency,
      status: "success",
      answer_preview: answer.slice(0, 120),
    });

    return res.json({ answer });
  } catch (err: any) {
    const latency = Date.now() - start;

    logRun({
      request_id: requestId,
      question: question.trim(),
      tools_called: toolsCalled,
      tool_inputs: toolInputs,
      tables_read: [],
      latency_ms: latency,
      status: "failure",
      error: err?.message ?? String(err),
    });

    console.error("Agent error:", err);
    return res.status(500).json({
      error: "Something went wrong while processing your question. Please try again.",
    });
  }
});

// ── health check ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", agent: "Tara", version: "1.0.0" });
});

// ── start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`\n🌟 Tara is live at http://localhost:${PORT}`);
  console.log(`   POST /ask  → { "question": "..." }`);
  console.log(`   GET  /health → status check\n`);
});

export default app;
