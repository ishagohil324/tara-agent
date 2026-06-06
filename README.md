# Tara — Finance Research Agent

Tara is a personal finance AI assistant that answers natural-language questions about spending and investments. Built with Mastra SDK, PostgreSQL, and Groq (Llama 3.3 — free).

---

## Live Demo

```
https://tara-agent-e7qr.onrender.com
```

---

## How It Works

```
User question
     ↓
POST /ask  (Express server)
     ↓
Tara agent (Groq LLM)
     ↓
Tools query PostgreSQL
     ↓
Grounded answer returned
```

---

## Quick Start (Local)

### 1. Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Groq API key — free at https://console.groq.com

### 2. Install
```bash
npm install
```

### 3. Create `.env`
```env
GROQ_API_KEY=gsk_your-key-here
DATABASE_URL=postgres://postgres:yourpassword@localhost:5432/provue_tara
DATA_DIR=./data/sample_a
```

### 4. Create database
```bash
psql -U postgres -c "CREATE DATABASE provue_tara;"
```

### 5. Ingest data
```bash
npm run ingest
```

To switch snapshots:
```bash
# Change DATA_DIR in .env to sample_b or sample_c, then:
npm run ingest
```

### 6. Start server
```bash
npx tsx src/server.ts
```

### 7. Test (Windows PowerShell)
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/ask" -Method POST -ContentType "application/json" -Body '{"question": "What was my biggest expense?"}'
```

---

## Sample Data

Three snapshots are provided in `data/` (not in this repo — download separately):

| Folder | Description |
|---|---|
| `sample_a` | Merchants like Apollo Pharmacy, Zepto — UPI memos |
| `sample_b` | Different merchant universe |
| `sample_c` | NEFT-style memo format |

The ingest script reads whichever `DATA_DIR` points to and loads it into PostgreSQL. Your tools always query the database — never the JSON files directly.

---

## API

### `POST /ask`
```json
Request:  { "question": "How much did I spend on food last month?" }
Response: { "answer": "Your net food spend in February 2025 was ₹4,230.50..." }
```

### `GET /health`
```json
{ "status": "ok", "agent": "Tara", "version": "1.0.0" }
```

---

## Run Evals
```bash
npx tsx scripts/eval.ts
```

Covers 15 questions: single lookup, date filtering, refunds, merchant aliases, transfers, category comparison, recurring subscriptions, no-data cases, fund period returns, holding realised returns, portfolio summary.

Against deployed URL:
```bash
$env:EVAL_URL=""https://tara-agent-e7qr.onrender.com; npx tsx scripts/eval.ts
```

---

## Deployment

### Step 1 — Hosted Postgres (Neon)
1. Go to https://neon.tech → create free project
2. Copy connection string
3. Ingest data to Neon:
```powershell
$env:DATABASE_URL="your-neon-url"; $env:DATA_DIR="./data/sample_a"; npx tsx scripts/ingest.ts
```

### Step 2 — Render Web Service
1. Go to https://render.com → New Web Service
2. Connect this GitHub repo
3. Settings:
   - Build command: `npm install`
   - Start command: `npx tsx src/server.ts`
4. Environment variables:
   - `GROQ_API_KEY` = your Groq key
   - `DATABASE_URL` = your Neon connection string
5. Deploy → get your public URL

---

## Model & Provider

- Provider: **Groq** (free, no billing needed)
- Model: **llama-3.3-70b-versatile**
- Every number Tara states comes from a tool call to the database — no hallucinated figures

---

## Observability

Logs written to `logs/tara.log` (JSON lines) per request:
- `request_id`, `question`, `tools_called`, `tool_inputs` (sanitized)
- `tables_read`, `latency_ms`, `status`, `error`

Inspect failures:
```powershell
Get-Content logs\tara.log | Where-Object { $_ -match "failure" } | Select-Object -Last 5
```

---

## Known Limitations

- Free Groq tier has rate limits — avoid rapid-fire requests
- Render free tier sleeps after inactivity — first request may take 30s to wake up
- Neon free tier has 0.5GB storage limit — more than enough for this dataset
- Relative dates resolved from latest transaction in DB — shifts when you ingest new snapshot
