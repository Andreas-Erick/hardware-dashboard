const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrashGuard, windowsProtection } = require('../src/scan/trash-guard');

const guard = createTrashGuard(windowsProtection({
  env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramData: 'C:\\ProgramData' },
  home: 'C:\\Users\\sam',
  appData: 'C:\\Users\\sam\\AppData\\Roaming',
}));
const scanOfC = { root: 'C:\\', running: false };

test('items inside a finished scan may go to the Recycle Bin', () => {
  assert.equal(guard('C:\\Users\\sam\\Videos\\old.mkv', scanOfC), null);
  assert.equal(guard('C:\\Games\\Big Game', scanOfC), null);
});

test('drive roots, Windows folders and the user profile itself are refused', () => {
  assert.match(guard('D:\\', { root: 'D:\\x', running: false }), /whole drive/);
  assert.match(guard('C:\\Windows\\System32', scanOfC), /managed by Windows/);
  assert.match(guard('c:\\program files\\App', scanOfC), /managed by Windows/);
  assert.match(guard('C:\\ProgramData', scanOfC), /managed by Windows/);
  assert.match(guard('C:\\Users', scanOfC), /has to stay/);
  assert.match(guard('C:\\Users\\Sam', scanOfC), /has to stay/);
  assert.match(guard('C:\\Users\\sam\\AppData\\Local', scanOfC), /has to stay/);
  assert.match(guard('C:\\pagefile.sys', scanOfC), /system item/);
  assert.match(guard('D:\\$Recycle.Bin', { root: 'D:\\', running: false }), /system item/);
});

test('a folder whose name only starts like a protected one is allowed', () => {
  assert.equal(guard('C:\\Windows.bak', scanOfC), null);
});

test('items outside the scan, relative paths and anything during a scan are refused', () => {
  assert.match(guard('C:\\x\\y', { root: 'D:\\', running: false }), /current scan/);
  assert.match(guard('C:\\x\\y', { root: null, running: false }), /current scan/);
  assert.match(guard('x\\y', scanOfC), /not valid/);
  assert.match(guard(42, scanOfC), /not valid/);
  assert.match(guard('C:\\x\\y', { root: 'C:\\', running: true }), /Wait for the scan/);
});
