/**
 * PA1 - DAILY MONITOR ORCHESTRATOR
 * 1. Append the next simulated day ("time travel") when facts end before today
 * 2. Evaluate rules on the last 2 fact days
 * 3. Cooldown + acknowledgment filter vs ALERTS_LOG
 * 4. Append new alerts to ALERTS_LOG, send the digest email
 */

var PA1_AUTO_DIGEST = true;      // email arrives on the Run click - the Loom moment
var PA1_COOLDOWN_HOURS = 20;     // same rule+campaign won't re-fire inside this window
var PA1_EVAL_WINDOW_DAYS = 2;    // recent fact days evaluated per run

function pa1LoadCtx_(ss) {
  var shC = ss.getSheetByName('CLIENTS');
  var shK = ss.getSheetByName('CAMPAIGNS');
  var shF = ss.getSheetByName('FACTS_DAILY');
  if (!shC || !shK || !shF) return null;

  var clients = {}, clientCampaigns = {}, campaigns = {}, facts = {}, dateSet = {};

  shC.getDataRange().getValues().slice(1).forEach(function (r) {
    if (!r[0]) return;
    clients[r[0]] = {
      name: String(r[1] || r[0]),
      budget: Number(r[2]) || 0,
      targetCpa: Number(r[3]) || 0,
      owner: String(r[4] || ''),
      email: String(r[5] || '')
    };
  });

  shK.getDataRange().getValues().slice(1).forEach(function (r) {
    if (!r[0]) return;
    campaigns[r[0]] = { clientId: r[2], platform: r[3] };
    (clientCampaigns[r[2]] = clientCampaigns[r[2]] || []).push(r[0]);
  });

  shF.getDataRange().getValues().slice(1).forEach(function (r) {
    if (!r[0] || !r[1]) return;
    var rec = {
      iso: pa1NormIso_(r[0]),
      spend: Number(r[2]) || 0,
      imps: Number(r[3]) || 0,
      clicks: Number(r[4]) || 0,
      conv: Number(r[5]) || 0
    };
    (facts[r[1]] = facts[r[1]] || []).push(rec);
    dateSet[rec.iso] = true;
  });

  Object.keys(facts).forEach(function (k) {
    facts[k].sort(function (a, b) { return a.iso < b.iso ? -1 : 1; });
  });

  var allDates = Object.keys(dateSet).sort();
  return {
    latest: allDates[allDates.length - 1],
    clients: clients,
    clientCampaigns: clientCampaigns,
    campaigns: campaigns,
    facts: facts,
    allDates: allDates
  };
}

function pa1RunDailyMonitor() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = Session.getScriptTimeZone();

  var ctx = pa1LoadCtx_(ss);
  if (!ctx || !ctx.latest) {
    SpreadsheetApp.getActive().toast(
      'CLIENTS / CAMPAIGNS / FACTS_DAILY not found. Run "Repair tabs" and import the demo_data CSVs.',
      'PA1', 8);
    return;
  }

  var appended = pa1AppendNextDay_(ss, ctx, tz);
  if (appended) ctx = pa1LoadCtx_(ss);

  var refDays = ctx.allDates.slice(-PA1_EVAL_WINDOW_DAYS);
  var alerts = [];
  refDays.forEach(function (iso) {
    alerts = alerts.concat(pa1Evaluate_(ctx, iso));
  });

  // One row per rule+campaign per run: state rules (R1/R2/R6) fire on both
  // evaluated days - keep the earliest occurrence (the anomaly day itself).
  var seen = {};
  alerts = alerts.filter(function (a) {
    var k = a.rule + '|' + (a.campaignId || '');
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });

  var kept = pa1CooldownFilter_(ss, alerts);
  if (kept.length) pa1WriteAlerts_(ss, kept, tz);

  var crit = kept.filter(function (a) { return a.severity === 'CRITICAL'; }).length;
  var msg = (appended ? 'Appended ' + ctx.latest + ' · ' : '') +
    'evaluated ' + refDays.join(', ') + ' · ' +
    kept.length + ' new alert(s) (' + crit + ' critical)';

  if (PA1_AUTO_DIGEST && kept.length) {
    pa1SendDigest_(ctx.clients, kept);
    msg += ' · digest sent';
  }
  Logger.log(msg);
  SpreadsheetApp.getActive().toast(msg, 'PA1 Monitor', 10);
}

