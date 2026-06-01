# Capstone Project Report

**Course:** Blockchain & Applications (IT4527E)
**Project:** Decentralized Academic Credential System with Selective Disclosure
**Author:** Vũ Quang Tiến
**Date:** May 2026

---

## Abstract

We present a decentralized system for issuing, presenting, and verifying academic credentials. The system combines **Elliptic Curve Cryptography** for issuer authenticity, **Merkle trees** for selective disclosure of transcript claims, and **two on-chain registries** (authorized issuers and revoked credentials) to give verifiers a single source of truth without requiring them to consult the issuing university directly.

The system is end-to-end functional: 23 smart-contract tests pass under Foundry, 26 off-chain unit tests pass under vitest, a production browser DApp build succeeds under Vite, and a 9-stage end-to-end demo against a local Ethereum devnet exercises every flow including tamper detection, credential revocation, and issuer de-authorization.

## 1. Introduction

### 1.1 Motivation

Two problems with paper / centralized academic transcripts:

1. **Over-disclosure.** Applying for a CS graduate program shouldn't require revealing the applicant's grades in unrelated electives, mental-health leave, or full GPA history. Today, it does.
2. **Verifiability.** Forged paper diplomas are routinely accepted because verifiers cannot machine-check authenticity. Calling the registrar is slow, manual, and expensive.

Blockchain technology, combined with Merkle-based selective disclosure, fixes both problems simultaneously.

### 1.2 Project objectives

The brief specifies:

> Develop a system for issuing and verifying digital diplomas. A student (Holder) can prove they graduated in a specific field without revealing their entire transcript or unnecessary personal data.

Technical requirements:

> 1. **Cryptography:** Use Elliptic Curve Cryptography (ECC) to sign credentials issued by the university.
> 2. **Selective Disclosure:** Implement a Merkle Tree structure. Each course/grade is a leaf node. The student provides Merkle Proofs only for specific requested courses without revealing the rest of the transcript.
> 3. **On-chain Registry:** Deploy a smart contract to maintain a registry of authorized issuers (universities) and a Revocation List for invalid credentials.

This report describes how each requirement was satisfied.

## 2. System architecture

The architecture is a three-layer DApp:

| Layer | Technology | Files |
|---|---|---|
| On-chain | Solidity 0.8.24 + OpenZeppelin Ownable2Step, Foundry | `contracts/` |
| Off-chain core | TypeScript, `@noble/curves` (secp256k1), `@noble/hashes` (keccak256) | `app/src/core/` |
| User-facing CLIs | TypeScript + Commander.js | `app/src/{issuer,holder,verifier}/` |
| Browser DApp | Vite + ethers.js, same core cryptography modules | `app/src/web/` |

### 2.1 Actors

- **Admin** (e.g. Ministry of Education) — owns the `IssuerRegistry`. Trusted root.
- **Issuer** (university) — registered by admin; holds an ECC keypair; issues, anchors, revokes credentials.
- **Holder** (student) — receives the full credential; produces redacted presentations.
- **Verifier** (third party) — checks presentations against the on-chain registries.

### 2.2 Lifecycle

1. Admin deploys `IssuerRegistry` and `CredentialRegistry`.
2. Admin registers HUST in the issuer registry.
3. HUST issues Alice a credential (ECC-signed, Merkle root committing to all courses).
4. HUST anchors the credential's hash on-chain.
5. Alice produces a presentation revealing only specific claims, plus their Merkle proofs.
6. Verifier checks: (a) issuer signature, (b) Merkle proofs, (c) on-chain anchor not revoked, (d) issuer still authorized.
7. (Optional) Holder signs a verifier-issued nonce to prove she's the rightful presenter.
8. (Later) Either the credential or the entire issuer can be revoked; subsequent verifications fail.

## 3. Cryptographic design

### 3.1 ECC: secp256k1 ECDSA

We use the same elliptic curve Ethereum uses, signing with EIP-191 `personal_sign` wrapping:

```
digest = keccak256("\x19Ethereum Signed Message:\n" ‖ len(msg) ‖ msg)
sig    = ECDSA(privateKey, digest)   // 65 bytes: r ‖ s ‖ v
```

**Why secp256k1:** native EVM support via `ecrecover`; the issuer's wallet *is* their signing key (no separate PKI); MetaMask compatibility for future browser-based issuance.

The signed payload is the **credential metadata only** (issuer, holder, type, schema, timestamps, `merkleRoot`), not the raw claims. This is essential for selective disclosure — the verifier doesn't need the full claim list to recover the issuer's address.

### 3.2 Merkle tree for selective disclosure

