// Build SampleSetup.zip: ExampleChecklist.xlsx at root + Examples/*.png.
// Store-only (no compression) — valid ZIP, zero dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

function entry(name, data) {
  return { name: Buffer.from(name), data, crc: crc32(data) >>> 0 };
}
function leUint(n, bytes) {
  const b = Buffer.alloc(bytes);
  if (bytes === 2) b.writeUInt16LE(n); else b.writeUInt32LE(n);
  return b;
}
function build(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const header = Buffer.concat([
      leUint(0x04034b50, 4), leUint(20, 2), leUint(0, 2), leUint(0, 2),
      leUint(0, 2), leUint(0, 2), leUint(e.crc, 4),
      leUint(e.data.length, 4), leUint(e.data.length, 4),
      leUint(e.name.length, 2), leUint(0, 2), e.name, e.data,
    ]);
    locals.push(header);
    central.push(Buffer.concat([
      leUint(0x02014b50, 4), leUint(20, 2), leUint(20, 2), leUint(0, 2),
      leUint(0, 2), leUint(0, 2), leUint(0, 2), leUint(e.crc, 4),
      leUint(e.data.length, 4), leUint(e.data.length, 4), leUint(e.name.length, 2),
      leUint(0, 2), leUint(0, 2), leUint(0, 2), leUint(0, 2), leUint(0, 4),
      leUint(offset, 4), e.name,
    ]));
    offset += header.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.concat([
    leUint(0x06054b50, 4), leUint(0, 2), leUint(0, 2),
    leUint(entries.length, 2), leUint(entries.length, 2),
    leUint(centralBuf.length, 4), leUint(offset, 4), leUint(0, 2),
  ]);
  return Buffer.concat([...locals, centralBuf, end]);
}

const entries = [
  entry('SampleChecklist.xlsx', readFileSync('SampleChecklist.xlsx')),
  entry('Examples/a08-weather-seal.png', readFileSync('examples/a08-weather-seal.png')),
  entry('Examples/a10-cwt-safety.png', readFileSync('examples/a10-cwt-safety.png')),
];
writeFileSync('SampleSetup.zip', build(entries));
console.log('Wrote SampleSetup.zip');
