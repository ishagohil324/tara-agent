import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

// Single shared pool for the whole app
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

db.on("error", (err) => {
  console.error("Unexpected DB pool error:", err);
});
