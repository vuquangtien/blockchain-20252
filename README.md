# Decentralized Academic Credential System with Selective Disclosure

**Capstone project — Blockchain & Applications (IT4527E), Hanoi University of Science and Technology, 2025**

A complete, working implementation of a decentralized academic-credential platform. A student can prove they graduated in a specific field (or hold a specific course/grade) **without revealing their entire transcript** or unnecessary personal data.

## What this delivers

| Requirement from the project brief | Where it lives |
|---|---|
| ECC signatures by the university | [secp256k1 ECDSA signing](app/src/core/ecc.ts), key generation, EIP-191 wrapping |
| Selective disclosure via Merkle Tree (one leaf per course/grade) | [`MerkleClaimTree`](app/src/core/merkle.ts), verifier-side proof checking |
| On-chain registry of authorized issuers | [`IssuerRegistry.sol`](contracts/src/IssuerRegistry.sol) |
| On-chain revocation list for invalid credentials | [`CredentialRegistry.sol`](contracts/src/CredentialRegistry.sol) |
| Functional, end-to-end DApp | [Issuer CLI](app/src/issuer/cli.ts), [Holder CLI](app/src/holder/cli.ts), [Verifier CLI](app/src/verifier/cli.ts), [E2E demo](app/src/demo/end-to-end.ts) |
| Browser frontend integration | [Vite role-based portal UI](app/src/web/main.ts) with live ECC, Merkle, and local-chain verification |

The core protocol has three primary actors:

- **Issuer** — a university registered on-chain by the system administrator. Issues, anchors, and revokes credentials.
- **Holder** — a student who custody-holds their full credential off-chain and creates redacted *presentations*.
- **Verifier** — any third party (employer, government, another university) that checks a presentation against the on-chain registries.

The browser product presents separate portals for:

- **Dashboard**
- **University Portal**
- **Student Wallet**
- **Verifier Portal**
- **Blockchain Registry**
- **Technical Evidence**

## High-level architecture

```
                   ┌─────────────────────┐
                   │  Admin (Ministry)   │
                   │  registers issuers  │
                   └──────────┬──────────┘
                              │ owner of
                              ▼
   ┌──────────────────┐   reads   ┌─────────────────────────┐
   │ IssuerRegistry   │◀──────────│ CredentialRegistry      │
   │  authorized      │           │  anchors + revocations  │
   │  universities    │           │                         │
   └────────▲─────────┘           └────────────▲────────────┘
            │ register me                      │ anchor / revoke
            │                                  │
   ┌────────┴────────┐    ECC-sign    ┌────────┴────────┐
   │ Issuer (Uni)    │───────────────▶│ Credential JSON │
   │ secp256k1 key   │   Merkle root  │ {claims, root,  │
   │                 │                │  signature}     │
   └─────────────────┘                └────────┬────────┘
                                               │ hand to student
                                               ▼
                                      ┌─────────────────┐
                                      │ Holder (student)│
                                      │ creates redacted│
                                      │  Presentation   │
                                      └────────┬────────┘
                                               │ disclose
                                               ▼
                                      ┌─────────────────┐
                                      │   Verifier      │
                                      │ checks sig +    │
                                      │ Merkle proofs + │
                                      │ on-chain status │
                                      └─────────────────┘
```

## Project layout

```
.
├── contracts/                  Foundry project — smart contracts + tests
│   ├── src/
│   │   ├── IssuerRegistry.sol      (authorized issuers, owner-controlled)
│   │   ├── CredentialRegistry.sol  (Merkle-root anchors + revocation list)
│   │   └── IIssuerRegistry.sol     (interface)
│   ├── test/                       (70 Foundry tests, all passing)
│   └── script/Deploy.s.sol         (Foundry deployment script)
│
├── app/                        TypeScript off-chain implementation
│   ├── src/core/                   (ECC, Merkle tree, credential model)
│   │   ├── ecc.ts                      secp256k1 + EIP-191 personal_sign
│   │   ├── merkle.ts                   custom Merkle tree (domain-separated)
│   │   ├── credential.ts               issuance, presentation, verification pipeline
│   │   ├── canonical.ts                deterministic JSON serialization
│   │   ├── hash.ts                     keccak256 + hex helpers
│   │   └── types.ts                    domain types
│   ├── src/chain/                  (ethers.js client + ABIs)
│   ├── src/issuer/cli.ts           Issuer CLI (university)
│   ├── src/holder/cli.ts           Holder CLI (student)
│   ├── src/verifier/cli.ts         Verifier CLI (third party)
│   ├── src/web/                   Browser role-based portals (dashboard / university / student / verifier / registry / evidence)
│   ├── src/demo/end-to-end.ts      Full happy-path + tamper / revocation tests
│   ├── src/scripts/deploy-local.ts Standalone deploy to local Anvil
│   ├── src/scripts/deploy-v2-local.ts V2 registry deploy + bootstrap for local live mode
│   └── tests/                      137 Vitest unit tests, all passing
│
├── docs/                       Design rationale and user guides
│   ├── DESIGN.md                   Detailed architecture & cryptographic choices
│   ├── USAGE.md                    CLI walkthrough
│   ├── SECURITY.md                 Threat model & known limitations
│   ├── GRADING.md                  Rubric-to-evidence map
│   ├── PRESENTATION.md             5-minute demo script + defense Q&A
│   ├── SETUP_FOR_GRADING.md        Teacher setup and grading guide
│   ├── DEMO_GUIDE.md               Student live demo guide
│   ├── SUBMISSION_CHECKLIST.md     Final commands before submission
│   ├── evaluation/                 Per-rubric full-score guides
│   └── REPORT.md                   Capstone-style technical report
│
├── Makefile                    One-command check/demo/package helpers
├── LICENSE                     MIT license
└── README.md                   You are here
```

