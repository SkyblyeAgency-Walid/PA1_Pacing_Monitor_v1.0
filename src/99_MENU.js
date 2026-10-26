/**
 * PA1 - CUSTOM MENU
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Pacing Monitor')
    .addItem('Run daily monitor', 'pa1RunDailyMonitor')
    .addItem('Re-send digest', 'pa1ResendDigest')
    .addSeparator()
    .addItem('Repair tabs', 'pa1RepairTabs')
    .addToUi();
}
