// v4 (Season 3): who shares the pot in a true tie. group: the eligible tied finishers in the judge's
// order, each { id, wallets: [its own published wallets] }. Agents sharing ANY wallet are one winner
// (joined transitively), paid at the smallest of the joined set's wallets and named after its
// best-ranked agent. Sorted by wallet (every judge the same order), at most `max`.
export function tieWinners(group, max = 5) {
  const sets = [];
  for (const g of group) {
    const touching = sets.filter((s) => g.wallets.some((w) => s.wallets.has(w)));
    const merged = { ids: [g.id], wallets: new Set(g.wallets) };
    for (const s of touching) { merged.ids.push(...s.ids); for (const w of s.wallets) merged.wallets.add(w); sets.splice(sets.indexOf(s), 1); }
    sets.push(merged);
  }
  // The name: the first of the set's agents in `group` (the judge's order), whatever order s.ids is in.
  return sets.map((s) => ({ id: group.find((g) => s.ids.includes(g.id)).id, address: [...s.wallets].sort()[0], ids: [...s.ids], wallets: [...s.wallets] }))
    .sort((a, b) => (a.address < b.address ? -1 : 1)).slice(0, max);
}
