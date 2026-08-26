// Correctly decompress multi-frame zstd session files (createZstdDecompress
// handles concatenated frames) and scan for llm/retry + anyrouter step data.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createZstdDecompress } from 'node:zlib';
import { join } from 'node:path';

function decompressAll(p) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const d = createZstdDecompress();
    d.on('data', (c) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    d.on('error', reject);
    d.end(readFileSync(p));
  });
}

const ROOT = 'C:/Users/ad/.dsh/sessions';
const dirs = [];
for (const top of readdirSync(ROOT)) {
  const topPath = join(ROOT, top);
  if (!statSync(topPath).isDirectory()) continue;
  for (const s of readdirSync(topPath)) {
    const sPath = join(topPath, s);
    if (!statSync(sPath).isDirectory()) continue;
    for (const f of readdirSync(sPath)) {
      if (!f.endsWith('.jsonl.zstd')) continue;
      const p = join(sPath, f);
      dirs.push({ p, mtime: statSync(p).mtimeMs, size: statSync(p).size });
    }
  }
}
dirs.sort((a, b) => b.mtime - a.mtime);
const recent = dirs.slice(0, 10);

const policySummary = new Map();
let llmRetryTotal = 0;
let llmRetryStartedTotal = 0;

for (const { p, mtime, size } of recent) {
  let text;
  try { text = await decompressAll(p); } catch (e) { console.log(`SKIP ${p}: ${e.message}`); continue; }
  const lines = text.split('\n').filter(Boolean);
  const types = new Map();
  let llmRetry = 0, retryStarted = 0, anyrouterHits = 0;
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const t = ev.type || '?';
    types.set(t, (types.get(t) || 0) + 1);
    if (ev.type === 'llm/retry' && ev.data) {
      llmRetry += 1; llmRetryTotal += 1;
      const d = ev.data;
      const key = d.policyKey || 'unknown';
      const cur = policySummary.get(key) || { count: 0, providers: new Set() };
      cur.count += 1;
      cur.providers.add(d.provider || '?');
      policySummary.set(key, cur);
    } else if (ev.type === 'llm/retry-started') {
      retryStarted += 1; llmRetryStartedTotal += 1;
    }
    if (/anyrouter/i.test(line)) anyrouterHits += 1;
  }
  const interesting = llmRetry > 0 || retryStarted > 0 || anyrouterHits > 0;
  if (interesting) {
    console.log(`\nSESSION ${p.split(/[\\/]/).slice(-2).join('/')}  size=${size}  lines=${lines.length}`);
    console.log(`  mtime=${new Date(mtime).toISOString()}  llm/retry=${llmRetry} retry-started=${retryStarted} anyrouter-mentions=${anyrouterHits}`);
    console.log('  event types:', JSON.stringify([...types.entries()].slice(0, 25)));
  }
}

console.log('\n=== policyKey summary ===');
for (const [key, cur] of policySummary) {
  console.log(`count=${cur.count} providers=${[...cur.providers].join(',')} key=${key.slice(0, 220)}`);
}
console.log(`\ntotal llm/retry=${llmRetryTotal} retry-started=${llmRetryStartedTotal}`);
