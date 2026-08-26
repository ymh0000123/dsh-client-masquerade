// queue-poll.mjs — verify anyrouter's queueing behaviour: keep requesting with
// exponential backoff (the same shape the dsh-llm-retry plugin uses) and see
// whether a 200 eventually arrives. Also prints response headers on the first
// few attempts to check for Retry-After. This validates the retryPolicy values
// we write into the provider profile.
import net from 'node:net';
import tls from 'node:tls';

const PROXY = { host: '127.0.0.1', port: 7890 };

function tunnel(host, port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PROXY.port, PROXY.host, () => {
      sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    let buf = '';
    const onData = (d) => {
      buf += d.toString('latin1');
      if (!buf.includes('\r\n\r\n')) return;
      sock.removeListener('data', onData);
      if (!/ 200 /.test(buf.split('\r\n')[0])) return reject(new Error('CONNECT refused'));
      resolve(sock);
    };
    sock.on('data', onData);
    sock.on('error', reject);
    sock.setTimeout(25000, () => reject(new Error('timeout')));
  });
}

async function post(host, path, headers, body) {
  const raw = await tunnel(host, 443);
  const sock = tls.connect({ socket: raw, servername: host, ALPNProtocols: ['http/1.1'] });
  await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
  const payload = Buffer.from(body, 'utf8');
  const lines = [`POST ${path} HTTP/1.1`, `Host: ${host}`, 'connection: close', 'accept: application/json', 'accept-encoding: identity', `content-length: ${payload.length}`];
  for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
  sock.write(lines.join('\r\n') + '\r\n\r\n');
  sock.write(payload);
  const chunks = [];
  await new Promise((res) => {
    sock.on('data', (d) => chunks.push(d));
    sock.on('end', res); sock.on('close', res); sock.on('error', res);
    sock.setTimeout(150000, () => { sock.destroy(); res(); });
  });
  const buf = Buffer.concat(chunks);
  const i = buf.indexOf('\r\n\r\n');
  const head = i === -1 ? buf.toString('latin1') : buf.slice(0, i).toString('latin1');
  const m = /HTTP\/1\.1 (\d{3})/.exec(head);
  return {
    code: m ? m[1] : '???',
    head: head,
    body: (i === -1 ? '' : buf.slice(i + 4).toString('utf8')).replace(/\s+/g, ' ').slice(0, 140)
  };
}

const KEY = process.env.ANYROUTER_API_KEY;
if (!KEY) { console.error('set ANYROUTER_API_KEY'); process.exit(1); }
const MODEL = process.argv[2] || 'claude-opus-4-8';
const MAX_ATTEMPTS = Number(process.argv[3] || 12);
const INITIAL = 1500, MAX_DELAY = 30000, JITTER = 0.3;

const headers = {
  'content-type': 'application/json',
  'accept': 'application/json',
  'x-api-key': KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,advisor-tool-2026-03-01,effort-2025-11-24',
  'user-agent': 'claude-cli/2.1.241 (external, cli)',
  'x-app': 'cli',
  'x-stainless-package-version': '0.112.1',
  'x-stainless-os': 'Windows',
  'x-stainless-arch': 'x64',
  'x-stainless-lang': 'js',
  'x-stainless-runtime': 'node',
  'x-stainless-runtime-version': 'v26.3.0'
};
const body = JSON.stringify({ model: MODEL, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with exactly: PONG' }] });

const start = Date.now();
let ok = null;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const t0 = Date.now();
  try {
    const r = await post('anyrouter.top', '/v1/messages?beta=true', headers, body);
    const ms = Date.now() - t0;
    console.log(`[${new Date().toISOString().slice(11, 19)}] #${attempt} -> ${r.code} (${ms}ms)  ${r.body}`);
    if (attempt <= 2) {
      const retryAfter = /retry-after:\s*([^\r\n]+)/i.exec(r.head);
      console.log(`    retry-after: ${retryAfter ? retryAfter[1] : '(none)'}`);
    }
    if (r.code === '200') { ok = { attempt, ms, body: r.body }; break; }
  } catch (e) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] #${attempt} -> ERROR ${e.message}`);
  }
  if (attempt < MAX_ATTEMPTS) {
    const exponent = Math.min(attempt - 1, 16);
    const exp = Math.min(INITIAL * 2 ** exponent, MAX_DELAY);
    const jitter = 1 - JITTER + 2 * JITTER * Math.random();
    const delay = Math.min(exp * jitter, MAX_DELAY);
    console.log(`    waiting ${Math.round(delay)}ms …`);
    await new Promise((res) => setTimeout(res, delay));
  }
}
const total = ((Date.now() - start) / 1000).toFixed(1);
if (ok) console.log(`\nSUCCESS on attempt ${ok.attempt} after ${total}s: ${ok.body}`);
else console.log(`\nNO SUCCESS in ${MAX_ATTEMPTS} attempts over ${total}s — queue longer than the window, or genuinely down.`);
