// dsh-client-masquerade — loader for tooling.
// Exposes the two paste-ready dynamic-plugin bodies plus package metadata.
// `code.host` and `code.client` are exactly what the Dynamic Plugin dialog
// accepts (each is the body of the async function the runner wraps).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const readBody = (name) => {
  // Strip the leading comment block so tooling pastes pure code.
  const raw = fs.readFileSync(path.join(__dirname, name), 'utf8');
  return raw.replace(/^\/\/[^\n]*\n+/, '');
};

module.exports = {
  name: 'dsh-client-masquerade',
  purpose: 'Make a custom llm-pi-ai provider masquerade as Claude Code / Codex by injecting spoofed client-identity headers into its profile settings.',
  code: {
    host: readBody('host.body.js'),
    client: readBody('client.body.js')
  }
};
