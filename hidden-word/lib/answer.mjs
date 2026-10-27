// How an answer becomes the 32 bytes the contract checks.
//
// 1. Normalize: Unicode NFKC, lowercase, trim, and collapse every run of
//    whitespace to one space. "  12-River   31-ash " becomes "12-river 31-ash".
// 2. Hash: SHA-256 of the normalized text as UTF-8.
//
// The contract stores phraseHash(those 32 bytes), so anyone can check an answer
// against the chain (check.mjs) without spending anything.
import { createHash } from 'node:crypto';

export function normalizeAnswer(text) {
  return text.normalize('NFKC').toLowerCase().trim().split(/\s+/).join(' ');
}

export function answerDigest(text) {
  return new Uint8Array(createHash('sha256').update(normalizeAnswer(text), 'utf8').digest());
}
