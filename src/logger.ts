import * as fs from "fs";
import * as path from "path";

const LOG_FILE = path.join(process.cwd(), "logs", "tara.log");

// Make sure logs directory exists
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

export interface RunLog {
  request_id: string;
  question: string;
  tools_called: string[];
  tool_inputs: any[];
  tables_read: string[];
  latency_ms: number;
  status: "success" | "failure";
  error?: string;
  answer_preview?: string;
}

export function logRun(entry: RunLog) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  fs.appendFileSync(LOG_FILE, line + "\n");

  // Also print a clean summary to console
  const icon = entry.status === "success" ? "✅" : "❌";
  console.log(
    `${icon} [${entry.request_id}] ${entry.latency_ms}ms | tools: ${entry.tools_called.join(", ") || "none"} | ${entry.status}`
  );
  if (entry.error) console.error(`   Error: ${entry.error}`);
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
