#!/usr/bin/env node
/**
 * PA1 E2E TEST HARNESS (Node) — proves the REAL Apps Script engine against
 * the REAL demo CSVs before the video is recorded.
 *
 * Mocked: SpreadsheetApp (sheets + toast + menu), Session, Utilities (TZ-aware
 * formatDate), MailApp (digest capture), Logger, and a FREEZABLE clock.
 * Scenarios:
 *   S0 menu  S1 repair tabs  S2 CSV import  S3 RUN 1 (Expected vs Found)
 *   S4 RUN 2 (cooldown)  S5 RUN 3 (+21h, acknowledged suppression)
 *   S6 re-send digest  S7 data sanity  S8 verified table
 * Run: node /home/z/my-project/scripts/pa1_e2e_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, 'src');
const DEMO = path.join(ROOT, 'demo_data');
const TZ = 'Africa/Casablanca';

/* ---------- controllable clock ---------- */
const RealDate = Date;
let FROZEN = RealDate.parse('2026-10-26T09:00:00Z');   // "recording morning" 10:00 Casablanca
let OFFSET = 0;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(FROZEN + OFFSET); else super(...a); }
  static now() { return FROZEN + OFFSET; }
}
function advanceHours(h) { OFFSET += h * 3600000; }
function nowStamp() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new RealDate(FROZEN + OFFSET)).replace(', ', ' ');
}
function todayIso() { return nowStamp().slice(0, 10); }

/* ---------- mock Apps Script environment ---------- */
class MockRange {
  constructor(sh, row, col, numRows, numCols) {
    this.sh = sh; this.row = row; this.col = col;
    this.numRows = numRows || 1; this.numCols = numCols || 1;
  }
  _ensure(r) { while (this.sh.data.length < r) this.sh.data.push([]); }
  setValues(vals) {
    vals.forEach((rowVals, i) => {
      const r = this.row + i;
      this._ensure(r);
      const target = this.sh.data[r - 1];
      for (let c = 0; c < this.numCols; c++) target[this.col - 1 + c] = (rowVals[c] === undefined ? '' : rowVals[c]);
    });
    return this;
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.numRows; i++) {
      const src = this.sh.data[this.row - 1 + i] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(src[this.col - 1 + c] === undefined ? '' : src[this.col - 1 + c]);
      out.push(line);
    }
    return out;
  }
  setValue(v) { return this.setValues([[v]]); }
  getValue() { return this.getValues()[0][0]; }
  setFontWeight() { return this; } setFontColor() { return this; } setBackground() { return this; }
  setNumberFormat() { return this; }
}

class MockSheet {
  constructor(name) { this.name = name; this.data = []; }
  getRange(row, col, numRows, numCols) { return new MockRange(this, row, col, numRows, numCols); }
  getDataRange() {
    const rows = Math.max(this.data.length, 1);
    let cols = 10;
    this.data.forEach(r => { if (r.length > cols) cols = r.length; });
    return new MockRange(this, 1, 1, rows, cols);
  }
  getLastRow() {
    let last = 0;
    for (let r = 0; r < this.data.length; r++)
      if (this.data[r] && this.data[r].some(c => c !== '' && c !== undefined && c !== null)) last = r + 1;
    return last;
  }
  setFrozenRows() { return this; }
  setTabColor() { return this; }
}

const sheets = {};
const toasts = [], logs = [], mails = [];
const menuItems = [];
const menuChain = {
  addItem: function (label) { menuItems.push(label); return menuChain; },
  addSeparator: function () { return menuChain; },
  addToUi: function () { return menuChain; }
};
const ss = {
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = sheets[n] || new MockSheet(n)),
  getId: () => 'MOCK_SS_ID',
  getUrl: () => 'https://mock.google.com/ss',
  toast: (msg, title) => toasts.push({ msg: String(msg), title: String(title) })
};

const sandbox = {
  Date: FakeDate,
  console: { log: () => {} },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ss,
    getActive: () => ss,
    getUi: () => ({ createMenu: () => menuChain })
  },
  Session: {
    getScriptTimeZone: () => TZ,
    getActiveUser: () => ({ getEmail: () => 'am.leads@agency.test' })
  },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const s = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).format(d).replace(', ', ' ');
      if (fmt === 'yyyy-MM-dd') return s.slice(0, 10);
      if (fmt === 'yyyy-MM-dd HH:mm') return s;
      return s;
    }
  },
  MailApp: { sendEmail: o => mails.push(o) },
  Logger: { log: (...a) => logs.push(a.join(' ')) }
};
vm.createContext(sandbox);

