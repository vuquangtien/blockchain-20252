# Threat Model & Security Notes

This document enumerates attacks the system is designed to resist, attacks it does *not* resist (and why), and the operational practices required to keep it secure in production.

## 1. In-scope threats

### 1.1 Credential forgery by a third party

**Attack.** Mallory wants to claim "I have a Bachelor's from HUST" without HUST ever issuing such a credential.

**Defense.** A valid credential needs an issuer signature recoverable to a registered issuer's address. Mallory does not have HUST's private key. Recovering the address from a forged signature would require breaking secp256k1 ECDSA — the same security assumption Bitcoin and Ethereum rest on.

### 1.2 Tampering with disclosed claims

**Attack.** Alice was given a B+ in MATH201 but wants to present "A+" instead.

**Defense.** Each claim leaf is `keccak256(0x00 ‖ canonical({key, value, salt}))`. Changing the value changes the leaf hash; the Merkle proof no longer reproduces the issuer-signed `merkleRoot`. Verifier check `merkle_proof:<key>` fails.

Tested in [`credential.test.ts > rejects a presentation when a disclosed claim was tampered with`](../app/tests/credential.test.ts).

### 1.3 Brute-forcing hidden claims from the public root

**Attack.** Mallory observes Alice's `merkleRoot` on-chain. Knowing she's a CS student, she wants to learn her grades by trying every (course × grade) combination and seeing which one is in the tree.

**Defense.** Every claim has a per-claim 32-byte random salt mixed into the leaf hash. A brute force over salts is infeasible (256-bit search space).

This is the canonical defense against "low-entropy" leaves and is critical when the claim space is small (grades A/B/C/D/F + 70 courses = a few thousand combinations, easily brute-forced without salts).

### 1.4 Presentation replay across verifiers

**Attack.** Alice gives a presentation to employer X. Employer X re-uses it to apply to employer Y on Alice's behalf without Alice's knowledge.

**Defense.** The verifier issues a fresh 32-byte nonce, the holder signs `keccak256(credentialId ‖ nonce)`. Employer Y's nonce will be different; Employer X cannot produce a valid signature for it without Alice's private key.

Tested in [`credential.test.ts > holder proof binds presentation to verifier nonce`](../app/tests/credential.test.ts).

### 1.5 Issuance after losing accreditation

**Attack.** HUST is removed from the issuer registry due to an accreditation issue, but it has a recently-issued credential that the holder is now using.

**Defense.** Verification calls `issuerRegistry.isAuthorized(issuer)` at verification time. If `false`, verification fails regardless of when the credential was signed.

Operational note: this is **strict revocation**. If the registry decides retroactive invalidation is too harsh (legacy credentials should remain valid), the contract can be extended with a "registered-at" timestamp check at the verifier policy layer. Out of scope for this implementation.

Tested in [`credential.test.ts > issuer must be currently authorized`](../app/tests/credential.test.ts) and the demo step 9.

### 1.6 Revoked credentials being honored

**Attack.** A credential was issued, then revoked. The holder still tries to present it.

**Defense.** `CredentialRegistry.statusOf(credentialId)` returns `Revoked`. The verifier rejects.

### 1.7 Unauthorized revocation

**Attack.** Mallory tries to revoke Alice's credential to grief her.

**Defense.** `revokeCredential` checks `msg.sender == anchor.issuer`. Only the original issuer can revoke. The Admin can revoke the *issuer* (which has a different effect: cascades to every credential they signed) but cannot pick out an individual credential to revoke.

### 1.8 Cross-credential proof confusion

**Attack.** Mallory takes a Merkle proof from credential A and tries to use it to "prove" a claim against credential B's `merkleRoot`.

**Defense.** Domain-separated leaf hashes (prefix `0x00`) and the requirement that the proof reproduce the *exact* expected root mean a proof for one root is statistically guaranteed not to verify against any other root.

### 1.9 Holder identification leak via on-chain anchor

**Attack.** Mallory wants to enumerate every student of HUST by reading on-chain events.

**Defense.** Only `keccak256(holder)` is anchored, not the holder's identifier itself. Without knowing the identifier off-chain, Mallory cannot link the hash to a person. Alice can still prove she's the holder by signing with her own key (holder proof) — and any verifier she shows her credential to can check the link.

Note: an attacker who *guesses* identifiers (e.g. iterating "alice@hust.edu.vn", "bob@hust.edu.vn") can confirm/deny whether each guess corresponds to an anchored credential. This is an inherent limitation of public anchoring without ZK or commit-reveal patterns. We accept this trade-off because the alternative (no anchoring) loses revocation.

## 2. Out-of-scope threats (acknowledged)

### 2.1 Compromised issuer key

**Scenario.** HUST's signing key is leaked.

**What the system can do.** Admin can revoke the issuer (`revokeIssuer`). All credentials signed by that key fail verification because `isCurrentlyValid` returns false.

**What the system can NOT do.** Re-issue all the legitimate credentials with a new key. The university must:
1. Generate a new keypair.
2. Be re-registered by the admin.
3. Re-issue and re-anchor all currently-valid credentials.

