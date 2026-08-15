'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('host entry loads without synchronously requiring ESM peers', () => {
  const plugin = require('..');

  assert.equal(plugin.name, 'dsh-client-masquerade');
  assert.equal(plugin.apply.constructor.name, 'AsyncFunction');
  assert.deepEqual(plugin.inject, ['settings', 'tools', 'llm', 'webServer']);
});