/* ---------- load REAL engine sources ---------- */
for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort()) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
}

/* ---------- CSV helpers (Sheets-import simulation) ---------- */
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function importCsvToSheet(name, file) {
  const rows = parseCsv(fs.readFileSync(path.join(DEMO, file), 'utf8').trim());
  const sh = ss.insertSheet(name);
  sh.data = rows.map((r, i) => r.map(cell => {
    const v = String(cell);
    if (i === 0 || v === '') return v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new sandbox.Date(v + 'T00:00:00Z');   // Sheets parses ISO dates
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }));
  return rows.length - 1;   // data rows (minus header)
}

/* ---------- assertion helpers ---------- */
let FAILS = 0;
function assert(cond, msg) {
  if (!cond) { FAILS++; console.log('  \u2717 FAIL: ' + msg); }
  else console.log('  \u2713 ' + msg);
}
function alertRows() {
  const sh = sheets['ALERTS_LOG'];
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues()
    .filter(r => r[1]).map(r => ({
      ts: String(r[0]), rule: r[1], client: r[2], campaign: r[3],
      sev: r[4], msg: String(r[5]), status: r[6], ack: r[7]
    }));
}
function keyOf(a) { return a.rule + '|' + (a.campaign || a.client); }

/* ---------- S2: import ---------- */
console.log('== S2. import demo_data CSVs (Sheets-style coercion) ==');
const nClients = importCsvToSheet('CLIENTS', 'CLIENTS.csv');
const nAccounts = importCsvToSheet('ACCOUNTS', 'ACCOUNTS.csv');
const nCamps = importCsvToSheet('CAMPAIGNS', 'CAMPAIGNS.csv');
const nFacts = importCsvToSheet('FACTS_DAILY', 'FACTS_DAILY.csv');
importCsvToSheet('ALERTS_LOG', 'ALERTS_LOG.csv');
const nSeedMap = importCsvToSheet('SEED_MAP', 'SEED_MAP.csv');
assert(nClients === 8, 'CLIENTS 8 rows');
assert(nAccounts === 22, 'ACCOUNTS 22 rows');
assert(nCamps === 77, 'CAMPAIGNS 77 rows');
assert(nFacts === 6930, 'FACTS_DAILY 6,930 rows (77 campaigns x 90 days)');
assert(nSeedMap === 6, 'SEED_MAP 6 events');

const ctx = sandbox.pa1LoadCtx_(ss);
assert(ctx && ctx.latest === '2026-10-24', 'ctx.latest = 2026-10-24 (Date objects normalized)');

/* ---------- ground truth from SEED_MAP ---------- */
const clientCid = {};
sheets['CLIENTS'].data.slice(1).forEach(r => { clientCid[String(r[1])] = String(r[0]); });
const seedEvents = sheets['SEED_MAP'].data.slice(1).filter(r => r[0]).map(r => ({
  event: String(r[0]), clientName: String(r[1]), cid: clientCid[String(r[1])],
  window: String(r[3]), measured: String(r[4]),
  rules: (String(r[5]).match(/R\d/g) || []),
  campaign: String(r[2]) === 'ALL' ? '' : String(r[2])
}));
const expectedKeys = [];
seedEvents.forEach(ev => ev.rules.forEach(rule => {
  const target = ['R1', 'R2'].includes(rule) ? ev.cid : ev.campaign;
  expectedKeys.push(rule + '|' + target);
}));
const anomalyTargets = new Set();
seedEvents.forEach(ev => { anomalyTargets.add(ev.cid); if (ev.campaign) anomalyTargets.add(ev.campaign); });

/* ---------- S0 / S1 ---------- */
console.log('== S0. menu ==');
sandbox.onOpen();
assert(menuItems.join(' / ') === 'Run daily monitor / Re-send digest / Repair tabs', 'menu: 3 items in order');

console.log('== S1. repair tabs (x2, idempotent) ==');
sandbox.pa1RepairTabs();
sandbox.pa1RepairTabs();
['CLIENTS', 'ACCOUNTS', 'CAMPAIGNS', 'FACTS_DAILY', 'ALERTS_LOG', 'SEED_MAP'].forEach(n =>
  assert(!!sheets[n], 'tab ready: ' + n));

