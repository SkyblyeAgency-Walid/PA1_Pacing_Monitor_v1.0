/**
 * PA1 - DIGEST EMAIL
 * One email, grouped by client, criticals on top.
 * Recipient: PA1_DIGEST_TO if set, else the account running the script (demo).
 */

var PA1_DIGEST_TO = '';   // e.g. 'you@youragency.com' - '' = send to yourself

function pa1SendDigest_(clients, alerts) {
  var to = PA1_DIGEST_TO || Session.getActiveUser().getEmail();
  if (!to) {
    Logger.log('Digest skipped - no recipient. Set PA1_DIGEST_TO in 12_DIGEST.js');
    return false;
  }

  var tz = Session.getScriptTimeZone();
  var crit = alerts.filter(function (a) { return a.severity === 'CRITICAL'; });
  var warn = alerts.filter(function (a) { return a.severity !== 'CRITICAL'; });
  var ordered = crit.concat(warn);

  var byClient = {};
  ordered.forEach(function (a) {
    (byClient[a.clientId] = byClient[a.clientId] || []).push(a);
  });

  var html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:640px">';
  html += '<h2 style="margin:0 0 4px">Pacing Monitor - daily alerts</h2>';
  html += '<p style="margin:0 0 14px;color:#666">' + crit.length + ' critical · ' +
    warn.length + ' warning · ' + pa1TodayIso_(tz) + '</p>';

  Object.keys(byClient).forEach(function (cid) {
    var cl = clients[cid] || { name: cid };
    html += '<h3 style="margin:14px 0 4px">' + cl.name +
      (cl.owner ? ' <span style="color:#999;font-weight:normal">· AM ' + cl.owner + '</span>' : '') + '</h3>';
    html += '<ul style="margin:4px 0 10px;padding-left:18px">';
    byClient[cid].forEach(function (a) {
      var color = a.severity === 'CRITICAL' ? '#990000' : '#7f6000';
      html += '<li style="margin:3px 0"><b style="color:' + color + '">[' + a.severity + ']</b> ' +
        a.rule + ' · ' + a.message + '</li>';
    });
    html += '</ul>';
  });

  html += '<p style="margin-top:18px;color:#999;font-size:12px;border-top:1px solid #eee;padding-top:8px">' +
    'PA1 Pacing Monitor - demo on synthetic data, self-directed build. ' +
    'Alerts land the morning something drifts - not at month-end when the client already noticed.</p></div>';

  var subject = 'PA1 Alerts - ' + crit.length + ' critical / ' + warn.length + ' warning · ' + pa1TodayIso_(tz);
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html });
  return true;
}

/** Stand-alone: re-send today's alerts from ALERTS_LOG (menu "Re-send digest"). */
function pa1ResendDigest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ctx = pa1LoadCtx_(ss);
  if (!ctx) {
    SpreadsheetApp.getActive().toast('Tabs missing - run "Repair tabs" first.', 'PA1', 8);
    return;
  }
  var tz = Session.getScriptTimeZone();
  var today = pa1TodayIso_(tz);
  var sh = ss.getSheetByName('ALERTS_LOG');
  var alerts = [];

  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().forEach(function (r) {
      if (r[1] && pa1NormStamp_(r[0]).slice(0, 10) === today) {
        alerts.push({ rule: r[1], clientId: r[2], campaignId: r[3], severity: r[4], message: r[5] });
      }
    });
  }

  if (!alerts.length) {
    SpreadsheetApp.getActive().toast('No alerts logged today yet - run the monitor first.', 'PA1', 8);
    return;
  }
  pa1SendDigest_(ctx.clients, alerts);
  SpreadsheetApp.getActive().toast('Digest re-sent (' + alerts.length + ' alerts).', 'PA1', 6);
}