/**
 * Time-travel trick: extend FACTS_DAILY by one day at full baseline
 * (anomalies belong to the seeded history; the future is "healthy" spend).
 */
function pa1AppendNextDay_(ss, ctx, tz) {
  var lastIso = ctx.latest;
  if (lastIso >= pa1TodayIso_(tz)) return 0;

  var next = pa1ToUtc_(lastIso);
  next.setUTCDate(next.getUTCDate() + 1);
  var iso = next.toISOString().slice(0, 10);
  var dow = next.getUTCDay();

  var rows = [];
  Object.keys(ctx.facts).forEach(function (campId) {
    var series = ctx.facts[campId];
    var cp = ctx.campaigns[campId] || {};
    var dowSpends = [], cpcs = [], ctrs = [], wS = 0, wC = 0;

    series.forEach(function (r) {
      var diff = pa1DayDiff_(iso, r.iso);
      if (diff > 28) return;   // baseline = last 28 days, same window R3 compares against
      if (pa1ToUtc_(r.iso).getUTCDay() === dow) dowSpends.push(r.spend);
      if (r.clicks > 0) cpcs.push(r.spend / r.clicks);
      if (r.imps > 0) ctrs.push(r.clicks / r.imps);
      wS += r.spend;
      wC += r.conv;
    });

    var spend = pa1Round2_(pa1Median_(dowSpends) * pa1Jitter_(campId + iso));
    var cpc = pa1Median_(cpcs) || 2;
    var ctr = pa1Median_(ctrs) || 0.02;
    var cl = ctx.clients[cp.clientId] || {};
    var cpa = wC > 0 ? (wS / wC) : (cl.targetCpa || 60);
    var clicks = Math.max(1, Math.round(spend / cpc));
    var imps = Math.max(clicks, Math.round(clicks / ctr));
    var conv = Math.max(0, Math.round(spend / cpa));
    rows.push([iso, campId, spend, imps, clicks, conv]);
  });

  if (!rows.length) return 0;
  var sh = ss.getSheetByName('FACTS_DAILY');
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  return 1;
}

/** Same rule + campaign won't re-fire inside the cooldown unless severity escalates.
 *  An alert the AM marked "Acknowledged" stays quiet at the same severity. */
function pa1CooldownFilter_(ss, alerts) {
  var sh = ss.getSheetByName('ALERTS_LOG');
  var last = {};
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().forEach(function (r) {
      if (!r[1]) return;
      var k = r[1] + '|' + r[3];
      var ts = pa1NormStamp_(r[0]);
      var prev = last[k];
      if (!prev || ts > prev.ts) last[k] = { ts: ts, severity: r[4], status: r[6] };
    });
  }

  var sevRank = { CRITICAL: 2, WARNING: 1 };
  return alerts.filter(function (a) {
    var prev = last[a.rule + '|' + a.campaignId];
    if (!prev) return true;
    if (prev.status === 'Acknowledged' && sevRank[a.severity] <= sevRank[prev.severity]) return false;
    var hrs = (Date.now() - new Date(String(prev.ts).replace(' ', 'T')).getTime()) / 3600000;
    if (hrs < PA1_COOLDOWN_HOURS && sevRank[a.severity] <= sevRank[prev.severity]) return false;
    return true;
  });
}

function pa1WriteAlerts_(ss, alerts, tz) {
  var sh = ss.getSheetByName('ALERTS_LOG');
  var ts = pa1NowStamp_(tz);
  var rows = alerts.map(function (a) {
    return [ts, a.rule, a.clientId, a.campaignId || '', a.severity, a.message, 'NEW', ''];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