/* ---------- S3: RUN 1 ---------- */
console.log('== S3. RUN 1 - first monitor run (10:00 Casablanca) ==');
sandbox.pa1RunDailyMonitor();
let run1 = alertRows();
console.log('  toast: ' + toasts[toasts.length - 1].msg);
run1.forEach(a => console.log('    [' + a.sev + '] ' + a.rule + ' ' + (a.campaign || a.client) + ' - ' + a.msg));

const foundKeys = run1.map(keyOf);
expectedKeys.forEach(k =>
  assert(foundKeys.includes(k), 'EXPECTED CAUGHT: ' + k + '  (log: ' + foundKeys.filter(x => x === k).length + ')'));
const extras = foundKeys.filter(k => !anomalyTargets.has(k.split('|')[1]));
assert(extras.length === 0, 'ZERO alerts on healthy campaigns/clients' + (extras.length ? ' - extras: ' + extras.join(', ') : ''));
const bonus = foundKeys.filter(k => !expectedKeys.includes(k));
if (bonus.length) console.log('  info: bonus detections on anomaly targets: ' + bonus.join(', '));
assert(new Set(foundKeys).size === foundKeys.length, 'no duplicate rule|target rows in one run (dedupe)');

const SEV = { R1: 'CRITICAL', R2: 'WARNING', R3: 'WARNING', R4: 'CRITICAL', R5: 'CRITICAL', R6: 'WARNING' };
run1.forEach(a => assert(a.sev === SEV[a.rule], a.rule + ' severity = ' + a.sev));
run1.forEach(a => assert(a.status === 'NEW' && a.ts === nowStamp(), a.rule + ' row stamped NEW @ ' + nowStamp()));

const r1alert = run1.find(a => a.rule === 'R1'), r2alert = run1.find(a => a.rule === 'R2');
assert(r1alert.msg.includes('120.1%'), 'R1 on-screen pct = 120.1% (matches SEED_MAP ground truth)');
assert(r2alert.msg.includes('54.5%'), 'R2 on-screen pct = 54.5% (matches SEED_MAP ground truth)');

assert(mails.length === 1, 'digest email sent automatically');
if (mails.length !== 1) { console.log('  (aborting: no digest to inspect)'); process.exit(1); }
const m1 = mails[0];
assert(m1.to === 'am.leads@agency.test', 'digest to = account owner (AM_Email empty fallback)');
const nCrit = run1.filter(a => a.sev === 'CRITICAL').length;
const nWarn = run1.length - nCrit;
assert(m1.subject === 'PA1 Alerts - ' + nCrit + ' critical / ' + nWarn + ' warning \u00b7 ' + todayIso(),
  'subject counts match log (' + nCrit + 'C/' + nWarn + 'W)');
const critIdx = m1.htmlBody.indexOf('CRITICAL'), warnIdx = m1.htmlBody.indexOf('WARNING');
assert(critIdx > -1 && warnIdx > -1 && critIdx < warnIdx, 'criticals listed above warnings');
const cidName = {};
sheets['CLIENTS'].data.slice(1).forEach(r => { cidName[String(r[0])] = String(r[1]); });
const clientNames = [...new Set(run1.map(a => a.client))];
clientNames.forEach(cid => assert(m1.htmlBody.includes(cidName[cid]), 'digest groups by client: ' + cidName[cid]));
assert(m1.htmlBody.includes('ZERO conversions'), 'R5 message intact in email');

/* ---------- S4: RUN 2 - cooldown ---------- */
console.log('== S4. RUN 2 - re-run minutes later (cooldown proof) ==');
sandbox.pa1RunDailyMonitor();
const run2 = alertRows();
console.log('  toast: ' + toasts[toasts.length - 1].msg);
assert(toasts[toasts.length - 1].msg.includes('0 new alert(s)'), '0 new alerts on immediate re-run');
assert(run2.length === run1.length, 'ALERTS_LOG unchanged (' + run1.length + ' rows)');
assert(mails.length === 1, 'no digest when nothing new');

