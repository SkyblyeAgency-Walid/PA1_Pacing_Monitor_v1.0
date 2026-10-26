#!/usr/bin/env python3
"""
PA1 Pacing Monitor - deterministic demo data generator.

Generates 90 days of daily campaign facts for 8 clients / 22 accounts /
74 campaigns and injects exactly 6 anomaly events, then writes the
workbook model as CSVs ready for Google Sheets import.

Every run produces identical numbers (fixed RNG seed).

Usage:
    python tools/gen_pa1_seed.py
"""

from __future__ import annotations

import calendar
import csv
import random
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SEED = 20260421
HISTORY_DAYS = 90
OUT_DIR = Path(__file__).resolve().parent.parent / "demo_data"

PLATFORMS = {
    "Google": {"ctr": (0.030, 0.060), "cpc": (1.5, 4.0)},
    "Meta":   {"ctr": (0.010, 0.025), "cpc": (0.8, 1.8)},
    "TikTok": {"ctr": (0.008, 0.015), "cpc": (0.5, 1.2)},
}
CAMPAIGNS_PER_ACCOUNT = {"Google": 4, "Meta": 3, "TikTok": 3}
OBJECTIVES = ["Prospecting", "Retargeting", "Brand", "Prospecting"]

# Seeded anomaly parameters - the 6 failure modes the rules engine must catch
OVERSPEND_MULTS = [1.65, 1.55, 1.62]  # E1 Client B: 3 consecutive days vs daily cap
CREEP_GROWTH = 1.08                   # E6 Client G: +8%/day
CREEP_DAYS = 10
CPA2X_MULT = 2.1                      # E2 Client D: CPA doubling
CPA2X_SPEND = 160.0
SPIKE_MULT = 4.0                      # E3 Client E: one day vs median
ZEROCONV_SPEND = 200.0                # E4 Client F: per day, 0 conversions
UNDERSPEND_FACTOR = 0.55              # E5 Client A: current-month pacing


@dataclass
class Client:
    letter: str
    budget: float
    target_cpa: float
    owner: str
    geo: str
    accounts: list
    pace_bias: float = 1.0  # hidden MTD multiplier that drives R1/R2


CLIENTS = [
    Client("A", 40000, 60, "S. Bennis",  "US", [("Google", 2), ("Meta", 1)]),
    Client("B", 25000, 45, "Y. Amrani",  "US", [("Google", 2), ("Meta", 1)], pace_bias=1.18),
    Client("C", 30000, 50, "L. Farah",   "EU", [("Google", 1), ("Meta", 1)]),
    Client("D", 20000, 80, "K. Ziani",   "EU", [("Google", 1), ("Meta", 2)]),
    Client("E", 18000, 35, "N. Alaoui",  "CA", [("Google", 2), ("TikTok", 1)]),
    Client("F", 15000, 40, "M. Tazi",    "US", [("Google", 1), ("Meta", 1), ("TikTok", 1)]),
    Client("G", 22000, 55, "R. Kabbaj",  "US", [("Google", 1), ("Meta", 1)]),
    Client("H", 35000, 70, "H. Chraibi", "EU", [("Google", 1), ("Meta", 1), ("TikTok", 1)]),
]


@dataclass
class Campaign:
    cid: str
    account_id: str
    client: Client
    platform: str
    daily_cap: float
    cpa: float
    cpc: float
    ctr: float
    anomaly: str | None = None


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def month_shape(dom: int, dim: int) -> float:
    """Monthly spend rhythm: soft start, mid-month ramp, cap throttle."""
    if dom <= 3:
        return 0.92
    if dom >= dim - 2:
        return 0.72
    if 10 <= dom <= 20:
        return 1.08
    return 1.0


def build_calendar() -> list:
    """90 days ending yesterday - the monitor appends the next day (time travel)."""
    days = []
    for i in range(HISTORY_DAYS, 0, -1):
        d = date.today() - timedelta(days=i)
        days.append({
            "iso": d.isoformat(),
            "dow": d.weekday(),  # 5=Sat, 6=Sun
            "dom": d.day,
            "dim": calendar.monthrange(d.year, d.month)[1],
            "days_ago": i,
            "current_month": (d.month, d.year) == (date.today().month, date.today().year),
        })
    return days


