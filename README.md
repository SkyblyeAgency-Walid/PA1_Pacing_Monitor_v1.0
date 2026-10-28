# PA1 — Pacing Monitor

**Daily budget-pacing & anomaly watch for paid media agencies.**

> I watch every client's budget and performance daily and tell your account managers
> the moment something drifts — not at the end of the month when the client already noticed.

- Runs entirely inside **Google Sheets + Apps Script** — the client keeps the workbook
- **Read-only on ad data**: the monitor never edits campaign history, it only appends alerts
- **6 named rules** catch **6 seeded failure modes** — including a 3-day overspend run and a zero-conversion pixel break, the two scenarios agencies genuinely bleed money on
- One **8 a.m. digest email**, grouped by client, criticals on top
- Zero external dependencies for the demo: no ad-platform tokens, no webhook infra

---

## What proves it works

This repo ships a **synthetic but realistic** media history: 8 clients, 22 ad accounts,
77 campaigns, ~6,900 daily facts across 90 days (weekly seasonality, mid-month ramp,
budget-cap throttling, platform-realistic CTR/CPC/CPA envelopes).

Six failure modes are injected on purpose. `demo_data/SEED_MAP.csv` is the ground truth —
**measured from the generated data and verified against the real engine by this repo's own
E2E harness** (`node tools/verify_pa1_e2e.js` — mocks Sheets/Gmail/clock, runs `src/` for real):

| # | Event | Client | Measured signature | Caught by (verified) |
|---|-------|--------|--------------------|----------------------|
| E1 | 3-day overspend run | B | spend at 162% / 155% / 165% of daily cap | R3 + R1 (120.1% projected) |
| E2 | CPA doubling | D | CPA $160 = 2.49x trailing $64 | R3 + R4 + R6 |
| E3 | Single-day spike | E | $227 = 4.2x median | R3 + R6 |
| E4 | Zero conversions despite spend | F | $400 spent, 0 conversions | R3 + R5 + R6 |
| E5 | Underspend | A | 54.5% of budget projected | R2 |
| E6 | Slow creep | G | 7-day avg = 1.57x prior 7-day avg | R3 + R6 |

**Verified behavior on this exact dataset:**

- **Run 1** — appends the next simulated day, logs **13 alerts (3 critical / 10 warning)**,
  catches 6/6 seeded events, **zero alerts on healthy campaigns**, digest email sent
- **Run 2 minutes later** — **0 new alerts** (20h cooldown holds)
- **Run 3 next morning with R1 acknowledged** — the acknowledged alert stays silent while
  unacknowledged pacing alerts re-fire (5 new) — "nothing dismissed without a name on it"
- On-screen numbers match ground truth exactly: R1 shows **120.1%**, R2 shows **54.5%**

**First click of "Run daily monitor" catches all six.** Every failure mode has a
named rule that catches it — that symmetry is the product.

---

## Repo layout

```
pa1-pacing-monitor/
├── src/                    Apps Script project (clasp rootDir)
│   ├── 00_INSTALL.js       tab installer / repair
│   ├── 09_HELPERS.js       shared helpers (dates, medians, deterministic jitter)
│   ├── 10_RULES.js         the rules engine - R1..R6, pure evaluation
│   ├── 11_MONITOR.js       orchestrator: append simulated day, evaluate, cooldown, log
│   ├── 12_DIGEST.js        digest email (MailApp), grouped by client
│   ├── 99_MENU.js          custom menu
│   └── appsscript.json     manifest (V8, Africa/Casablanca, Sheets + send_mail scopes)
├── tools/
│   ├── gen_pa1_seed.py     deterministic demo-data generator (Python 3.8+)
│   └── verify_pa1_e2e.js   E2E regression harness (Node, zero deps): mocks
│                           Sheets/Gmail/clock, runs the REAL src/ engine, asserts
│                           all 6 events + cooldown + acknowledge + digest
├── demo_data/              6 CSVs ready for Google Sheets import
├── RECORDING_RUNBOOK.md    shot-by-shot video script with pre-verified numbers
├── .clasp.json.example     rename to .clasp.json and paste your script ID
├── .claspignore / .gitignore / LICENSE (MIT)
```