## Quick start (5 minutes)

```bash
# 1. Run the setup automation (initializes pinned git submodules and installs npm packages)
make setup

# 2. Run deterministic validation (Solidity formatting, smart-contract tests, vitest unit tests, and builds)
make check

# 3. (Optional) Run npm audit independently (requires network access)
make audit

# 4. Run the full end-to-end demo (auto-starts and stops Anvil for you)
cd app
npm run demo:full            # deploys, issues, presents, verifies, revokes — all green
# or, if you want to keep your own anvil running:
anvil &                      # http://127.0.0.1:8545
npm run demo

# 5. Or play with the CLIs by hand:
#    See docs/USAGE.md for a complete walkthrough.

# 6. Launch the browser portals:
npm run web
# open the printed local URL
```

## CredentialTrust Live Demo V2

Run the live local product mode backed by real deployed V2 contracts:

```bash
make setup
make demo-v2
```

This command builds the V2 artifacts if needed, starts or reuses Anvil, deploys and
bootstraps `IssuerRegistryV2` and `CredentialRegistryV2`, writes `app/data/chain-v2.json`,
and launches the browser app with the Blockchain Registry portal prefilled.

Manual fallback:

```bash
cd app
anvil --host 0.0.0.0 --port 8545
npm run deploy:v2-local
npm run web
```

The generated `app/data/chain-v2.json` is served by Vite at `/chain-v2.json` and is excluded
from the submission package.

Or from the project root:

```bash
make check       # Solidity formatting, tests, vitest unit tests, CLI + Web builds
make audit       # npm audit (network-dependent)
make demo        # full local Anvil demo
make web         # browser role-based portals
make package     # creates a clean submission zip (includes pinned/vendored Solidity dependencies; npm ci requires registry access or populated npm cache)
make smoke-check # packages the zip, extracts it to a temp dir, runs setup + check to verify reproducibility
```

The end-to-end demo walks through every requirement in the brief in 9 sections. Sample output is shown in [docs/USAGE.md](docs/USAGE.md#end-to-end-demo).

## Final handoff guides

- [Teacher setup and grading guide](docs/SETUP_FOR_GRADING.md)
- [Student live demo guide](docs/DEMO_GUIDE.md)

## Test coverage

- **70 / 70 Foundry contract tests pass** — including fuzz tests on the V2 issuer/registry lifecycle and Solidity-side Merkle proof verification.
- **137 / 137 Vitest unit tests pass** — covering Merkle proof correctness/tampering, ECC sign/recover/interop with ethers, end-to-end issuance + selective disclosure + tamper detection, on-chain status checks, role-portal UI flow, and holder-bound proof validation.
- **Browser production build passes** — the same TypeScript cryptography core bundles into the Vite DApp.

```
$ forge test
70 tests passed; 0 failed; 0 skipped

$ npm test
Test Files  11 passed (11)
     Tests  137 passed (137)

$ npm run web:build
✓ built

$ cd ../contracts && forge snapshot
contracts/.gas-snapshot updated
```

For the technical background, read [docs/GRADING.md](docs/GRADING.md), [docs/REPORT.md](docs/REPORT.md), and [docs/SECURITY.md](docs/SECURITY.md). For detailed full-score strategy per rubric category, read [docs/evaluation/00_INDEX.md](docs/evaluation/00_INDEX.md). For the final pre-submission checklist, read [docs/SUBMISSION_CHECKLIST.md](docs/SUBMISSION_CHECKLIST.md).

## Key design decisions (read [docs/DESIGN.md](docs/DESIGN.md) for the full reasoning)

1. **secp256k1 for ECC** — same curve Ethereum uses. The issuer's wallet *is* their signing key; no separate PKI to manage.
2. **EIP-191 `personal_sign` wrapping** — signatures verify in Solidity (`ecrecover`) and compatible Ethereum wallet clients without modification.
3. **Domain-separated Merkle hashing** — leaves prefixed `0x00`, internal nodes prefixed `0x01`, defending against second-preimage attacks.
4. **Direction-bit Merkle proofs (no sort-pair)** — preserves leaf order and prevents proof aliasing.
5. **Per-claim 32-byte salts** — hidden leaves cannot be brute-forced from the root (defends against dictionary attacks on a small claim space like grades A/B/C).
6. **Cross-layer Merkle verifier** — Solidity exposes the same domain-separated proof algorithm used by the TypeScript verifier, demonstrating that proofs are not tied to one runtime.
7. **Issuer signs the metadata, not the claims** — the metadata commits to `merkleRoot`, which commits to the claims. Verifiers can validate signatures from a redacted presentation with no full claim list.
8. **Holder identifier hashed on-chain** — only `keccak256(holder)` is anchored, hiding the holder's identity from on-chain observers while still being verifiable by anyone who knows the identifier.
9. **Optional on-chain anchoring** — credentials are valid off-chain by signature alone, but anchoring is needed for revocation. The verifier picks the policy.
10. **Holder-bound proofs with verifier nonce** — prevents replay of a presentation across verifiers; the holder signs `keccak256(credentialId ‖ nonce)` on demand.

## License

MIT.