Each transcript claim (one course/grade, plus auxiliary fields like `gpa` or `thesis`) is a leaf. The leaf bytes are:

```
leafBytes = canonical_json({key, value, salt})
leafHash  = keccak256(0x00 ‖ leafBytes)             // 0x00 = leaf domain separator
```

Internal nodes:

```
nodeHash(L, R) = keccak256(0x01 ‖ L ‖ R)            // 0x01 = internal domain separator
```

A proof is `{siblings: hash[], positions: bool[]}`. The verifier walks from leaf to root, applying each sibling on the indicated side, and checks the result equals `merkleRoot`.

**Defense against second-preimage attacks:** the prefix `0x00` for leaves and `0x01` for internal nodes ensures an attacker cannot present an internal node hash and claim it's a leaf.

**Defense against brute-forcing low-entropy claims:** every leaf has a 32-byte random salt. Without it, an attacker who learned the public root could try `keccak256(0x00 ‖ "course=CS101,grade=A")` for every course/grade combination and match against tree-derivable hashes. Salts make this infeasible.

**Direction-bit proofs (no sort-pair):** we deliberately do NOT use sort-pair (where each pair is sorted before hashing). Sort-pair removes the need for direction flags but loses information about leaf position, complicating second-preimage analysis.

### 3.3 Holder-bound presentations

The holder signs `keccak256(credentialId ‖ verifierNonce)` with their own secp256k1 key. The verifier:

1. Issues a fresh 32-byte nonce as a challenge.
2. Receives the presentation, including a holder signature on the challenge.
3. Recovers the holder's address from the signature; checks it matches `presentation.holderProof.holderAddress`.
4. Optionally checks the holder address is the one named in the credential (e.g., if the holder field IS an Ethereum address).

This blocks **presentation replay**: a presentation given to verifier X is bound to X's nonce and cannot be re-used at verifier Y.

## 4. On-chain design

### 4.1 IssuerRegistry

```solidity
struct Issuer {
    string name;         // "Hanoi University of Science and Technology"
    string metadataURI;  // optional pointer to off-chain doc
    uint64 registeredAt;
    uint64 revokedAt;    // 0 if active
    bool active;
}

function registerIssuer(address, string, string)  external onlyOwner;
function revokeIssuer(address, string)            external onlyOwner;
function reinstateIssuer(address)                 external onlyOwner;
function isAuthorized(address)                    external view returns (bool);
```

Uses OpenZeppelin's **Ownable2Step** so admin transfer requires two-step accept — guards against fat-finger handover when migrating to a DAO-governed registry later.

### 4.2 CredentialRegistry

```solidity
struct CredentialAnchor {
    address issuer;
    bytes32 merkleRoot;
    bytes32 holderHash;     // keccak256(holder identifier)
    uint64 issuedAt;
    uint64 expiresAt;       // 0 = never
    uint64 revokedAt;       // 0 = not revoked
    bool exists;
}

enum Status { Unknown, Valid, Revoked, Expired }

function anchorCredential(bytes32, bytes32, bytes32, uint64, uint64) external;
function revokeCredential(bytes32, string) external;
function statusOf(bytes32) external view returns (Status);
function isCurrentlyValid(bytes32) external view returns (bool);
```

`anchorCredential` requires the caller to be currently authorized; `revokeCredential` requires the caller to be the original issuer.

`isCurrentlyValid` cross-checks `IssuerRegistry.isAuthorized(anchor.issuer)` so a credential whose issuer was de-authorized after issuance also fails.

`holderHash` (not the raw identifier) is anchored, hiding the holder from passive on-chain observers.

### 4.3 Solidity-side Merkle proof verifier

The registry also exposes pure helpers matching the off-chain Merkle math:

```solidity
function domainSeparatedLeafHash(bytes calldata encodedClaim) external pure returns (bytes32);
function verifyClaimHash(
    bytes32 leafHash,
    bytes32[] calldata siblings,
    bool[] calldata positions,
    bytes32 expectedRoot
) external pure returns (bool);
```

This is not required for normal verifier operation, because checking proofs off-chain is cheaper. It is included to demonstrate that the custom Merkle algorithm is portable to Solidity and can support future on-chain verifier contracts, scholarships, or gated university services.

## 5. Verification pipeline

```
verifyPresentation(presentation, options) → VerificationResult

  checks executed in order:
    1. issuer_signature       — ECDSA recovery matches metadata.issuer
    2. not_expired            — now < metadata.expiresAt (or 0)
    3. merkle_proof:<key>     — for each disclosed claim
    4. holder_proof           — if required, signature over (cid ‖ nonce) is valid
    5. anchor_present         — on-chain status == Valid, root matches
    6. issuer_authorized      — IssuerRegistry.isAuthorized(metadata.issuer)
```

