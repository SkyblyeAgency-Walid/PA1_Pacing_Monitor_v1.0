# PA1 — Recording Runbook (video-proof script)

Every number below was **pre-verified by `tools/verify_pa1_e2e.js`** against the real
engine on this exact dataset. If the sheet shows something else, something changed —
see "Retakes & resets" at the bottom before recording.

---

## 0. Pre-flight (do BEFORE hitting record, in this order)

1. **Fresh state**: `ALERTS_LOG` shows only the header row, and `FACTS_DAILY`'s last
   row is `2026-10-24` (Date column). If you practiced earlier, restore:
   *File → Version history → select the version right after the CSV imports*, or see
   "Retakes & resets".
2. **Row counter**: put this in a scratch cell (delete before recording):
   `=COUNTA(FACTS_DAILY!A2:A)` → must show **6930**
3. **Authorize first**: run the monitor once BEFORE recording, then reset state —
   the very first run triggers Google's authorization dialog, which you don't want
   on camera.
4. Tabs you'll touch, in order: `SEED_MAP` → `FACTS_DAILY` → menu run → Gmail →
   `ALERTS_LOG` → `FACTS_DAILY`.
5. Recording date doesn't matter: the first run always appends exactly one day and
   evaluates the last 2 fact days (2026-10-24 + the appended 2026-10-25), so all
   anomaly days (10-22 / 10-23 / 10-24) stay in the window.

## Verified numbers (teleprompter card)

| Milestone | Value on screen |
|---|---|
| FACTS_DAILY rows before | **6,930** |
| Toast after Run 1 | `Appended 2026-10-25 · evaluated 2026-10-24, 2026-10-25 · 13 new alert(s) (3 critical) · digest sent` |
| FACTS_DAILY rows after Run 1 | **7,007** (exactly +77 = one day × 77 campaigns) |
| Email subject | `PA1 Alerts - 3 critical / 10 warning · <today>` |
| R1 message (Client B) | pacing at **120.1%** of monthly budget — projected month-end **$30,030** vs budget $25,000 |
| R2 message (Client A) | pacing at **54.5%** of monthly budget — **$18,211 of pace left on the table** |
| R4 message (CMP-030) | CPA **$160 = 2.1x** its trailing-14d average ($77.8) |
| R5 message (CMP-051) | spent **$200 with ZERO conversions** — likely pixel or landing-page break |
| R3 message (CMP-040) | spent **$227 = 559%** of its same-weekday median |
| R6 message (CMP-061) | 7-day avg **$153 = 1.57x** prior 7-day avg — slow creep |
| FACTS_DAILY rows after Run 2 | **7,084** |
| Toast after Run 2 (minutes later) | `… · 0 new alert(s) (0 critical)` — no email |
| FACTS_DAILY rows after Run 3 (+21h) | **7,161** |
| Toast after Run 3 | `… · 5 new alert(s) (0 critical) · digest sent` |

## Shot list (~2:30 total)

**Beat 1 — the setup (0:00–0:25) — tab: `SEED_MAP`**
Say: *"Six failure modes, injected on purpose: a 3-day overspend run, a CPA
doubling, a one-day spike, a dead pixel, a client under-investing 45%, and a slow
budget creep. This tab is the ground truth — measured from the data, not from
hope. Now let's see what the monitor catches."*

**Beat 2 — the run (0:25–0:55) — menu: Pacing Monitor → Run daily monitor**
Toast appears: `Appended 2026-10-25 · evaluated 2026-10-24, 2026-10-25 · 13 new
alert(s) (3 critical) · digest sent`.
Say: *"One click. It time-travels one day, evaluates the last two, and 13 alerts
land — every single one on an injected target. Zero noise on the healthy
campaigns."*

**Beat 3 — the email (0:55–1:25) — switch to Gmail**
Subject: `PA1 Alerts - 3 critical / 10 warning · <today>`. Scroll slow: criticals
on top — Client B pacing 120.1%, CMP-030 CPA 2.1x, CMP-051 zero conversions.
Say: *"The digest grouped by client, criticals first — this is what the account
manager actually reads with their morning coffee."*

**Beat 4 — the evidence (1:25–1:55) — tabs: `ALERTS_LOG`, then `FACTS_DAILY`**
ALERTS_LOG: 13 rows stamped NEW. FACTS_DAILY: **7,007 rows** (counter).
Say: *"Read-only proof: the monitor appended exactly one simulated day — 77 rows —
and didn't touch a single historical number. 6,930 plus 77 is 7,007."*

**Beat 5 — the anti-spam proof (1:55–2:15) — menu: Run daily monitor again**
Toast: `… 0 new alert(s)`. Say: *"Same problem, no spam — the same rule won't
re-fire within 20 hours. This is what makes it a tool an agency can live with."*

**Beat 6 — the acknowledgment (2:15–2:40) — `ALERTS_LOG`**
In the R1 row (Client B): `Status = Acknowledged`, `AckedBy = Y. Amrani`.
Say: *"And when a human decides 'I've seen it', they sign it. Tomorrow it stays
quiet — but anything NOT acknowledged re-alerts. Nothing disappears without a
name on it."* (If you have a day-2 clip: run +21h later → toast shows 5 new,
R1 absent.)

**Close — back on `SEED_MAP`**
*"Six injected failures, six named rules. Alerts land the morning something
drifts — not at month-end when the client already noticed."*

## Retakes & resets

- **Ran too many times during takes?** The eval window has slid past the anomalies.
  Reset: select FACTS_DAILY rows with Date > `2026-10-24` → delete rows; clear
  ALERTS_LOG rows 2+ (keep the header). Or File → Version history → restore.
- **Anomaly days live on 2026-10-22 / 23 / 24** — verify with a filter on CMP-012
  (spend should read ~$90 / ~$85 / ~$90 vs ~$55 normal days).
- **Don't regenerate CSVs on recording day** unless you re-import all of them —
  `gen_pa1_seed.py` always ends "yesterday", so the window shifts. The shipped CSVs
  end 2026-10-24 and work on any recording date.
- **If numbers drift from the teleprompter card**: stop, run
  `node tools/verify_pa1_e2e.js` — it replays the whole demo headlessly and tells
  you what changed.