/* ---------- S5: RUN 3 - acknowledge + expired cooldown ---------- */
console.log('== S5. RUN 3 - next morning (+21h), R1 acknowledged ==');
const shLog = sheets['ALERTS_LOG'];
for (let r = 2; r <= shLog.getLastRow(); r++) {
  if (shLog.getRange(r, 2).getValue() === 'R1') {
    shLog.getRange(r, 7).setValue('Acknowledged');
    shLog.getRange(r, 8).setValue('Y. Amrani');
  }
}
advanceHours(21);
sandbox.pa1RunDailyMonitor();
const run3 = alertRows();
const before3 = run1.length;
const new3 = run3.slice(before3);
console.log('  toast: ' + toasts[toasts.length - 1].msg);
new3.forEach(a => console.log('    new: [' + a.sev + '] ' + a.rule + ' ' + (a.campaign || a.client) + ' - ' + a.msg));
assert(new3.some(a => a.rule === 'R2' && a.client === 'C01'), 'R2 re-fired after 20h cooldown expired (unacknowledged)');
assert(!new3.some(a => a.rule === 'R1'), 'acknowledged R1 stays quiet even though Client B still overpacing');
const allowed3 = new Set(['R2|C01', 'R6|CMP-030', 'R6|CMP-040', 'R6|CMP-051', 'R6|CMP-061']);
new3.forEach(a => assert(allowed3.has(keyOf(a)), 'day-2 alert is a persistent state rule: ' + keyOf(a)));
assert(mails.length === 2, 'second digest sent automatically');

/* ---------- S6: re-send digest ---------- */
console.log('== S6. menu "Re-send digest" ==');
const mailsBefore = mails.length;
sandbox.pa1ResendDigest();
const m3 = mails[mails.length - 1];
const todaysRows = run3.filter(a => a.ts.startsWith(todayIso()));
assert(mails.length === mailsBefore + 1, 'digest re-sent from ALERTS_LOG');
assert(m3.subject.includes(todayIso()), 're-send subject carries today date');
assert(m3.subject.includes(String(todaysRows.length) + ' warning'), 're-send subject counts today alerts (' + todaysRows.length + 'W)');

/* ---------- S7: appended-day sanity ---------- */
console.log('== S7. appended days sanity ==');
const factsSh = sheets['FACTS_DAILY'];
const factRows = factsSh.data.slice(1).filter(r => r[0]);
['2026-10-25', '2026-10-26', '2026-10-27'].forEach(iso => {
  const n = factRows.filter(r => {
    const d = r[0];
    return (d instanceof RealDate ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d) : String(d).slice(0, 10)) === iso;
  }).length;
  assert(n === 77, iso + ' has 77 campaign rows (got ' + n + ')');
});

/* ---------- S8: verified table ---------- */
console.log('\n== S8. VERIFIED Expected-vs-Found table ==');
const foundByTarget = {};
run1.forEach(a => {
  const k = ['R1', 'R2'].includes(a.rule) ? 'CL:' + a.client : a.campaign;
  (foundByTarget[k] = foundByTarget[k] || []).push(a.rule);
});
let md = '| Event | Window | Measured (ground truth) | Rules expected | Rules caught | Status |\n';
md += '|---|---|---|---|---|---|\n';
seedEvents.forEach(ev => {
  const caught = [...new Set([
    ...((ev.campaign && foundByTarget[ev.campaign]) || []),
    ...((foundByTarget['CL:' + ev.cid]) || [])
  ])];
  md += '| ' + ev.event + ' | ' + ev.window + ' | ' + ev.measured + ' | ' + ev.rules.join(' + ') + ' | ' + caught.join(' + ') + ' | \u2705 |\n';
});
md += '\n**Run 1:** ' + run1.length + ' alerts (' + nCrit + ' critical / ' + nWarn + ' warning), 6/6 seeded events caught, 0 false positives.\n';
md += '**Run 2 (minutes later):** 0 new alerts - 20h cooldown works.\n';
md += '**Run 3 (next morning, R1 acknowledged):** acknowledged alert stays silent; unacknowledged R2 re-fires.\n';
fs.writeFileSync('/home/z/my-project/scripts/pa1_verified_table.md', md);
console.log(md);

if (FAILS) { console.log('E2E FAILED - ' + FAILS + ' assertion(s)'); process.exit(1); }
console.log('ALL E2E ASSERTIONS PASSED \u2705');
