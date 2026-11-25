# vendor

`bls12-381.bundle.mjs`: [@noble/curves](https://github.com/paulmillr/noble-curves) 2.4.0 (with
@noble/hashes 2.4.0), bundled unminified so the recorders need no `npm install`. It verifies the drand
beacon's signatures (`beacon.mjs`). To rebuild it and compare:

```sh
npm i @noble/curves@2.4.0 esbuild@0.25.10
echo 'export { bls12_381 } from "@noble/curves/bls12-381.js";' > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --platform=neutral --legal-comments=inline --outfile=bls12-381.bundle.mjs
sha256sum bls12-381.bundle.mjs   # d02a3b49a04897371ca45a931dcaa2b1163ac0c7246e1b1caf8ec926de778f92
```
