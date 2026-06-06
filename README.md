# Tara — Finance Research Agent

Tara is a personal finance AI assistant that answers natural-language questions about your spending and investments. Built with the Mastra SDK, PostgreSQL, and Anthropic Claude.

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- PostgreSQL 14+
- An Anthropic API key (https://console.anthropic.com)

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```env
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
DATABASE_URL=postgres://postgres:postgres@localhost:5432/provue_tara
DATA_DIR=./data/sample_a
```

### 4. Create the database

```bash
psql -U postgres -c "CREATE DATABASE provue_tara;"
```

### 5. Ingest sample data

```bash
DATA_DIR=./data/sample_a npm run ingest
```

To ingest a different snapshot:
```bash
DATA_DIR=./data/sample_b npm run ingest
```

### 6. Start the server

```bash
npm start
```

Server starts at http://localhost:3000

### 7. Ask a question

```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "How much did I spend on food last month?"}'
```

---

## Running Evals

```bash
npm run eval
```

Runs 15 questions and prints pass/fail summary.

To run evals against the deployed URL:
```bash
EVAL_URL=https://your-deployed-url.com npm run eval
```

---

## API

### `POST /ask`

**Request:**
```json
{ "question": "What was my biggest expense?" }
```

**Response:**
```json
{ "answer": "Your biggest single expense was ₹12,500.00 at..." }
```

### `GET /health`

Returns `{ "status": "ok" }` — use this to check if the service is running.

---

## Model & Provider

- Provider: **Anthropic**
- Model: **claude-sonnet-4-5**
- All tool calls and results are grounded — Tara never states a number she didn't retrieve from the database.

---

## Deployment

Deployed at: **[ADD YOUR URL HERE]**

Hosted Postgres: Neon / Supabase / Render (free tier)

To deploy on Render:
1. Connect your GitHub repo
2. Set env vars: `ANTHROPIC_API_KEY`, `DATABASE_URL`
3. Build command: `npm install`
4. Start command: `npm start`

---

## Observability

Logs are written to `logs/tara.log`. Each entry contains:
- `request_id`
- `question`
- `tools_called`
- `tool_inputs` (sanitized)
- `tables_read`
- `latency_ms`
- `status` (success/failure)
- `error` (if applicable)

---

## Known Limitations

- Relative dates ("last month") are resolved from the latest transaction date in the DB — if you ingest a new snapshot, the reference date shifts.
- Free-tier Postgres may have connection limits; the pool is capped at 10.
- Cold-start on free hosting platforms may add 10–30s to the first request.
