// Build veterans.json: each agent's earlier Tail runs, keyed by sha256 of its agent id (never the id), from
// the judged run files (finished, void or unfinished) scheduled before rules.newcomer.seasonFrom. A run
// where the agent was lost or caught within quickExitSeconds doesn't count (judge.mjs countsAsRun).
//
//   node veterans.mjs <runs dir> > veterans.json
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { countsAsRun } from './judge.mjs';

const rules = JSON.parse(fs.readFileSync(new URL('./rules.json', import.meta.url), 'utf8'));
const NC = rules.newcomer, dir = process.argv[2];
if (!dir) { console.error('usage: node veterans.mjs <runs dir>'); process.exit(2); }
const key = (id) => createHash('sha256').update(String(id)).digest('hex');
const runs = {};
for (const f of fs.readdirSync(dir).filter((f) => /^\d{4}-\d\d-\d\d.*\.json$/.test(f)).sort()) {
  let r; try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (!r?.scheduled || r.scheduled.slice(0, 10) >= NC.seasonFrom) continue;
  if (!['finished', 'void', 'unfinished'].includes(r.result?.status)) continue;
  for (const p of r.result.players ?? []) if (countsAsRun(NC, p)) runs[key(p.id)] = (runs[key(p.id)] ?? 0) + 1;
}
const out = Object.fromEntries(Object.entries(runs).sort(([a], [b]) => a.localeCompare(b)));
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
