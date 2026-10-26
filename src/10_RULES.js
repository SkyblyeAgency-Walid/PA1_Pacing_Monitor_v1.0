/**
 * PA1 - RULES ENGINE (R1-R6)
 * Pure evaluation: pa1Evaluate_(ctx, refIso) -> [alerts]
 * alert = {rule, clientId, campaignId ('' for client-level), severity, message}
 *
 * ctx (built by pa1LoadCtx_ in 11_MONITOR.js):
 *   latest          - newest fact date (iso)
 *   clients         - {cid: {name, budget, targetCpa, owner, email}}
 *   clientCampaigns - {cid: [campId, ...]}
 *   campaigns       - {campId: {clientId, platform}}
 *   facts           - {campId: [{iso, spend, imps, clicks, conv}, ...] sorted asc}
 *   allDates        - [iso, ...] sorted asc
 */

var PA1_THRESH = {
  R1_PACE_OVER: 1.05,   // projected month-end > 105% of budget
  R2_PACE_UNDER: 0.85,  // projected month-end < 85% of budget
  R2_MIN_DAY: 10,       // under-pacing not actionable before day 10
  R3_MULT: 1.5,         // spend > 1.5x same-weekday 28d median
  R3_FLOOR: 30,         // spend floor - small campaigns don't spam
  R4_MULT: 1.8,         // CPA > 1.8x trailing 14d mean
  R4_FLOOR: 80,         // spend floor - skip noise days
  R5_SPEND_MULT: 1.5,   // spend >= 1.5x 28d median with 0 conversions
  R6_MULT: 1.25,        // 7d avg spend > 1.25x prior 7d avg
  R6_FLOOR: 30
};

var PA1_SEVERITY = {
  R1: 'CRITICAL', R2: 'WARNING', R3: 'WARNING',
  R4: 'CRITICAL', R5: 'CRITICAL', R6: 'WARNING'
};

function pa1Evaluate_(ctx, refIso) {
  var alerts = [];
  var T = PA1_THRESH;
  var ref = pa1ToUtc_(refIso);
  var dom = ref.getUTCDate();
  var dim = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0)).getUTCDate();
  var month = refIso.slice(0, 7);
  var dow = ref.getUTCDay();

  // ---------------- R1 / R2 - client-level pacing ----------------
  Object.keys(ctx.clients).forEach(function (cid) {
    var cl = ctx.clients[cid];
    var mtd = 0;
    (ctx.clientCampaigns[cid] || []).forEach(function (campId) {
      (ctx.facts[campId] || []).forEach(function (r) {
        if (r.iso.slice(0, 7) === month && r.iso <= refIso) mtd += r.spend;
      });
    });
    if (!cl.budget || !mtd) return;
    var projected = mtd / dom * dim;
    var pct = Math.round(projected / cl.budget * 1000) / 10;
    if (projected > cl.budget * T.R1_PACE_OVER) {
      alerts.push({
        rule: 'R1', clientId: cid, campaignId: '', severity: PA1_SEVERITY.R1,
        message: cl.name + ' pacing at ' + pct + '% of monthly budget - projected month-end ' +
          pa1Money_(projected) + ' vs budget ' + pa1Money_(cl.budget)
      });
    } else if (dom >= T.R2_MIN_DAY && projected < cl.budget * T.R2_PACE_UNDER) {
      alerts.push({
        rule: 'R2', clientId: cid, campaignId: '', severity: PA1_SEVERITY.R2,
        message: cl.name + ' pacing at ' + pct + '% of monthly budget - under-investing, ' +
          pa1Money_(cl.budget - projected) + ' of pace left on the table'
      });
    }
  });

  // ---------------- campaign-level rules ----------------
  Object.keys(ctx.facts).forEach(function (campId) {
    var series = ctx.facts[campId];
    var idx = -1;
    for (var i = series.length - 1; i >= 0; i--) {
      if (series[i].iso === refIso) { idx = i; break; }
    }
    if (idx < 0) return;

    var row = series[idx];
    var s = row.spend, c = row.conv;
    var meta = ctx.campaigns[campId] || {};
    var cl = ctx.clients[meta.clientId] || { name: meta.clientId };

    var dowSpends = [], med28 = [], tSpend = 0, tConv = 0, cur7 = [], prev7 = [];
    for (var j = 0; j < idx; j++) {
      var r = series[j];
      var diff = pa1DayDiff_(refIso, r.iso);
      if (diff > 28) continue;
      med28.push(r.spend);
      if (pa1ToUtc_(r.iso).getUTCDay() === dow) dowSpends.push(r.spend);
      if (diff <= 14) { tSpend += r.spend; tConv += r.conv; }
      if (diff <= 7) cur7.push(r.spend);
      else if (diff <= 14) prev7.push(r.spend);
    }
    var dowMed = pa1Median_(dowSpends);
    var base28 = pa1Median_(med28);

    // R3 - daily overspend vs same-weekday median (median, not mean: weekends pollute means)
    if (dowMed > 0 && s > T.R3_MULT * dowMed && s >= T.R3_FLOOR) {
      alerts.push({
        rule: 'R3', clientId: meta.clientId, campaignId: campId, severity: PA1_SEVERITY.R3,
        message: cl.name + ' - ' + campId + ' (' + meta.platform + ') spent ' + pa1Money_(s) +
          ' = ' + Math.round(s / dowMed * 100) + '% of its same-weekday median'
      });
    }

    // R4 - CPA anomaly vs trailing 14d mean
    if (c > 0 && s >= T.R4_FLOOR && tConv > 0) {
      var cpa = s / c;
      var baseCpa = tSpend / tConv;
      if (cpa > T.R4_MULT * baseCpa) {
        alerts.push({
          rule: 'R4', clientId: meta.clientId, campaignId: campId, severity: PA1_SEVERITY.R4,
          message: cl.name + ' - ' + campId + ' CPA ' + pa1Money_(cpa) + ' = ' +
            (cpa / baseCpa).toFixed(1) + 'x its trailing-14d average (' + pa1Money_(baseCpa) + ')'
        });
      }
    }

    // R5 - zero conversions despite real spend (pixel / landing break)
    if (c === 0 && base28 > 0 && s >= T.R5_SPEND_MULT * base28 && s >= T.R3_FLOOR && tConv > 0) {
      alerts.push({
        rule: 'R5', clientId: meta.clientId, campaignId: campId, severity: PA1_SEVERITY.R5,
        message: cl.name + ' - ' + campId + ' spent ' + pa1Money_(s) +
          ' with ZERO conversions - likely pixel or landing-page break'
      });
    }

    // R6 - slow spend creep the "vs yesterday" checks never see
    var a7 = pa1Mean_(cur7);
    var aPrev = pa1Mean_(prev7);
    if (aPrev > 0 && a7 > T.R6_MULT * aPrev && a7 >= T.R6_FLOOR) {
      alerts.push({
        rule: 'R6', clientId: meta.clientId, campaignId: campId, severity: PA1_SEVERITY.R6,
        message: cl.name + ' - ' + campId + ' 7-day avg spend ' + pa1Money_(a7) + ' = ' +
          (a7 / aPrev).toFixed(2) + 'x prior 7-day avg - slow creep'
      });
    }
  });

  return alerts;
}
