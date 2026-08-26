// Correct multi-frame zstd session decoder (mirrors dsh-session-persistence-jsonl's
// scanZstdFrames) + llm/retry event scanner.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import { join } from 'node:path';

const ZSTD_MAGIC = 0xfd2fb528; // 28 b5 2f fd little-endian

/** Locate complete zstd frame ranges, mirroring the backend's own scanner. */
function scanFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return frames;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) return frames;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return frames;
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return frames;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return frames;
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames;
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

function decodeAll(p) {
  const buf = readFileSync(p);
  const frames = scanFrames(buf);
  let out = '';
  for (const f of frames) {
    try { out += zstdDecompressSync(buf.subarray(f.start, f.end)).toString('utf8'); } catch {}
  }
  return out;
}

const target = process.argv[2];
if (target) {
  const text = decodeAll(target);
  const lines = text.split('\n').filter(Boolean);
  const retries = [];
  const starts = [];
  let types = {};
  for (const l of lines) {
    let ev;
    try { ev = JSON.parse(l); } catch { continue; }
    types[ev.type] = (types[ev.type] || 0) + 1;
    if (ev.type === 'llm/retry' && ev.data) retries.push(ev.data);
    if (ev.type === 'llm/retry-started') starts.push(ev.data);
  }
  console.log(`=== ${target} ===`);
  console.log('lines:', lines.length, ' types:', JSON.stringify(types));
  console.log('llm/retry:', retries.length, ' retry-started:', starts.length);
  for (const r of retries.slice(0, 15)) {
    console.log(`  retry#${r.retry} provider=${r.provider} maxRetries=${r.maxRetries} delayMs=${r.delayMs}`);
  }
  const keys = new Set(retries.map((r) => r.policyKey));
  for (const k of keys) console.log('  policyKey:', String(k).slice(0, 300));
  process.exit(0);
}

// Scan all sessions
const ROOT = 'C:/Users/ad/.dsh/sessions';
const dirs = [];
for (const top of readdirSync(ROOT)) {
  const tp = join(ROOT, top);
  if (!statSync(tp).isDirectory()) continue;
  for (const s of readdirSync(tp)) {
    const sp = join(tp, s);
    if (!statSync(sp).isDirectory()) continue;
    for (const f of readdirSync(sp)) {
      if (!f.endsWith('.jsonl.zstd')) continue;
      const p = join(sp, f);
      dirs.push({ p, mtime: statSync(p).mtimeMs });
    }
  }
}
dirs.sort((a, b) => b.mtime - a.mtime);
let totalRetry = 0;
for (const { p } of dirs.slice(0, 12)) {
  let text;
  try { text = decodeAll(p); } catch { continue; }
  let retries = 0;
  const any = [];
  for (const l of text.split('\n')) {
    if (l.includes('llm/retry')) retries += 1;
    if (/anyrouter/i.test(l)) any.push(l.slice(0, 200));
  }
  if (retries > 0 || any.length > 0) {
    totalRetry += retries;
    console.log(`SESSION ${p.split(/[\\/]/).slice(-2).join('/')} llm/retry=${retries} anyrouter=${any.length}`);
    for (const a of any.slice(0, 3)) console.log('   ', a);
  }
}
console.log('total llm/retry across scanned:', totalRetry);
