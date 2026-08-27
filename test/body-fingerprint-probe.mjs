// body-fingerprint-probe.mjs — find out whether a relay gates on the request
// BODY, and whether this plugin's body masquerade clears that gate.
//
// Why this exists: anyrouter-family relays (new-api derivatives) answer a bare
// 429/503 "Service Unavailable" for two unrelated reasons — their upstream
// channel pool is busy, or their Claude Code check rejected the request body.
// The status line looks identical either way, which is exactly how a route that
// will NEVER recover gets misread as one that just needs more retries. This
// probe separates them by ablation: it sends the same request several times,
// removing one Claude Code trait at a time, and reports which trait the relay
// actually reacts to.
//
// It builds every request by hand, so nothing in DSH can be blamed for the
// result, and it interleaves the variants round-robin so a rolling outage
// cannot masquerade as a body effect. A control request is sent first and last;
// if those two disagree, the run is discarded as unreliable rather than
// reported as a finding.
//
// Usage:
//   node test/body-fingerprint-probe.mjs --host anyrouter.top --key sk-…
//   node test/body-fingerprint-probe.mjs --host anyrouter.top --key-env ANYROUTER_API_KEY --proxy 127.0.0.1:7890
//
// Options:
//   --host <name>     relay hostname, no scheme                     [required]
//   --key <token>     API key                                    (or --key-env)
//   --key-env <VAR>   read the key from this environment variable
//   --model <id>      model to request                     [claude-opus-5]
//   --path <path>     request path                          [/v1/messages]
//   --proxy <h:p>     send through this HTTP proxy (CONNECT)
//   --auth <mode>     bearer | x-api-key                            [bearer]
import net from 'node:net';
import tls from 'node:tls';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FINGERPRINT = require('../patches/claude-code-fingerprint.js');

