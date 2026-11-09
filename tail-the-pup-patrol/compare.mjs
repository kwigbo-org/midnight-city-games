// Compare two recordings of one run, tick by tick, and their verdicts.
//
//   node compare.mjs rules.json a.json b.json
//
// Prints a JSON report. Readings are matched by sequence number; a difference is any tick on
// which the two disagree about the dog or about an agent both could see.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge } from './judge.mjs';

const key = (p) => (p ? `${p.spaceId}:${p.x},${p.y}` : '-');

export function compare(rules, a, b, { grid } = {}) {
  const A = new Map(a.readings.map((r) => [r.seq, r])), B = new Map(b.readings.map((r) => [r.seq, r]));
  const both = [...A.keys()].filter((s) => B.has(s));
  let dog = 0, agents = 0;
  const examples = [];
  for (const s of both) {
    const x = A.get(s), y = B.get(s);
    if (key(x.pup) !== key(y.pup)) { dog++; if (examples.length < 5) examples.push({ seq: s, dog: [key(x.pup), key(y.pup)] }); }
    for (const id of new Set([...Object.keys(x.agents ?? {}), ...Object.keys(y.agents ?? {})])) {
      if (key(x.agents?.[id]) !== key(y.agents?.[id])) { agents++; if (examples.length < 5) examples.push({ seq: s, id, agent: [key(x.agents?.[id]), key(y.agents?.[id])] }); }
    }
  }
  const brief = (v) => ({ status: v.status, startedAt: v.startedAt ?? null, endedAt: v.endedAt ?? null, players: (v.players ?? []).map((p) => [p.id, p.status, p.outAt, p.meanTail]) });
  const va = brief(judge(rules, a, { grid })), vb = brief(judge(rules, b, { grid }));
  return { ticks: { a: A.size, b: B.size, both: both.length, onlyA: A.size - both.length, onlyB: B.size - both.length },
    differences: { dog, agents }, examples, verdictsAgree: JSON.stringify(va) === JSON.stringify(vb), a: va, b: vb };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [rulesPath, aPath, bPath] = process.argv.slice(2);
  if (!bPath) { console.error('usage: node compare.mjs rules.json a.json b.json'); process.exit(2); }
  const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const rules = read(rulesPath);
  const grid = rules.map?.grid ? read(path.join(path.dirname(path.resolve(rulesPath)), rules.map.grid)) : null;
  console.log(JSON.stringify(compare(rules, read(aPath), read(bPath), { grid }), null, 2));
}
