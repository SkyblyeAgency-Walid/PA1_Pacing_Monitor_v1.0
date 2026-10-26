/**
 * PA1 - TAB INSTALLER / REPAIR
 * Creates any missing tab with the exact headers the engine expects.
 * Matches demo_data/*.csv column-for-column (import + repair both work).
 */

var PA1_TABS = [
  { name: 'CLIENTS',     color: '#0b5394',
    headers: ['ClientID', 'Name', 'MonthlyBudget', 'TargetCPA', 'AM_Owner', 'AM_Email'] },
  { name: 'ACCOUNTS',    color: '#0b5394',
    headers: ['AccountID', 'ClientID', 'Platform', 'AccountName'] },
  { name: 'CAMPAIGNS',   color: '#0b5394',
    headers: ['CampaignID', 'AccountID', 'ClientID', 'Platform', 'Objective', 'Status'] },
  { name: 'FACTS_DAILY', color: '#cc0000',
    headers: ['Date', 'CampaignID', 'Spend', 'Impressions', 'Clicks', 'Conversions'] },
  { name: 'ALERTS_LOG',  color: '#e69138',
    headers: ['Timestamp', 'RuleID', 'ClientID', 'CampaignID', 'Severity', 'Message', 'Status', 'AckedBy'] },
  { name: 'SEED_MAP',    color: '#38761d',
    headers: ['EventID', 'ClientID', 'CampaignID', 'Window', 'Measured', 'RulesExpected'] }
];

function pa1RepairTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PA1_TABS.forEach(function (spec) {
    var sh = ss.getSheetByName(spec.name) || ss.insertSheet(spec.name);
    sh.setTabColor(spec.color);
    var h = sh.getRange(1, 1, 1, spec.headers.length);
    h.setValues([spec.headers])
     .setFontWeight('bold')
     .setBackground('#333333')
     .setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });
  SpreadsheetApp.getActive().toast(
    PA1_TABS.length + ' tabs ready. If you have not yet, import the demo_data CSVs (Insert new sheet).',
    'PA1', 8);
}
