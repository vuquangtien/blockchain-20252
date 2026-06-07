# Final Grading Trace Document

This document traces the Capstone Rubric criteria (defined in [Blockchain scale points.pdf](../../Blockchain%20scale%20points.pdf)) to the exact implementation files, test cases, CLI commands, and visual UI moments. It explicitly highlights how the codebase **exceeds the baseline requirements** through **Protocol V2** (off-chain EIP-712 binding, verification requests, salted Merkle trees, epoch-based key rotation, and packed bitmap revocation registries).

---

## 1. Core Technical Execution (Weight: 3.0 pts)

**Rubric Target (Excellent 9-10)**: Flawless contract logic; proficient use of Hardhat/Foundry; seamless Frontend integration.

### Codebase Evidence
*   **Smart Contracts (Solidity)**:
    *   `IssuerRegistryV2.sol` ([contracts/src/IssuerRegistryV2.sol](../../contracts/src/IssuerRegistryV2.sol)): Handles multi-epoch organization registration, initial setup of authorized keys, controller metadata modification, suspension, reinstatement, and historical signer key verification.
    *   `CredentialRegistryV2.sol` ([contracts/src/CredentialRegistryV2.sol](../../contracts/src/CredentialRegistryV2.sol)): Manages organization-scoped signer namespace anchoring (`anchorKey`), holder commitment hashing (`holderCommitment`), expiry, and packed bitmap revocation.
*   **Testing and Validation (Foundry)**:
    *   70 tests passing across 4 test suites. Run command: `make check`.
    *   Detailed edge cases, unauthorized access, time travel (warp), lifecycle transitions, and fuzzing are implemented in [IssuerRegistryV2.t.sol](../../contracts/test/IssuerRegistryV2.t.sol) and [CredentialRegistryV2.t.sol](../../contracts/test/CredentialRegistryV2.t.sol).
*   **Frontend Integration (Vite DApp)**:
    *   `main.ts` ([app/src/web/main.ts](../../app/src/web/main.ts)): A responsive browser dashboard built with vanilla CSS.
    *   Integrates the shared TypeScript cryptographic core (`app/src/core/v2/*.ts`) and live chain config helpers (`app/src/web/chainConfig.ts`, `app/src/util/config.ts`).
    *   Features local provider support, dynamically loading configuration from `/chain-v2.json`, switching workspaces, and interactive selective disclosure verification.

### Demo & Verification Moments
*   **Command Line Verification**: Running `make check` builds all artifacts and executes 70 Foundry tests plus 135 Vitest unit tests.
*   **CLI End-to-End**: Running `make demo` runs the V1 Happy Path. Running `make demo-v2` launches or reuses the live-local Anvil chain, deploys V2 contracts, registers the demo organization, writes configuration, and prints a product URL for the browser app.
*   **UI Integration**: Load the printed product URL. In the **Student Wallet** workspace, toggle checkboxes next to transcript claims. Note the real-time update of the revealed vs hidden facts count. Open **Evidence / Advanced** to inspect salts, Merkle paths, and raw values.

---

## 2. Algorithmic Logic & Anti-Clone (Weight: 2.5 pts)

**Rubric Target (Excellent 9-10)**: Clear custom math modeling (Bonding curves/ZK) preventing simple code cloning; correct application of theoretical concepts (ECC, PoS) with minor modifications.

### Exceeding the Baseline
Instead of relying on standard boilerplate libraries, this project implements a **custom, domain-separated cryptographic protocol** modeled on **W3C Verifiable Credentials** and **EIP-712 typed-signing standards**.

### Cryptographic Modeling & Implementation
1.  **EIP-712 Typed Signing**:
    *   Instead of signing generic string representations, Protocol V2 defines typed structs and domain parameters to protect users from signing misleading data.
    *   Defined in `types.ts` ([app/src/core/v2/types.ts](../../app/src/core/v2/types.ts)): `AcademicCredential`, `AcademicCredentialRequest`, and `AcademicCredentialPresentation`.
2.  **Domain-Separated Merkle Leaf & Node Hashing**:
    *   `merkle.ts` ([app/src/core/v2/merkle.ts](../../app/src/core/v2/merkle.ts)) implements strict prefixes to prevent second-preimage attacks:
        *   Leaf preimage: `keccak256(0x00 || canonical_json({credentialId, key, value, salt}))`
        *   Internal node preimage: `keccak256(0x01 || left || right)`
3.  **Entropy Salts Per Claim**:
    *   Every transcript leaf is fuzzed/salted with a cryptographically secure 32-byte value (`salt`) generated during issuance. This prevents dictionary brute-force attacks on low-entropy fields (e.g. GPA "A", "B", "C").
4.  **Direction-Bit Merkle Proofs**:
    *   Does not use sorted-pair nodes. It keeps explicit position indices (boolean direction bits) for exact proof tracing.
    *   Solidity mirror verification: `verifyClaimHash` in [CredentialRegistryV2.sol](../../contracts/src/CredentialRegistryV2.sol) replicates the exact domain-separated direction-bit verification algorithm on-chain.
