const { describe, it } = require('node:test');
const assert = require('node:assert');
const cases = require('../fixtures/markdown-xss-payloads.js');

describe('markdown.mjs XSS fixture', () => {
  let renderToHtml;

  it('loads the markdown module', async () => {
    const mod = await import('../../public/js/markdown.mjs');
    renderToHtml = mod.renderToHtml;
    assert.strictEqual(typeof renderToHtml, 'function');
  });

  for (const c of cases) {
    it(`renders ${c.name} safely`, () => {
      const html = renderToHtml(c.input);
      for (const forbidden of c.mustNotContain) {
        assert.ok(!html.includes(forbidden), `Output contained forbidden substring for "${c.name}": ${forbidden}`);
      }
    });
  }
});
