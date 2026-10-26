/**
 * PA1 PACING MONITOR - shared helpers (loaded first)
 */

function pa1NormIso_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Etc/GMT', 'yyyy-MM-dd');
  }
  return String(v).slice(0, 10);
}

function pa1NormStamp_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  }
  return String(v);
}

function pa1ToUtc_(iso) {
  return new Date(iso + 'T00:00:00Z');
}

function pa1DayDiff_(isoLater, isoEarlier) {
  return Math.round((pa1ToUtc_(isoLater) - pa1ToUtc_(isoEarlier)) / 86400000);
}

function pa1TodayIso_(tz) {
  return Utilities.formatDate(new Date(), tz || Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function pa1NowStamp_(tz) {
  return Utilities.formatDate(new Date(), tz || Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function pa1Median_(arr) {
  if (!arr || !arr.length) return 0;
  var a = arr.slice().sort(function (x, y) { return x - y; });
  var m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function pa1Mean_(arr) {
  if (!arr || !arr.length) return 0;
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

// Deterministic jitter in [0.9, 1.1) keyed by campaign+date (no Math.random ->
// re-runs produce identical appended days)
function pa1Jitter_(key) {
  var h = 0;
  for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return 0.9 + 0.2 * (Math.abs(h % 1000) / 1000);
}

function pa1Round2_(x) {
  return Math.round(x * 100) / 100;
}

function pa1Money_(x) {
  return '$' + (x >= 100 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toFixed(1));
}