def build_dimensions(rng: random.Random):
    client_rows, account_rows, campaign_rows, campaigns = [], [], [], []
    acc_seq = camp_seq = 0
    for ci, c in enumerate(CLIENTS, start=1):
        cid = f"C0{ci}"
        client_rows.append([cid, f"Client {c.letter}", c.budget, c.target_cpa, c.owner, ""])
        n_camps = sum(n * CAMPAIGNS_PER_ACCOUNT[p] for p, n in c.accounts)
        for plat, n in c.accounts:
            for k in range(n):
                acc_seq += 1
                acc_id = f"ACC-{acc_seq:03d}"
                account_rows.append([acc_id, cid, plat,
                                     f"{c.letter} · {plat}" + (" Alt" if k else " Main")])
                for j in range(CAMPAIGNS_PER_ACCOUNT[plat]):
                    camp_seq += 1
                    p = PLATFORMS[plat]
                    campaigns.append(Campaign(
                        cid=f"CMP-{camp_seq:03d}", account_id=acc_id, client=c, platform=plat,
                        daily_cap=round((c.budget / 30.4 / n_camps) * (0.7 + rng.random() * 0.7), 2),
                        cpa=c.target_cpa * (2.718281828 ** (0.15 * rng.gauss(0, 1))),
                        cpc=p["cpc"][0] + rng.random() * (p["cpc"][1] - p["cpc"][0]),
                        ctr=p["ctr"][0] + rng.random() * (p["ctr"][1] - p["ctr"][0]),
                    ))
                    campaign_rows.append([f"CMP-{camp_seq:03d}", acc_id, cid, plat,
                                          OBJECTIVES[j % len(OBJECTIVES)] + f" — {c.geo} {j + 1}",
                                          "ENABLED"])
    return client_rows, account_rows, campaign_rows, campaigns


def assign_anomalies(campaigns: list) -> None:
    by_letter = {}
    for cp in campaigns:
        by_letter.setdefault(cp.client.letter, []).append(cp)
    by_letter["B"][0].anomaly = "overspend"
    by_letter["D"][0].anomaly = "cpa2x"
    by_letter["E"][0].anomaly = "spike"
    by_letter["F"][0].anomaly = "zeroconv"
    by_letter["G"][0].anomaly = "creep"


def build_facts(rng: random.Random, days: list, campaigns: list) -> list:
    rows = []
    for cp in campaigns:
        for d in days:
            dow_f = 0.65 if d["dow"] >= 5 else 1.0          # weekend seasonality
            spend = (cp.daily_cap * dow_f * month_shape(d["dom"], d["dim"])
                     * (0.9 + rng.random() * 0.2) * cp.client.pace_bias)
            cpa_mult, zero, absolute = 1.0, False, None

            if cp.anomaly == "overspend" and d["days_ago"] <= 3:
                absolute = cp.daily_cap * OVERSPEND_MULTS[d["days_ago"] - 1]
            if cp.anomaly == "spike" and d["days_ago"] == 1:
                absolute = cp.daily_cap * SPIKE_MULT
            if cp.anomaly == "creep" and d["days_ago"] <= CREEP_DAYS:
                spend *= CREEP_GROWTH ** (CREEP_DAYS + 1 - d["days_ago"])
            if cp.anomaly == "cpa2x" and d["days_ago"] <= 3:
                absolute, cpa_mult = CPA2X_SPEND, CPA2X_MULT
            if cp.anomaly == "zeroconv" and d["days_ago"] <= 2:
                absolute, zero = max(spend, ZEROCONV_SPEND), True

            if absolute is not None:
                spend = absolute
            if cp.client.letter == "A" and d["current_month"]:
                spend *= UNDERSPEND_FACTOR                   # E5 underspend event
            spend = round(spend, 2)

            clicks = max(1, round(spend / cp.cpc))
            imps = max(clicks, round(clicks / cp.ctr))
            conv = 0 if zero else max(0, round(spend / (cp.cpa * cpa_mult)))
            rows.append([d["iso"], cp.cid, spend, imps, clicks, conv])
    return rows


# ---------------------------------------------------------------------------
# Ground truth - measured from the generated data, not asserted
# ---------------------------------------------------------------------------