Each check is reported separately so the verifier UI can explain *why* a presentation failed. The verifier can disable on-chain checks (`--offline`) for air-gapped scenarios.

## 6. Implementation

### 6.1 Smart contracts

| File | Purpose | Lines |
|---|---|---|
| `IssuerRegistry.sol` | Authorized issuers | ~110 |
| `CredentialRegistry.sol` | Anchors + revocation | ~140 |
| `IIssuerRegistry.sol` | Interface | ~25 |
| `Deploy.s.sol` | Foundry deployment script | ~25 |
| `IssuerRegistry.t.sol` | Tests | ~110 |
| `CredentialRegistry.t.sol` | Tests (incl. fuzz) | ~140 |

Total Solidity: ~600 lines. Compiles with `solc 0.8.24`. All 23 tests pass.

### 6.2 TypeScript core

| File | Purpose | Lines |
|---|---|---|
| `core/types.ts` | Domain types | ~80 |
| `core/canonical.ts` | Deterministic JSON | ~25 |
| `core/hash.ts` | keccak256 helpers | ~50 |
| `core/merkle.ts` | Custom Merkle tree | ~150 |
| `core/ecc.ts` | secp256k1 + EIP-191 | ~140 |
| `core/credential.ts` | Issuance, presentation, verification | ~250 |
| `chain/abi.ts` | Hand-curated ABIs | ~30 |
| `chain/client.ts` | ethers.js wrapper | ~110 |

### 6.3 Browser DApp

The Vite dashboard (`app/src/web/`) reuses the same core library as the CLIs. It supports local credential issuance, claim selection, Merkle proof inspection, offline verification, and live Anvil registry calls for issuer registration, anchoring, chain verification, and revocation.

### 6.4 CLIs

Three CLIs implemented with Commander.js:

- `issuer` — keygen, issue, anchor, revoke, register, revoke-issuer
- `holder` — keygen, list, present
- `verifier` — challenge, verify

Plus a deployment script and an end-to-end demo script.

## 7. Testing

### 7.1 Smart contracts (Foundry)

23 tests covering:

- IssuerRegistry: register, update, revoke, reinstate, enumerate, ownership control, empty-name rejection.
- CredentialRegistry: anchor by authorized issuer; reject anchor by unauthorized; reject double-anchor; reject zero merkle root; reject invalid expiry; revoke by issuer; reject revoke by non-issuer; expired status; unknown status; issuer authority loss.
- Security validation: reject zero credential IDs and zero holder hashes.
- Pure Merkle verification: Solidity validates the same direction-bit proof shape used off-chain and rejects length mismatches.
- Fuzz: 256 random inputs to anchor → revoke roundtrip.

```
$ forge test
Ran 2 test suites: 23 tests passed, 0 failed, 0 skipped.
```

The repository includes `contracts/.gas-snapshot` from `forge snapshot`, so gas costs are visible during review. Example measurements:

| Operation test | Gas |
|---|---:|
| Authorized credential anchor | 114,476 |
| Credential revocation | 143,020 |
| Unknown credential status read | 7,909 |
| Solidity Merkle proof verification | 13,926 |

### 7.2 Off-chain (vitest)

26 tests across three files:

- **merkle.test.ts (9 tests):** stable root regardless of input order; proof verifies for every leaf; tampering rejected; sibling forgery rejected; position-bit flipping rejected; odd-leaf-count handling; duplicate-leaf rejection; empty input rejection; root format.
- **ecc.test.ts (6 tests):** key derivation; sign + recover round-trip; ethers interop; tampered-message rejection; raw-digest signing; address derivation.
- **credential.test.ts (11 tests):** end-to-end issuance + verification; tampered claim rejection; forged signature rejection; expiry; on-chain anchor mismatch; revoked credential; unauthorized issuer; holder-bound proof with nonce; replay-protection; manufactured Merkle proof rejection; deterministic credentialId.

```
$ npm test
Test Files  3 passed (3)
     Tests  26 passed (26)
```

### 7.3 End-to-end demo

A 9-section demo (`app/src/demo/end-to-end.ts`) that runs against a local Anvil node:

1. Deploy contracts.
2. Admin registers HUST.
3. HUST issues Alice's degree credential (7 claims: 5 courses, gpa, thesis).
4. HUST anchors on-chain.
5. Alice creates a presentation revealing only `thesis` and `gpa` (5 hidden claims).
6. Verifier validates — passes all 7 checks.
7. Tamper test (modify GPA in the disclosed presentation) — verifier rejects.
8. HUST revokes — verifier rejects.
9. Admin revokes HUST's authority — newly issued credentials by HUST fail verification.