A more sophisticated design could:
- Use a **rotated key set** with the registry holding multiple authorized keys per issuer.
- Use **HSM / multisig** signing to make compromise harder.
- Use a **revocation epoch** to limit the blast radius.

These are reasonable extensions but not in the brief.

### 2.2 Holder collusion across verifiers

**Scenario.** Alice colludes with Bob: she lets Bob present her credential to a different verifier, claiming the same achievements.

**What the system does.** Holder-bound proofs (signing the verifier nonce) prevent the *naive* version of this. But if Alice gives Bob her holder *private key* directly, Bob can produce a holder proof. The system does not detect this; it has no concept of "holder uniqueness".

A complete defense requires biometric or hardware-backed holder identity, which is beyond the scope of a credential-issuance system.

### 2.3 Quantum adversary

**Scenario.** A future attacker with a sufficiently large quantum computer can break secp256k1 ECDSA in polynomial time.

**What the system does.** Nothing. ECDSA is not post-quantum secure. Migration to lattice-based signatures (Dilithium) would require both contract upgrades and re-issuance.

### 2.4 Smart-contract bugs / upgrade safety

**Scenario.** A bug in `CredentialRegistry` allows non-issuers to mark credentials as revoked.

**What the system does.** Tests cover the obvious paths (23 contract tests, including fuzz tests), but the contracts are not formally verified or audited. For a real deployment:

- Run a third-party audit (Trail of Bits, OpenZeppelin, ConsenSys Diligence).
- Use a proxy pattern (e.g. UUPS) with a timelock so upgrades can be reviewed.
- Run on a testnet for at least 3 months before mainnet deploy.

### 2.5 RPC / endpoint trust

**Scenario.** A verifier uses a malicious RPC endpoint that returns false `isAuthorized` results.

**What the system does.** Trusts the RPC. Mitigation: run your own node, or use multiple RPC providers and require quorum.

## 3. Operational guidance

### Key management

- **Admin key**: store in a hardware wallet (Ledger, GridPlus). Never paste into a CLI.
- **Issuer keys**: ideally HSM-backed. The CLI's `keygen` is for development only.
- **Holder keys**: each student gets their own keypair. Wallet apps (MetaMask, Rainbow, Argent) work — the holder key is a regular Ethereum key.

### Network deployment

- For demos: local Anvil (this repo).
- For staging: Sepolia or another public testnet.
- For production: a cost-stable L2 (Base, Arbitrum, OP Stack, Polygon zkEVM). Avoid Ethereum mainnet for high-volume issuance — gas costs would dominate.

### Monitoring

- Index `IssuerRegistered`, `IssuerRevoked`, `CredentialAnchored`, and `CredentialRevoked` events.
- Alert on unexpected `IssuerRevoked` events — that should always be a deliberate admin action.
- Alert if any `IssuerRegistry.owner()` change occurs.

### Privacy hygiene

- Holder identifiers should be **opaque** (DIDs or per-issuer pseudonyms), not raw email addresses or national IDs.
- Schema URIs should NOT contain the holder's name.
- Off-chain credential storage should be encrypted at rest on the holder's device.

## 4. Tested attack scenarios

| # | Test | Lives in |
|---|---|---|
| 1 | Forged issuer signature | `credential.test.ts > rejects when the issuer signature is forged` |
| 2 | Tampered claim value | `credential.test.ts > rejects a presentation when a disclosed claim was tampered with` |
| 3 | Forged Merkle proof for a fake claim | `credential.test.ts > an attacker cannot forge a claim by manufacturing a Merkle proof` |
| 4 | Sibling tampering | `merkle.test.ts > rejects a proof with a wrong sibling` |
| 5 | Position-bit flipping | `merkle.test.ts > rejects a proof with flipped position bit` |
| 6 | Replay across verifier nonces | `credential.test.ts > holder proof binds presentation to verifier nonce` |
| 7 | Revoked credential still presented | `credential.test.ts > revoked credentials fail verification` |
| 8 | Unauthorized issuer (revoked) | `credential.test.ts > issuer must be currently authorized` |
| 9 | Unauthorized revoker | `CredentialRegistry.t.sol > test_NonIssuerCannotRevoke` |
| 10 | Cross-issuer interference | `CredentialRegistry.t.sol > test_UnauthorizedCannotAnchor` |
| 11 | Expired credential | `credential.test.ts > rejects expired credentials` |
| 12 | Duplicate-leaf rejection | `merkle.test.ts > rejects building with duplicate leaves` |
| 13 | Anchor merkle-root mismatch | `credential.test.ts > on-chain anchor must match credential's merkleRoot` |
| 14 | Zero credential ID rejected | `CredentialRegistry.t.sol > test_ZeroCredentialIdRejected` |
| 15 | Zero holder hash rejected | `CredentialRegistry.t.sol > test_ZeroHolderHashRejected` |
| 16 | Solidity Merkle proof verification | `CredentialRegistry.t.sol > test_VerifyClaimHashMatchesOffchainMerkleShape` |
| 17 | Solidity Merkle length mismatch rejected | `CredentialRegistry.t.sol > test_VerifyClaimHashRejectsLengthMismatch` |

The fuzz test `testFuzz_AnchorRevokeRoundtrip` runs 256 random configurations to validate the anchor → revoke flow under arbitrary inputs.
