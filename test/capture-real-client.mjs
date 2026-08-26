// Capture proxy: pose as the Anthropic API over plain HTTP on 127.0.0.1 so
// Claude Code (ANTHROPIC_BASE_URL=http://127.0.0.1:PORT) talks to us in the
// clear. We log its exact request line, headers and body, then forward the call
// verbatim to https://anyrouter.top through the corporate proxy and log the
// upstream status. This yields ground truth on what a WORKING client sends.
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { writeFileSync, appendFileSync } from 'node:fs';

const PORT = Number(process.argv[2] || 8788);
const UPSTREAM_HOST = process.argv[3] || 'anyrouter.top';
const LOG = process.argv[4] || 'E:/dsh/1/dsh-client-masquerade/test/capture.log';
const PROXY = { host: '127.0.0.1', port: 7890 };

writeFileSync(LOG, `# capture started ${new Date().toISOString()} -> ${UPSTREAM_HOST}\n`, 'utf8');
const log = (s) => { appendFileSync(LOG, s + '\n', 'utf8'); process.stdout.write(s + '\n'); };

function connectTunnel(host, port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PROXY.port, PROXY.host, () => {
      sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    let buf = '';
    const onData = (d) => {
      buf += d.toString('latin1');
      if (!buf.includes('\r\n\r\n')) return;
      sock.removeListener('data', onData);
      if (!/ 200 /.test(buf.split('\r\n')[0])) return reject(new Error('CONNECT failed: ' + buf.split('\r\n')[0]));
      resolve(sock);
    };
    sock.on('data', onData);
    sock.on('error', reject);
    sock.setTimeout(30000, () => reject(new Error('proxy connect timeout')));
  });
}

// Forward one request upstream over TLS, returning raw response text.
async function forward(method, path, headers, bodyBuf) {
  const raw = await connectTunnel(UPSTREAM_HOST, 443);
  const sock = tls.connect({ socket: raw, servername: UPSTREAM_HOST, ALPNProtocols: ['http/1.1'] });
  await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
  const lines = [`${method} ${path} HTTP/1.1`, `Host: ${UPSTREAM_HOST}`, 'connection: close'];
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding', 'proxy-connection'].includes(lower)) continue;
    if (Array.isArray(v)) { for (const item of v) lines.push(`${k}: ${item}`); continue; }
    lines.push(`${k}: ${v}`);
  }
  if (bodyBuf && bodyBuf.length) lines.push(`content-length: ${bodyBuf.length}`);
  lines.push('accept-encoding: identity');
  sock.write(lines.join('\r\n') + '\r\n\r\n');
  if (bodyBuf && bodyBuf.length) sock.write(bodyBuf);
  const chunks = [];
  await new Promise((res) => {
    sock.on('data', (d) => chunks.push(d));
    sock.on('end', res); sock.on('close', res); sock.on('error', res);
    sock.setTimeout(180000, () => { sock.destroy(); res(); });
  });
  return Buffer.concat(chunks);
}

let n = 0;
const server = http.createServer((req, res) => {
  const id = ++n;
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', async () => {
    const bodyBuf = Buffer.concat(chunks);
    log(`\n================ REQ #${id} ${req.method} ${req.url} ================`);
    for (const [k, v] of Object.entries(req.headers)) {
      const shown = /^(x-api-key|authorization)$/i.test(k) ? String(v).slice(0, 12) + '…REDACTED' : v;
      log(`  ${k}: ${shown}`);
    }
    let parsed = null;
    try { parsed = JSON.parse(bodyBuf.toString('utf8')); } catch { /* non-JSON */ }
    if (parsed) {
      const shape = {
        model: parsed.model,
        max_tokens: parsed.max_tokens,
        stream: parsed.stream,
        systemKind: Array.isArray(parsed.system) ? `array[${parsed.system.length}]` : typeof parsed.system,
        systemFirst: Array.isArray(parsed.system) ? String(parsed.system[0]?.text ?? '').slice(0, 90) : String(parsed.system ?? '').slice(0, 90),
        messages: Array.isArray(parsed.messages) ? parsed.messages.length : null,
        tools: Array.isArray(parsed.tools) ? parsed.tools.length : null,
        metadata: parsed.metadata,
        thinking: parsed.thinking,
        topLevelKeys: Object.keys(parsed)
      };
      log('  BODY-SHAPE ' + JSON.stringify(shape));
      log('  BODY-FULL  ' + bodyBuf.toString('utf8').slice(0, 4000));
    } else {
      log('  BODY(raw) ' + bodyBuf.toString('utf8').slice(0, 600));
    }

    try {
      const rawRes = await forward(req.method, req.url, req.headers, bodyBuf);
      const text = rawRes.toString('utf8');
      const idx = text.indexOf('\r\n\r\n');
      const head = idx === -1 ? text : text.slice(0, idx);
      const body = idx === -1 ? '' : text.slice(idx + 4);
      log(`  <== UPSTREAM ${head.split('\r\n')[0]}`);
      log('  <== BODY ' + body.slice(0, 500).replace(/\n/g, ' | '));
      const statusMatch = /HTTP\/1\.1 (\d{3})/.exec(head);
      const status = statusMatch ? Number(statusMatch[1]) : 502;
      const outHeaders = {};
      for (const line of head.split('\r\n').slice(1)) {
        const i = line.indexOf(':');
        if (i === -1) continue;
        const k = line.slice(0, i).trim().toLowerCase();
        if (['transfer-encoding', 'connection', 'content-length'].includes(k)) continue;
        outHeaders[k] = line.slice(i + 1).trim();
      }
      res.writeHead(status, outHeaders);
      res.end(body);
    } catch (e) {
      log('  <== FORWARD ERROR ' + e.message);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'capture proxy forward failed: ' + e.message } }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => log(`capture proxy listening on http://127.0.0.1:${PORT} -> https://${UPSTREAM_HOST}`));
