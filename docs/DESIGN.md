# Design Document

This document explains *why* the system is structured the way it is. It is meant for graders, future maintainers, and anyone evaluating the project beyond a surface-level demo.

## 1. Problem statement

A traditional academic transcript has two failure modes that blockchain technology can fix:

1. **Privacy / over-disclosure.** A student applying to a single graduate program in CS may be required to hand over their entire transcript — including unrelated electives, mental-health leave, GPAs from struggling semesters, and identifying personal data — to satisfy a single yes/no question ("did this person study CS at university X?").
2. **Verifiability / forgery.** Paper diplomas are routinely forged. Verifiers ask for an official letter or call the registrar. There is no machine-checkable, fully decentralized way to verify a diploma.

The brief asks for a system that solves both. Specifically:

- **ECC** to sign credentials issued by the university.
- A **Merkle tree** over per-course/grade leaves so the holder can disclose a subset to a verifier with cryptographic proofs.
- An **on-chain registry** of authorized issuers and a **revocation list** for invalid credentials.

## 2. Actors and trust model

| Actor | Trust assumption | Capabilities |
|---|---|---|
| Admin (Ministry / DAO) | Trusted root: it decides which universities are authorized issuers. | Owns `IssuerRegistry`. Adds, updates, revokes, reinstates issuers. |
| Issuer (University) | Trusted to issue truthful credentials about its own students; can be removed by Admin. | Holds an ECC keypair. Signs credentials. Anchors and revokes them on-chain. |
| Holder (Student) | Untrusted to verifiers. Cannot create credentials; can only re-share what was issued to them. | Custodies the full credential JSON. Produces selective-disclosure presentations. |
| Verifier | Untrusted to the holder. May read on-chain state. | Runs the verification pipeline. Choose to require holder-bound proofs and/or on-chain anchoring. |

The system relies on a **rooted PKI**: the admin-owned registry is the trust anchor. Once an issuer is registered, anyone can independently verify all credentials it has signed, without further consultation with the admin.

### 2.1 Implementation layers

| Layer | Technology | Files |
|---|---|---|
| On-chain | Solidity 0.8.24 + OpenZeppelin Ownable2Step, Foundry | `contracts/` |
| Off-chain core | TypeScript, `@noble/curves` (secp256k1), `@noble/hashes` (keccak256) | `app/src/core/` |
| User-facing CLIs | TypeScript + Commander.js | `app/src/{issuer,holder,verifier}/` |
| Browser DApp | Vite + ethers.js, reusing the same TypeScript core | `app/src/web/` |

## 3. Cryptographic primitives

### 3.1 Elliptic Curve Cryptography — secp256k1

We use **secp256k1 ECDSA**, the same curve Ethereum uses. This is a deliberate choice:

| Alternative | Why we rejected it |
|---|---|
| ECDSA over P-256 (NIST) | Not natively supported by Solidity; requires a precompile or expensive in-EVM verification. Loses the property that the issuer's wallet *is* their signing key. |
| Ed25519 | Same reason as P-256: no native EVM support. |
| BLS12-381 | Useful for aggregation, but unnecessary here and increases on-chain cost. |

Concretely:
- An issuer's private key (32 bytes) generates an Ethereum address.
- The same address is registered in `IssuerRegistry`.
- Signatures use **EIP-191 `personal_sign`** wrapping: `digest = keccak256("\x19Ethereum Signed Message:\n<len>" ‖ message)`.
- Verifiers recover the address via `ecrecover` (in Solidity) or `Signature.recoverPublicKey` (in JS).
- This means our signatures are **directly compatible with MetaMask `eth_sign`**, so a future browser-extension wallet integration can sign credentials without exposing keys to the issuer's web app.

See [`app/src/core/ecc.ts`](../app/src/core/ecc.ts) and the round-trip + ethers-interop tests in [`app/tests/ecc.test.ts`](../app/tests/ecc.test.ts).

### 3.2 Merkle tree for selective disclosure

A Merkle tree binds a single 32-byte root to an arbitrary set of claims. Disclosing a single claim costs `log₂(N)` sibling hashes — for a transcript with 64 courses, that's 6 sibling hashes (~192 bytes) per disclosed claim.

#### Why we wrote our own Merkle tree

Existing TS libraries (`merkletreejs`, `OpenZeppelin merkle-tree`) are widely used but:

- Default to **sort-pair** ordering (each pair sorted before hashing). Sort-pair removes direction flags from proofs but **leaks information** (the verifier can't tell where the leaf was) and complicates analysis under structured data.
- Use **inconsistent or no domain separation** between leaves and internal nodes, leaving second-preimage attack surface in some configurations.
- Hide details (how odd leaf counts are handled, how leaves are encoded) behind defaults, making it harder to write a matching verifier in another language (Solidity, in particular).

Our custom tree (`app/src/core/merkle.ts`) is ~150 lines and fully transparent:

| Choice | Rationale |
|---|---|
| `keccak256(0x00 ‖ leafBytes)` for leaves | Domain separator prevents an attacker from passing an internal node hash off as a leaf. |
| `keccak256(0x01 ‖ left ‖ right)` for nodes | Same defense from the other direction. |
| Per-claim 32-byte random salt inside leaf bytes | Without salts, a small claim space ("grade=A", "grade=B", …) lets an attacker brute-force *hidden* leaves from the public root. |
| Leaf bytes = canonical JSON of `{key, value, salt}` | Cross-language reproducible. |
| Sorted by leaf-hash before tree build | Order-independent: same set of claims → same root, useful for deterministic credential IDs. |
| Odd-leaf duplication | Standard Bitcoin convention; safe under domain separation. |
| Direction bits in proofs | Preserve leaf identity; prevents proof aliasing. |

#### Anatomy of a proof

A proof for one disclosed claim is `{siblings: hash[], positions: bool[]}`. To verify:

```
cur = leafHash(claim)
for i in 0..len(siblings)-1:
    if positions[i]: cur = nodeHash(siblings[i], cur)   # we are right child
    else:            cur = nodeHash(cur, siblings[i])   # we are left child
return cur == root
```

This exact pseudo-code is implemented and unit-tested in [`merkle.ts`](../app/src/core/merkle.ts) and [`merkle.test.ts`](../app/tests/merkle.test.ts), including: tamper detection, sibling forgery, position-bit flipping, odd-leaf-count handling, duplicate-leaf rejection.

### 3.3 Issuer signature scope

The signed message is the **credential metadata**, NOT the full credential including claims:

```jsonc
// What the issuer signs (canonical JSON):
{
  "credentialType": "Bachelor of Science in Computer Science",
  "expiresAt": 0,
  "holder": "did:vn:alice-2025",
  "id": "urn:cred:9cf1a8eb...",
  "issuedAt": 1700000000,
  "issuer": "0x7099...c8",
  "merkleRoot": "0x00a5f6...0476",   // commits to all claims
  "schemaURI": "https://hust.edu.vn/...",
  "version": "1.0"
}
```

Because `merkleRoot` is in the signed payload, the signature transitively authenticates every claim, even though `claims` itself is not signed. This is the property that makes **selective disclosure work**: the verifier sees `metadata + a few claims + proofs`, and only the metadata + `merkleRoot` is needed to recover the issuer's address. The claims are validated independently by their Merkle proofs.

If we instead signed `metadata + claims`, the verifier would need the full claim list to recover the issuer address — defeating the entire purpose.

### 3.4 Canonical JSON

Two parties hashing "the same" object must produce the same bytes. Our `canonicalize()` recursively sorts keys, preserves array order, and refuses non-finite numbers. See [`canonical.ts`](../app/src/core/canonical.ts).

## 4. Smart contract design

### 4.1 IssuerRegistry

A simple owner-administered allowlist with extra metadata.

```solidity
struct Issuer {
    string name;
    string metadataURI;
    uint64 registeredAt;
    uint64 revokedAt;
    bool active;
}
```

Operations:
- `registerIssuer(addr, name, metadataURI)` — admin-only.
- `updateIssuer(addr, name, metadataURI)` — admin-only.
- `revokeIssuer(addr, reason)` — admin-only; sets `active=false`. Existing credentials become un-honored by `isCurrentlyValid()`.
- `reinstateIssuer(addr)` — re-activate.
- `isAuthorized(addr)` view — used by the credential registry and verifiers.
- `issuerCount() / issuerAt(idx)` for enumeration.

We use **OpenZeppelin's `Ownable2Step`** so transferring admin requires a two-tx accept flow — protects against fat-fingering when handing the registry over to a DAO.

### 4.2 CredentialRegistry

```solidity
struct CredentialAnchor {
    address issuer;
    bytes32 merkleRoot;
    bytes32 holderHash;
    uint64 issuedAt;
    uint64 expiresAt;
    uint64 revokedAt;
    bool exists;
}

enum Status { Unknown, Valid, Revoked, Expired }
```

The contract:
- accepts an `anchorCredential` only from issuers currently authorized in `IssuerRegistry`,
- enforces uniqueness (a given `credentialId` can be anchored at most once),
- validates that `expiresAt == 0 || expiresAt > issuedAt`,
- only allows the original issuer to revoke,
- stores the revocation reason on-chain.

`statusOf()` returns the status enum; `isCurrentlyValid()` adds the cross-check that the issuer is still authorized.

#### Why `holderHash` instead of `holder`?

If we stored the raw holder identifier on-chain, every credential would publicly link a person to a university. By storing `keccak256(holder)`, we keep the privacy property: a verifier who knows the holder's identifier can look them up; a passive observer cannot enumerate students from public chain state.

#### Why include the credentialId at all?

We could have anchored only `merkleRoot`. The reason for a separate `credentialId`:

- A given `merkleRoot` could in principle be re-used across credentials if the same claim set is issued twice (unlikely in practice but possible for a small set).
- We want to be able to **revoke a specific credential** without revoking other credentials that happen to share a root.
- `credentialId` includes the unique `credential.id` field (UUIDv4-style), so each credential has a unique anchor regardless of claim collisions.

### 4.3 Pure Merkle proof verification in Solidity

The contract includes `domainSeparatedLeafHash()` and `verifyClaimHash()` as pure functions. Normal verifier clients should check Merkle proofs off-chain because it is free and private, but having the exact algorithm in Solidity proves cross-runtime compatibility:

```
leaf = keccak256(0x00 || encodedClaim)
node = keccak256(0x01 || left || right)
```

The `positions` array is the same direction-bit array emitted by the TypeScript holder code. This makes it possible to add future on-chain verifier contracts without rewriting the cryptographic commitment scheme.

## 5. End-to-end verification pipeline

`verifyPresentation` executes seven checks in order; each is reported separately so verifiers can show users *why* something failed:

1. **`issuer_signature`** — `ecrecover(canonical(metadata), credential.signature) == metadata.issuer`?
2. **`not_expired`** — `metadata.expiresAt == 0 || now < metadata.expiresAt`?
3. **`merkle_proof:<key>`** — for each disclosed claim, does its Merkle proof reproduce `metadata.merkleRoot`?
4. **`holder_proof`** — if required, does the holder's signature over `keccak256(credentialId ‖ verifierNonce)` recover `holderProof.holderAddress`?
5. **`anchor_present`** — on-chain `statusOf(credentialId) == Valid` and the chain's stored `merkleRoot` matches the credential's?
6. **`issuer_authorized`** — on-chain `IssuerRegistry.isAuthorized(metadata.issuer)`?

The verifier can disable on-chain checks (`--offline`) for air-gapped or fast-path verification. The verifier can require a holder-bound proof to defend against presentation replay.

## 6. Threat model

See [SECURITY.md](SECURITY.md) for the full table. Highlights:

| Attack | Defense |
|---|---|
| Forged credential by an attacker who knows a real merkleRoot | The issuer signature must match — attacker would need the issuer's private key. |
| Tampering with a disclosed grade | Merkle proof fails — the leaf hash no longer matches what's at that position. |
| Brute-forcing hidden leaves from the public root | Per-claim 32-byte random salts make brute-forcing a 256-bit search space. |
| Replaying Alice's presentation as Bob | Verifier issues a fresh nonce, holder signs `keccak256(credentialId ‖ nonce)`. |
| Issuing credentials after losing accreditation | `isCurrentlyValid()` cross-checks the issuer is still active in `IssuerRegistry`. |
| Revoked credentials still being honored | `statusOf()` returns `Revoked`, fail. |
| Denial of service on revocation | Only the original issuer (or admin via `revokeIssuer`) can revoke. Anyone can read. |
| MEV / front-running on registration | Registrations are admin-only, no economic incentive to front-run. |

Out of scope (acknowledged limitations, see SECURITY.md):

- Compromised issuer keys: the system has no automatic recovery; admin must `revokeIssuer` and re-register the new key.
- Holder collusion across separate verifications: not addressed (would need ZK).
- Quantum-safe signatures: not in scope (would require migrating off ECDSA).

## 7. What's *not* in scope (and why)

- **Zero-knowledge proofs.** A ZK proof would let the holder prove "I have at least 3 courses with grade ≥ B" without revealing which. We chose Merkle selective disclosure because it satisfies the brief, is fully on-chain-auditable, and is implementable in ~600 lines. ZK would add ~5000 lines of circuit code and significant proving-time overhead for marginal additional privacy.
- **DIDs / decentralized identifiers.** The system uses opaque holder identifiers. They can be DIDs, Ethereum addresses, or strings — the system doesn't care; it only hashes them.
- **Full production identity wallet integration.** The browser dashboard proves the protocol and local-chain integration, but production wallet UX, DID resolution, and account recovery are separate product layers.

## 8. Files at a glance

| File | Lines | Role |
|---|---|---|
| [`contracts/src/IssuerRegistry.sol`](../contracts/src/IssuerRegistry.sol) | ~110 | On-chain issuer allowlist |
| [`contracts/src/CredentialRegistry.sol`](../contracts/src/CredentialRegistry.sol) | ~140 | Anchors + revocation |
| [`app/src/core/ecc.ts`](../app/src/core/ecc.ts) | ~140 | secp256k1 + EIP-191 |
| [`app/src/core/merkle.ts`](../app/src/core/merkle.ts) | ~150 | Domain-separated Merkle |
| [`app/src/core/credential.ts`](../app/src/core/credential.ts) | ~250 | Issuance + presentation + verification pipeline |
| [`app/src/chain/client.ts`](../app/src/chain/client.ts) | ~110 | ethers.js wrapper |
| [`app/src/web/main.ts`](../app/src/web/main.ts) | ~500 | Browser DApp dashboard |
| `app/src/{issuer,holder,verifier}/cli.ts` | ~250 total | Command-line tools |
| Tests | 23 + 26 = 49 cases | Foundry + vitest |

Total custom code: ~1,900 lines (contracts + core + CLI + web + tests). All passing.