All 9 sections complete successfully.

### 7.4 Browser DApp

The Vite dashboard exercises the same protocol in a UI:

- issue a fresh sample credential in-browser using secp256k1,
- select only the claims to disclose,
- inspect the Merkle proof path for the first disclosed claim,
- verify off-chain with holder nonce binding,
- paste local contract addresses and run live registry checks against Anvil,
- register the demo HUST issuer, anchor the credential, verify on-chain, and revoke.

```
$ npm run web:build
vite v8.x building client environment for production...
✓ built
```

## 8. Threat model summary

(See `docs/SECURITY.md` for the complete table.)

| Attack | Defense |
|---|---|
| Forged credential | Issuer signature recovers wrong address |
| Modified disclosed claim | Merkle proof fails |
| Brute-force hidden claims | 32-byte per-claim salts |
| Presentation replay | Holder signs verifier nonce |
| Issuance after de-authorization | `isCurrentlyValid` checks `isAuthorized` |
| Revoked credential reuse | `statusOf` returns Revoked |
| Unauthorized revocation | `msg.sender == anchor.issuer` |
| Holder identity leak on-chain | Only `keccak256(holder)` anchored |

Out of scope (acknowledged): compromised issuer keys (recovery is manual), holder collusion (would need ZK or hardware identity), quantum adversary (would need PQ signatures).

## 9. Limitations and future work

| Limitation | Mitigation / future work |
|---|---|
| Single signing key per issuer | Add multi-key registry entries; rotate keys without losing existing credentials |
| Manual key recovery on compromise | Use HSMs / multi-sig signers; add key rotation events |
| Plaintext claim *values* in disclosure | Add ZK-SNARK alternative for "prove ≥ threshold" without revealing exact value |
| No batch verification | Use signature aggregation (BLS) for high-throughput verifiers |
| No cross-chain | Bridge anchors to L2s; use a registry-per-chain pattern |

## 10. Conclusion

We delivered a complete, working DApp that meets every requirement of the brief: ECC signatures by the issuer, Merkle-tree-based selective disclosure with one leaf per course/grade, on-chain registries for authorized issuers and revoked credentials. The system is exercised by 49 automated tests (all passing), a production browser build, and a 9-section end-to-end demo. Source is ~1,900 lines across smart contracts, off-chain library, CLIs, browser UI, and tests, with thorough rationale documented in `docs/DESIGN.md` and a published threat model in `docs/SECURITY.md`.

The implementation choices — secp256k1 over P-256 for EVM-native verification, custom Merkle tree with domain separation and direction bits over off-the-shelf libraries, `holderHash` anchoring instead of plaintext identifiers, signing metadata-only to enable redacted-presentation verification — were made to maximize **verifier portability** (any Ethereum tool can verify credentials) and **future extensibility** (the same primitives compose with ZK or aggregation schemes if added later).

## Appendix A — Repository layout

```
.
├── README.md                       — top-level project overview
├── task.txt                        — original brief
├── contracts/                      — Foundry project
│   ├── src/
│   │   ├── IssuerRegistry.sol
│   │   ├── CredentialRegistry.sol
│   │   └── IIssuerRegistry.sol
│   ├── test/
│   │   ├── IssuerRegistry.t.sol
│   │   └── CredentialRegistry.t.sol
│   └── script/Deploy.s.sol
├── app/                            — TypeScript implementation
│   ├── src/core/                       — primitives (ECC, Merkle, types)
│   ├── src/chain/                      — ethers.js client + ABIs
│   ├── src/{issuer,holder,verifier}/   — three CLIs
│   ├── src/web/                         — Vite browser DApp dashboard
│   ├── src/scripts/deploy-local.ts     — local devnet deployer
│   ├── src/demo/end-to-end.ts          — 9-section demo
│   └── tests/                          — 26 vitest unit tests
└── docs/
    ├── DESIGN.md                       — design rationale
    ├── USAGE.md                        — step-by-step walkthrough
    ├── SECURITY.md                     — threat model
    ├── PRESENTATION.md                 — demo script + Q&A
    └── REPORT.md                       — this document
```

## Appendix B — How to reproduce the results

```bash
# In the project root:
cd contracts && forge install && forge test           # 23 tests pass
cd ../app && npm install && npm test                  # 26 tests pass
cd ../app && npm run build && npm run web:build       # CLI + browser builds
anvil &                                                # in another terminal
cd ../app && npm run demo                              # 9-section end-to-end demo
```

Tested on: Linux Fedora 40, Node v20.19.1, Foundry 0.4.x, OpenZeppelin Contracts v5.x.