## Data model (one grain: daily facts at campaign level)

| Tab | Columns | Rows |
|-----|---------|------|
| `CLIENTS` | ClientID, Name, MonthlyBudget, TargetCPA, AM_Owner, AM_Email | 8 |
| `ACCOUNTS` | AccountID, ClientID, Platform, AccountName | 22 |
| `CAMPAIGNS` | CampaignID, AccountID, ClientID, Platform, Objective, Status | 77 |
| `FACTS_DAILY` | Date, CampaignID, Spend, Impressions, Clicks, Conversions | ~6,930 |
| `ALERTS_LOG` | Timestamp, RuleID, ClientID, CampaignID, Severity, Message, Status, AckedBy | grows per run |
| `SEED_MAP` | EventID, ClientID, CampaignID, Window, Measured, RulesExpected | 6 |

## The rules

| Rule | Logic | Severity |
|------|-------|----------|
| **R1 Pacing over** | projected month-end (MTD ÷ day × days-in-month) > 105% of budget | CRITICAL |
| **R2 Pacing under** | projected < 85% AND day of month ≥ 10 (not actionable on day 3) | WARNING |
| **R3 Daily overspend** | spend > 1.5x its same-weekday 28-day **median** (median, not mean — weekends pollute means), floor $30 | WARNING |
| **R4 CPA anomaly** | CPA > 1.8x trailing 14-day mean AND spend ≥ $80 (skip noise days) | CRITICAL |
| **R5 Zero conversions** | spend ≥ 1.5x 28-day median AND 0 conversions AND trailing 14d had conversions | CRITICAL |
| **R6 Spend creep** | 7-day avg > 1.25x prior 7-day avg — catches the slow drift R3 misses | WARNING |

Engineering details that matter in production:

- **Cooldown / dedupe** — same rule + campaign won't re-fire within 20h unless severity escalates
- **Acknowledgment workflow** — set `Status = Acknowledged` in `ALERTS_LOG` (with your name in
  `AckedBy`) and the alert stays quiet at the same severity. No alert dismissed without a logged reason.
- **Spend floors** on every percentage rule so small campaigns don't spam
- **Deterministic day-append** — each "Run daily monitor" appends the next simulated day
  (median-based, hash-jittered — identical on re-runs)

## Quickstart

**A. clasp (recommended — VS Code workflow)**

```bash
npm install -g @google/clasp && clasp login
# create a Google Sheet named PA1_Pacing_Monitor, copy its ID, then:
clasp create --type sheets --parentId SHEET_ID --title "PA1 Pacing Monitor"
cp .clasp.json.example .clasp.json   # paste your scriptId
clasp push
```

**B. No CLI** — open the Sheet → Extensions → Apps Script → copy the files from `src/` in.

Then load the data:

1. In the Sheet: **File → Import → Upload** → import each `demo_data/*.csv`
   → Import location: **Insert new sheet** (tab name = filename)
2. Refresh → menu **Pacing Monitor** appears
3. Click **Run daily monitor** → authorize on first run → toast + alerts + digest email

Regenerate the data anytime (identical numbers): `python tools/gen_pa1_seed.py`

Run the regression harness anytime (needs only Node): `node tools/verify_pa1_e2e.js`

## Design decisions

- **2-day evaluation window**: each run evaluates the two most recent fact days, so the first
  run after seeding catches every anomaly (their most recent anomalous day falls inside the window)
- **Median-based baselines** with same-weekday logic — robust to weekends, ramps and the
  anomalies themselves
- **Client A–H naming** — anonymous by construction; signals confidentiality discipline
- **Token-free demo** — the production version only swaps the data layer (real ad-platform
  connectors); the rules engine is the product and it is already built

## Offer

Point me at one real client account — read-only access or platform CSV exports — and I run
this monitor in parallel for 2 weeks. You keep the dashboard and the alert setup either way.

## License

MIT — see [LICENSE](LICENSE).