function parseArgs(argv) {
  const out = { model: 'claude-opus-5', path: '/v1/messages', auth: 'bearer' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--host') out.host = next();
    else if (a === '--key') out.key = next();
    else if (a === '--key-env') out.keyEnv = next();
    else if (a === '--model') out.model = next();
    else if (a === '--path') out.path = next();
    else if (a === '--proxy') out.proxy = next();
    else if (a === '--auth') out.auth = next();
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.host) {
  console.log('usage: node test/body-fingerprint-probe.mjs --host <relay> (--key <token> | --key-env <VAR>) [--model id] [--path p] [--proxy host:port] [--auth bearer|x-api-key]');
  process.exit(args.help ? 0 : 1);
}
const KEY = args.key ?? (args.keyEnv ? process.env[args.keyEnv] : undefined);
if (!KEY) {
  console.error('error: no key. Pass --key, or --key-env NAME with that variable set.');
  process.exit(1);
}

/** The claude-code header preset this plugin writes; keep in sync with index.js. */
const CLAUDE_CLI_VERSION = '2.1.241';
const HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json',
  'user-agent': `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,advisor-tool-2026-03-01,effort-2025-11-24',
  'anthropic-dangerous-direct-browser-access': 'true',
  'x-app': 'cli',
  'x-stainless-package-version': '0.112.1',
  'x-stainless-os': 'Windows',
  'x-stainless-arch': 'x64',
  'x-stainless-lang': 'js',
  'x-stainless-runtime': 'node',
  'x-stainless-runtime-version': 'v26.3.0',
  'x-stainless-retry-count': '0',
  'x-stainless-timeout': '600'
};

function proxyTunnel(host, port, proxy) {
  const [ph, pp] = proxy.split(':');
  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(pp), ph, () => {
      sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    let buf = '';
    const onData = (d) => {
      buf += d.toString('latin1');
      if (!buf.includes('\r\n\r\n')) return;
      sock.removeListener('data', onData);
      const line = buf.split('\r\n')[0];
      if (!/ 200 /.test(line)) return reject(new Error('proxy CONNECT refused: ' + line));
      resolve(sock);
    };
    sock.on('data', onData);
    sock.on('error', reject);
    sock.setTimeout(25000, () => { sock.destroy(); reject(new Error('proxy connect timeout')); });
  });
}

function directSocket(host, port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, host, () => resolve(sock));
    sock.on('error', reject);
    sock.setTimeout(25000, () => { sock.destroy(); reject(new Error('connect timeout')); });
  });
}

/** One hand-built HTTPS POST; returns the status code and a body excerpt. */
async function post(body) {
  const raw = args.proxy ? await proxyTunnel(args.host, 443, args.proxy) : await directSocket(args.host, 443);
  const sock = tls.connect({ socket: raw, servername: args.host, ALPNProtocols: ['http/1.1'] });
  await new Promise((res, rej) => {
    sock.once('secureConnect', res);
    sock.once('error', rej);
    sock.setTimeout(25000, () => rej(new Error('tls handshake timeout')));
  });
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const auth = args.auth === 'x-api-key' ? `x-api-key: ${KEY}` : `authorization: Bearer ${KEY}`;
  const lines = [
    `POST ${args.path} HTTP/1.1`, `Host: ${args.host}`, 'connection: close',
    'accept-encoding: identity', `content-length: ${payload.length}`, auth
  ];
  for (const [k, v] of Object.entries(HEADERS)) lines.push(`${k}: ${v}`);
  sock.write(lines.join('\r\n') + '\r\n\r\n');
  sock.write(payload);
  const chunks = [];
  await new Promise((res) => {
    sock.on('data', (d) => chunks.push(d));
    sock.on('end', res); sock.on('close', res); sock.on('error', res);
    sock.setTimeout(120000, () => { sock.destroy(); res(); });
  });
  const text = Buffer.concat(chunks).toString('utf8');
  const i = text.indexOf('\r\n\r\n');
  const head = i === -1 ? text : text.slice(0, i);
  const m = /HTTP\/1\.1 (\d{3})/.exec(head);
  const excerpt = (i === -1 ? '' : text.slice(i + 4)).replace(/\s+/g, ' ').slice(0, 70);
  return { code: m ? m[1] : '???', excerpt: m && m[1] === '200' ? '' : excerpt };
}

const MESSAGES = [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: PONG' }] }];
const IDENTITY = { type: 'text', text: FINGERPRINT.identitySystemBlock };
const METADATA = { user_id: JSON.stringify({ device_id: 'body-fingerprint-probe', account_uuid: '', session_id: '00000000-1111-4222-8333-444444444444' }) };
/** Tools a harness might advertise — realistic, but not Claude Code's. */
const HARNESS_TOOLS = [
  { name: 'bash', description: 'Run a shell command.', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { name: 'str_replace_editor', description: 'Edit a file by string replacement.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }
];

/** Everything the plugin's body masquerade injects, on top of a harness request. */
const full = () => ({
  model: args.model, messages: MESSAGES, max_tokens: 1024, stream: true,
  system: [IDENTITY, { type: 'text', text: 'You are a helpful assistant running inside a harness.' }],
  metadata: METADATA,
  tools: [...HARNESS_TOOLS, ...FINGERPRINT.sentinelTools]
});

const drop = (mutate) => { const body = full(); mutate(body); return body; };

const VARIANTS = [
  { key: 'control', label: 'full masquerade (control)   ', body: full, expect: 'the shape this plugin sends when body masquerade is on' },
  { key: 'no-metadata', label: 'without metadata            ', body: () => drop((b) => { delete b.metadata; }), expect: 'metadata.user_id' },
  { key: 'plain-metadata', label: 'metadata as a plain string  ', body: () => drop((b) => { b.metadata = { user_id: 'harness-user' }; }), expect: 'metadata.user_id must be JSON' },
  { key: 'nonuuid-session', label: 'session_id not UUID-shaped  ', body: () => drop((b) => { b.metadata = { user_id: JSON.stringify({ device_id: 'd', account_uuid: '', session_id: 'harness-session-1' }) }; }), expect: 'session_id must look like a UUID' },
  { key: 'no-identity', label: 'without the identity block  ', body: () => drop((b) => { b.system = b.system.slice(1); }), expect: 'client-identity system block' },
  { key: 'no-sentinels', label: 'without the sentinel tools  ', body: () => drop((b) => { b.tools = HARNESS_TOOLS; }), expect: 'verbatim tool definitions' },
  { key: 'renamed-sentinels', label: 'sentinel tools renamed      ', body: () => drop((b) => { b.tools = [...HARNESS_TOOLS, ...FINGERPRINT.sentinelTools.map((t) => ({ ...t, name: 'X' + t.name }))]; }), expect: 'tool NAMES are checked' },
  // As measured, descriptions are NOT part of the fingerprint — this variant is
  // here to catch a relay that starts checking them, which would otherwise show
  // up as an unexplained 429 long after the fingerprint was captured.
  { key: 'blank-sentinels', label: 'sentinel descriptions wiped ', body: () => drop((b) => { b.tools = [...HARNESS_TOOLS, ...FINGERPRINT.sentinelTools.map((t) => ({ ...t, description: 'x'.repeat(t.description.length) }))]; }), expect: 'tool DESCRIPTIONS are checked too (they were not when this was captured — re-capture the fingerprint)' },
  { key: 'bare', label: 'bare harness request        ', body: () => ({ model: args.model, messages: MESSAGES, max_tokens: 1024, stream: true, tools: HARNESS_TOOLS }), expect: 'what DSH sends with no body masquerade' }
];

console.log(`probing https://${args.host}${args.path}  model=${args.model}  key=${KEY.slice(0, 8)}…${args.proxy ? '  via ' + args.proxy : ''}`);
console.log(`sentinel tools: ${FINGERPRINT.sentinelTools.map((t) => t.name).join(', ')}  (captured from ${FINGERPRINT.capturedFrom})\n`);

const results = new Map();
// Control first and last: if the relay's mood changed mid-run, say so instead
// of reporting the drift as a body-shape finding.
const controlFirst = await post(full()).catch((e) => ({ code: 'ERR', excerpt: e.message }));
for (const v of VARIANTS) {
  try {
    const r = await post(v.body());
    results.set(v.key, r);
    console.log(`  ${v.label} -> ${r.code} ${r.code === '200' ? 'accepted' : r.excerpt}`);
  } catch (e) {
    results.set(v.key, { code: 'ERR', excerpt: e.message });
    console.log(`  ${v.label} -> ERROR ${e.message}`);
  }
}
const controlLast = await post(full()).catch((e) => ({ code: 'ERR', excerpt: e.message }));

console.log('\n=== verdict ===');
if (controlFirst.code !== controlLast.code) {
  console.log(`Control returned ${controlFirst.code} before the run and ${controlLast.code} after it.`);
  console.log('The relay changed state mid-probe, so the per-variant results above are not comparable. Re-run.');
  process.exit(2);
}

const control = results.get('control');
if (control?.code === '200') {
  const gates = VARIANTS.filter((v) => v.key !== 'control' && results.get(v.key)?.code !== '200');
  console.log(`Body masquerade is ACCEPTED by this relay (control ${control.code}).`);
  if (gates.length === 0) {
    console.log('No ablation changed the outcome, so this relay does not appear to fingerprint the body.');
    console.log('It accepts a bare harness request too — any failures you see are the channel pool, not the disguise.');
  } else {
    console.log('It rejects the same request once any of these is removed, so it DOES fingerprint the body:');
    for (const v of gates) console.log(`  ${results.get(v.key).code}  <- ${v.expect}`);
    console.log('\nEnable it for the route:  mask_client action=body state=on provider=<id>');
    console.log('then apply the patch and restart dsh web:  mask_client action=patch');
  }
} else if (control?.code === 'ERR') {
  console.log(`Could not reach the relay (${control.excerpt}). Check --host, --proxy and network access.`);
} else {
  const bare = results.get('bare');
  console.log(`Body masquerade did NOT clear the gate here (control ${control?.code}, bare harness request ${bare?.code}).`);
  if (control?.code === bare?.code) {
    console.log('Both shapes get the same answer, so the body is not what this relay is reacting to.');
    console.log('Most likely its upstream channel pool is genuinely empty — cross-check by putting the SAME key');
    console.log('into Claude Code (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN); if that fails too, wait or switch route.');
  } else {
    console.log('The two shapes differ, so the body matters — but the captured fingerprint no longer satisfies this relay.');
    console.log('Claude Code has most likely changed its tool descriptions since patches/claude-code-fingerprint.js was captured;');
    console.log('re-capture it from a current claude-cli run (see README, "刷新指纹").');
  }
}
