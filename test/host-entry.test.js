'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('host entry loads without synchronously requiring ESM peers', () => {
  const plugin = require('..');

  assert.equal(plugin.name, 'dsh-client-masquerade');
  assert.equal(plugin.apply.constructor.name, 'AsyncFunction');
  assert.deepEqual(plugin.inject, ['settings', 'tools', 'llm', 'webServer']);
});

// Regression guard: both host halves must ship a real user-agent in every
// preset. Without it, User-Agent-fingerprinting gateways (agentrouter et al.)
// keep seeing "deepseek-harness/..." and reject the disguised request.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ROOT = join(__dirname, '..');

const PRESET_USER_AGENTS = {
  claudeCode: 'claude-cli/2.0.0 (external, cli)',
  codex: 'codex-tui/0.145.0'
};

for (const [variant, file] of [['index.js', 'index.js'], ['host.body.js', 'host.body.js']]) {
  test(`${variant} claude-code preset ships the real claude-cli user-agent`, () => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const block = src.slice(src.indexOf("'claude-code':"), src.indexOf("'codex':"));
    assert.ok(block.includes(`'user-agent': '${PRESET_USER_AGENTS.claudeCode}'`),
      `${file}: claude-code preset must include user-agent ${PRESET_USER_AGENTS.claudeCode}`);
  });
  test(`${variant} codex preset ships the real codex-tui user-agent`, () => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(src.includes(`'user-agent': '${PRESET_USER_AGENTS.codex}`),
      `${file}: codex preset must include user-agent starting with ${PRESET_USER_AGENTS.codex}`);
  });
}