def measure_truths(days: list, campaigns: list, facts: list) -> list:
    f = {}
    for r in facts:
        f.setdefault(r[1], {})[r[0]] = r
    by_letter = {}
    for cp in campaigns:
        by_letter.setdefault(cp.client.letter, []).append(cp)

    def agg(cp, lo, hi):
        s = c = 0
        for d in days:
            if lo <= d["days_ago"] <= hi:
                r = f[cp.cid][d["iso"]]
                s += r[2]
                c += r[5]
        return s, c

    def projected_pct(letter):
        last = days[-1]
        tot = sum(f[cp.cid][d["iso"]][2]
                  for cp in campaigns if cp.client.letter == letter
                  for d in days if d["current_month"])
        budget = next(c.budget for c in CLIENTS if c.letter == letter)
        return round(tot / last["dom"] * last["dim"] / budget * 100, 1)

    T = []

    b = by_letter["B"][0]
    s1, _ = agg(b, 1, 1)
    s2, _ = agg(b, 2, 2)
    s3, _ = agg(b, 3, 3)
    T.append(["E1 Overspend run", "Client B", b.cid, "last 3 days",
              f"spend at {s3 / b.daily_cap:.0%} / {s2 / b.daily_cap:.0%} / {s1 / b.daily_cap:.0%} of cap",
              f"R3 + R1 ({projected_pct('B')}% projected)"])

    d = by_letter["D"][0]
    bs, bc = agg(d, 4, 17)
    rs, rc = agg(d, 1, 3)
    base_cpa, rec_cpa = bs / max(bc, 1), rs / max(rc, 1)
    T.append(["E2 CPA doubling", "Client D", d.cid, "last 3d vs trailing 14d",
              f"CPA ${rec_cpa:.0f} = {rec_cpa / base_cpa:.2f}x trailing ${base_cpa:.0f}", "R3 + R4 + R6"])

    e = by_letter["E"][0]
    mids = sorted(f[e.cid][d["iso"]][2] for d in days if 2 <= d["days_ago"] <= 29)
    med = (mids[13] + mids[14]) / 2
    ys = f[e.cid][days[-1]["iso"]][2]
    T.append(["E3 Single-day spike", "Client E", e.cid, "yesterday",
              f"${ys:.0f} = {ys / med:.1f}x median ${med:.0f}", "R3 + R6"])

    fz = by_letter["F"][0]
    zs, zc = agg(fz, 1, 2)
    T.append(["E4 Zero conversions", "Client F", fz.cid, "last 2 days",
              f"${zs:.0f} spent, {zc} conversions", "R3 + R5 + R6"])

    T.append(["E5 Underspend", "Client A", "ALL", "month to date",
              f"{projected_pct('A')}% of budget projected (fires when day >= 10)", "R2"])

    g = by_letter["G"][0]
    w1s, _ = agg(g, 1, 7)
    w2s, _ = agg(g, 8, 14)
    T.append(["E6 Slow creep", "Client G", g.cid, "last 7d vs prior 7d",
              f"avg ${(w1s / 7):.0f} = {w1s / w2s:.2f}x prior avg ${(w2s / 7):.0f}", "R3 + R6"])
    return T


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def write_csv(name: str, headers: list, rows: list) -> None:
    with open(OUT_DIR / name, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(headers)
        w.writerows(rows)


def main() -> None:
    rng = random.Random(SEED)
    days = build_calendar()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    client_rows, account_rows, campaign_rows, campaigns = build_dimensions(rng)
    assign_anomalies(campaigns)
    facts = build_facts(rng, days, campaigns)
    truths = measure_truths(days, campaigns, facts)

    write_csv("CLIENTS.csv",
              ["ClientID", "Name", "MonthlyBudget", "TargetCPA", "AM_Owner", "AM_Email"],
              client_rows)
    write_csv("ACCOUNTS.csv",
              ["AccountID", "ClientID", "Platform", "AccountName"], account_rows)
    write_csv("CAMPAIGNS.csv",
              ["CampaignID", "AccountID", "ClientID", "Platform", "Objective", "Status"],
              campaign_rows)
    write_csv("FACTS_DAILY.csv",
              ["Date", "CampaignID", "Spend", "Impressions", "Clicks", "Conversions"], facts)
    write_csv("ALERTS_LOG.csv",
              ["Timestamp", "RuleID", "ClientID", "CampaignID", "Severity", "Message", "Status", "AckedBy"],
              [])
    write_csv("SEED_MAP.csv",
              ["EventID", "ClientID", "CampaignID", "Window", "Measured", "RulesExpected"], truths)

    print("=" * 76)
    print(f"PA1 SEED OK - clients {len(client_rows)} | accounts {len(account_rows)} | "
          f"campaigns {len(campaign_rows)} | facts {len(facts)}")
    print(f"window: {days[0]['iso']} -> {days[-1]['iso']} (ends yesterday)")
    print("=" * 76)
    for t in truths:
        print(f"{t[0]:<20} {t[1]:<10} {t[2]:<9} {t[3]:<22} {t[4]:<42} expect: {t[5]}")
    print("=" * 76)
    print(f"6 CSVs written to {OUT_DIR}")


if __name__ == "__main__":
    main()
