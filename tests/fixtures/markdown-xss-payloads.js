module.exports = [
  {
    name: 'raw script',
    input: '<script>alert(1)</script>',
    mustNotContain: ['<script>', '</script>'],
  },
  {
    name: 'javascript link',
    input: '[click](javascript:alert(1))',
    mustNotContain: ['[click](javascript:alert(1))'],
  },
  {
    name: 'mixed case javascript link',
    input: '[click](JavaScript:alert(1))',
    mustNotContain: ['[click](JavaScript:alert(1))'],
  },
  {
    name: 'control-prefixed javascript link',
    input: '[click]( \u0000\tjavascript:alert(1))',
    mustNotContain: ['[click]( \u0000\tjavascript:alert(1))'],
  },
  {
    name: 'raw image',
    input: '<img src=x onerror=alert(1)>',
    mustNotContain: ['<img src=x onerror=alert(1)>'],
  },
  {
    name: 'raw event handler',
    input: '<div onclick="alert(1)">x</div>',
    mustNotContain: ['<div onclick="alert(1)">'],
  },
  {
    name: 'arrow',
    input: 'Suspicious login → lateral movement',
    mustNotContain: [],
  },
  {
    name: 'cjk',
    input: 'Attacker hostname: .example',
    mustNotContain: [],
  },
  {
    name: 'emoji',
    input: 'Critical alert 🚨 received',
    mustNotContain: [],
  },
  {
    name: 'smart-quote',
    input: 'The attacker’s “payload” included a €5 transfer',
    mustNotContain: [],
  },
];
