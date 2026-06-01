# Grading Evidence Map

This file maps the official 10-point rubric to concrete files and commands in the project.

For a deeper "how to get full score" guide for each criterion, see `docs/evaluation/00_INDEX.md`.

## 1. Core Technical Execution - 3.0 pts

Evidence:

- Smart contracts: `contracts/src/IssuerRegistry.sol`, `contracts/src/CredentialRegistry.sol`
- Off-chain core: `app/src/core/credential.ts`, `app/src/core/ecc.ts`, `app/src/core/merkle.ts`
- CLI integration: `app/src/issuer/cli.ts`, `app/src/holder/cli.ts`, `app/src/verifier/cli.ts`
- Browser DApp: `app/src/web/main.ts`
- Full demo: `app/src/demo/end-to-end.ts`

Commands:

```bash
make check
make demo
make web
```

## 2. Algorithmic Logic & Anti-Clone - 2.5 pts

Evidence:

- Custom Merkle tree implementation with domain-separated leaf/node hashes.
- Direction-bit proofs instead of sorted-pair boilerplate.
- Per-claim 32-byte salts to resist low-entropy grade brute force.
- Canonical JSON encoding for deterministic cross-runtime hashes.
- Solidity-side proof verifier mirrors the TypeScript algorithm.

Key files:

- `app/src/core/merkle.ts`
- `app/src/core/canonical.ts`
- `contracts/src/CredentialRegistry.sol`
- `app/tests/merkle.test.ts`
- `contracts/test/CredentialRegistry.t.sol`

## 3. Security, Gas & Performance - 2.0 pts

Evidence:

- `Ownable2Step` issuer governance.
- Only authorized issuers can anchor credentials.
- Only original issuer can revoke a credential.
- Revocation and expiry checks.
- Holder identifier is stored as `keccak256(holder)`, not plaintext PII.
- Zero `credentialId`, zero `holderHash`, and zero `merkleRoot` rejected.
- Gas baseline committed in `contracts/.gas-snapshot`.

Commands:

```bash
cd contracts
forge test
forge snapshot
```

## 4. Technical Documentation - 1.5 pts

Evidence:

- `README.md` - overview and quick start.
- `docs/REPORT.md` - capstone-style report.
- `docs/DESIGN.md` - architecture, cryptographic choices, tradeoffs.
- `docs/SECURITY.md` - threat model.
- `docs/USAGE.md` - CLI and browser walkthrough.
- `docs/PRESENTATION.md` - live demo script and expected Q&A.

## 5. Teamwork & Presentation - 1.0 pt

Evidence:

- One-command verification: `make check`
- One-command live demo: `make demo`
- Browser dashboard: `make web`
- Submission zip generation: `make package`

Recommended presentation order:

1. Run `make check`.
2. Run `make demo`.
3. Open the browser dashboard and show selective disclosure.
4. Explain why the hidden transcript claims are not present in the presentation JSON.
5. Revoke the credential and show verification failure.
