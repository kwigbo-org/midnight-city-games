// node --test ties.test.mjs : who shares the pot in a true tie (v4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tieWinners } from './ties.mjs';
test('separate wallets: separate winners, sorted by wallet', () => {
  assert.deepEqual(tieWinners([{ id: 'b', wallets: ['w2'] }, { id: 'a', wallets: ['w1'] }]), [{ id: 'a', address: 'w1' }, { id: 'b', address: 'w2' }]);
});
test('a shared first wallet: one winner', () => {
  assert.deepEqual(tieWinners([{ id: 'a', wallets: ['w1'] }, { id: 'b', wallets: ['w1'] }]), [{ id: 'a', address: 'w1' }]);
});
test('sharing a second wallet: still one winner, paid at the smallest', () => {
  assert.deepEqual(tieWinners([{ id: 'a', wallets: ['w1', 'w9'] }, { id: 'b', wallets: ['w2', 'w9'] }]), [{ id: 'a', address: 'w1' }]);
});
test('joined through a third agent (transitive)', () => {
  const r = tieWinners([{ id: 'a', wallets: ['w5'] }, { id: 'b', wallets: ['w7'] }, { id: 'c', wallets: ['w5', 'w7'] }, { id: 'd', wallets: ['w3'] }]);
  assert.deepEqual(r, [{ id: 'd', address: 'w3' }, { id: 'a', address: 'w5' }]);
});
test('at most five', () => {
  assert.equal(tieWinners(Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, wallets: [`w${i}`] }))).length, 5);
});
