const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('gitignore protects desktop sync configuration', () => {
  assert.match(fs.readFileSync('.gitignore', 'utf8'), /^ir-logger-sync\.json$/m);
});