5.  **Holder Binding & Replay Protection**:
    *   `PresentationAuthorization` requires the holder to sign a challenge digest bound to the verifier's custom `nonce` and the `requestDigest`. This prevents third parties from stealing and re-releasing revealed presentations.

### Tests & Files
*   [protocol.ts](../../app/src/core/v2/protocol.ts): EIP-712 hashing and sign/verify pipeline.
*   [v2.test.ts](../../app/tests/v2.test.ts): Includes 69 dedicated tests covering sorted array policy hashing, timestamp skews, EIP-712 signature recovery, and selective disclosures.

---

## 3. Security, Gas & Performance (Weight: 2.0 pts)

**Rubric Target (Excellent 9-10)**: Robust security (Reentrancy guards); optimized Gas usage; efficient storage.

### Security Implementation
*   **Signer-Scoped Namespace**:
    *   To prevent different organizations or compromised signers from colliding or poison-anchoring the same credential ID, the registry scopes each anchor key:
        $$\text{anchorKey} = \text{keccak256}(\text{abi.encode}(\text{orgId}, \text{signer}, \text{credentialId}))$$
*   **Privacy-Preserving Holder Commitment**:
    *   Plaintext holder addresses are never recorded in public storage. Instead, the contract stores a cryptographic hash commitment:
        $$\text{holderCommitment} = \text{keccak256}(\text{abi.encode}(\text{orgId}, \text{signer}, \text{credentialId}, \text{holderAddress}))$$
*   **Access Controls**:
    *   Uses `Ownable2Step` in [IssuerRegistryV2.sol](../../contracts/src/IssuerRegistryV2.sol) for secure contract ownership transfer.
    *   Only organization controllers can manage epoch keys and propose controller updates. Only the owner can suspend/reinstate organizations.

### Gas and Storage Optimization
*   **Packed Bitmap Revocation**:
    *   Rather than setting one boolean per slot (20,000 gas per update), V2 packs 256 revocation flags into a single `uint256` word using bit shifting.
    *   Gas costs drop to `11,842` for updates within an already initialized word.
*   **Gas Snapshot Benchmarks**:
    *   Recorded in [.gas-snapshot](../../contracts/.gas-snapshot).
    *   Anchoring a credential takes `190,840` gas. Revoking a key takes `8,185` gas.

### Tests
*   `testFuzz_BitmapWordAndBitPositioning` and `testFuzz_RevokedStatusDominatesExpiryAndIssuerInactive` in [CredentialRegistryV2.t.sol](../../contracts/test/CredentialRegistryV2.t.sol) verify boundary safety and bitmap updates.

---

## 4. Technical Documentation (Weight: 1.5 pts)

**Rubric Target (Excellent 9-10)**: High-quality report; clear architecture diagrams, math proofs, and setup guide.

### Codebase Evidence
The repository contains a professional documentation suite covering every aspect of the project:
1.  **Architecture & Rationale**:
    *   `README.md` ([README.md](../../README.md)): Features a High-level architecture text-diagram, requirement mappings, quick-start guide, and test statistics.
    *   `DESIGN.md` ([docs/DESIGN.md](../DESIGN.md)): Explains secp256k1 selection, EIP-191 wrapping, and cryptographic design tradeoffs.
2.  **Protocol & Contract Deep Dives**:
    *   `PROTOCOL_V2.md` ([docs/PROTOCOL_V2.md](../PROTOCOL_V2.md)): Formal off-chain EIP-712 schema, sorting/hashing algorithms, and strict validation limits.
    *   `ONCHAIN_V2.md` ([docs/ONCHAIN_V2.md](../ONCHAIN_V2.md)): Contract lifecycles, signer namespaces, bitmap addressing formulas, and gas details.
3.  **System Diagnostics**:
    *   `REPORT.md` ([docs/REPORT.md](../REPORT.md)): Academic-style technical report.
    *   `SECURITY.md` ([docs/SECURITY.md](../SECURITY.md)): Threat model, out-of-scope risks, and tested mitigation checks.

---

## 5. Teamwork & Presentation (Weight: 1.0 pt)

**Rubric Target (Excellent 9-10)**: Excellent collaboration; polished live demo; professional defense of choices.

### Presentation Material
*   `PRESENTATION_RUNBOOK.md` ([docs/PRESENTATION_RUNBOOK.md](../PRESENTATION_RUNBOOK.md)): A step-by-step 7-10 minute live demo script for 4 team members with exact commands, browser interactions, speaker assignments, and a safe fallback plan.
*   `DEFENSE_QA.md` ([docs/DEFENSE_QA.md](../DEFENSE_QA.md)): Standardized Q&A catalog covering architectural design, cryptographic selections, attack mitigations, privacy issues, and V2 key management.
*   `LIVE_DEMO_V2.md` ([docs/LIVE_DEMO_V2.md](../LIVE_DEMO_V2.md)): Technical operational details of the automated `make demo-v2` script.
