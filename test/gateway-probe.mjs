// gateway-probe.mjs — decide whether a gateway rejection is the disguise or the
// gateway itself, WITHOUT going through DSH. It builds the request by hand so
// nothing in the harness can be blamed, and can compare a masqueraded call
// against a bare one, direct egress against a proxied one.
//
// This exists because the failure it diagnoses is systematically misread:
// new-api-family relays (anyrouter, agentrouter, …) answer 503 — or 429 with a
// bare "Service Unavailable" — whenever their upstream channel pool is empty,
// and they answer a REAL Claude Code CLI exactly the same way. Header tuning
// cannot fix that, so confirm which side is broken before touching presets.
//
// Usage:
//   node test/gateway-probe.mjs --host anyrouter.top --key sk-… [options]
//   node test/gateway-probe.mjs --host anyrouter.top --key-env ANYROUTER_API_KEY
//
// Options:
//   --host <name>      gateway hostname (no scheme)               [required]
//   --key <token>      API key/token                              (or --key-env)
//   --key-env <VAR>    read the key from this environment variable
//   --model <id>       model to request         [claude-opus-4-8]
//   --path <path>      request path                 [/v1/messages]
//   --auth <mode>      x-api-key | bearer | both            [both]
//   --proxy <h:p>      also try through this HTTP proxy (CONNECT)
//   --reps <n>         repeats per case, to expose flapping     [2]
//   --bare             also send a no-disguise request, for contrast
import net from 'node:net';
import tls from 'node:tls';

function parseArgs(argv) {
  const out = { auth: 'both', model: 'claude-opus-4-8', path: '/v1/messages', reps: 2, bare: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--host') out.host = next();
    else if (a === '--key') out.key = next();
    else if (a === '--key-env') out.keyEnv = next();
    else if (a === '--model') out.model = next();
    else if (a === '--path') out.path = next();
    else if (a === '--auth') out.auth = next();
    else if (a === '--proxy') out.proxy = next();
    else if (a === '--reps') out.reps = Number(next());
    else if (a === '--bare') out.bare = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.host) {
  console.log('usage: node test/gateway-probe.mjs --host <gateway> (--key <token> | --key-env <VAR>) [--model id] [--path p] [--auth x-api-key|bearer|both] [--proxy host:port] [--reps n] [--bare]');
  process.exit(args.help ? 0 : 1);
}
const KEY = args.key ?? (args.keyEnv ? process.env[args.keyEnv] : undefined);
if (!KEY) {
  console.error('error: no key. Pass --key, or --key-env NAME with that variable set.');
  process.exit(1);
}

/** The claude-code preset this plugin writes; keep in sync with index.js. */
const CLAUDE_CLI_VERSION = '2.1.241';
const DISGUISE = {
  'user-agent': 'claude-cli/' + CLAUDE_CLI_VERSION + ' (external, cli)',
  'anthropic-client': 'claude-code/' + CLAUDE_CLI_VERSION,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,advisor-tool-2026-03-01,effort-2025-11-24',
  'anthropic-dangerous-direct-browser-access': 'true',
  'x-app': 'cli',
  'x-stainless-package-version': '0.112.1',
  'x-stainless-os': 'Windows',
  'x-stainless-arch': 'x64',
  'x-stainless-lang': 'js',
  'x-stainless-runtime': 'node',
  'x-stainless-runtime-version': 'v26.3.0'
};
/** No disguise at all: only what the protocol itself requires. */
const BARE = { 'anthropic-version': '2023-06-01', 'user-agent': 'node' };

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
async function post({ host, path, headers, body, proxy }) {
  const raw = proxy ? await proxyTunnel(host, 443, proxy) : await directSocket(host, 443);
  const sock = tls.connect({ socket: raw, servername: host, ALPNProtocols: ['http/1.1'] });
  await new Promise((res, rej) => {
    sock.once('secureConnect', res);
    sock.once('error', rej);
    sock.setTimeout(25000, () => rej(new Error('tls handshake timeout')));
  });
  const payload = Buffer.from(body, 'utf8');
  const lines = [
    `POST ${path} HTTP/1.1`, `Host: ${host}`, 'connection: close',
    'accept: application/json', 'accept-encoding: identity',
    'content-type: application/json', `content-length: ${payload.length}`
  ];
  for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
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
  return { code: m ? m[1] : '???', body: (i === -1 ? '' : text.slice(i + 4)).replace(/\s+/g, ' ').slice(0, 160) };
}

const body = JSON.stringify({
  model: args.model, max_tokens: 16,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: PONG' }] }]
});

const authModes = args.auth === 'both' ? ['x-api-key', 'bearer'] : [args.auth];
const routes = args.proxy
  ? [{ label: 'proxied', proxy: args.proxy }, { label: 'direct ', proxy: undefined }]
  : [{ label: 'direct ', proxy: undefined }];
const presets = args.bare ? [['disguised', DISGUISE], ['bare     ', BARE]] : [['disguised', DISGUISE]];

const cases = [];
for (const [pName, preset] of presets) {
  for (const mode of authModes) {
    for (const route of routes) {
      cases.push({ label: `${pName} / ${mode.padEnd(9)} / ${route.label}`, preset, mode, proxy: route.proxy });
    }
  }
}

console.log(`probing https://${args.host}${args.path}  model=${args.model}  key=${KEY.slice(0, 8)}…\n`);
const results = new Map(cases.map((c) => [c.label, []]));
// Round-robin the repeats so a rolling outage cannot masquerade as a header effect.
for (let r = 0; r < Math.max(1, args.reps); r++) {
  for (const c of cases) {
    const headers = { ...c.preset };
    if (c.mode === 'x-api-key') headers['x-api-key'] = KEY;
    else headers['authorization'] = `Bearer ${KEY}`;
    try {
      const res = await post({ host: args.host, path: args.path, headers, body, proxy: c.proxy });
      results.get(c.label).push(res.code);
      if (r === 0) console.log(`  ${c.label} -> ${res.code}  ${res.body}`);
    } catch (e) {
      results.get(c.label).push('ERR');
      if (r === 0) console.log(`  ${c.label} -> ERROR ${e.message}`);
    }
  }
}

console.log('\n=== status per case ===');
for (const [label, codes] of results) console.log(`${label} [${codes.join(' ')}]`);

const all = [...results.values()].flat();
const anyOk = all.includes('200');
const allSame = new Set(all).size === 1;
console.log('\n=== verdict ===');
if (anyOk) {
  console.log('At least one variant returned 200 — the route works; compare the cases above to see which header set the gateway accepts.');
} else if (allSame && (all[0] === '503' || all[0] === '429')) {
  console.log(`Every variant returned ${all[0]}, including ones with different auth/headers.`);
  console.log('That is gateway-side state (no free upstream channel), NOT a disguise problem.');
  console.log('Cross-check by putting the SAME key into Claude Code; if it also fails, wait or switch model/route.');
} else {
  console.log('Mixed results — the differing cases above isolate what the gateway reacts to.');
}
