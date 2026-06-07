# Defense Q&A Sheet (Teacher-Facing)

This document provides technical, academically rigorous answers to key questions likely to be asked by the grading committee.

---

## 1. Core Architecture and Blockchain Rationale

### Q: Why use blockchain for this application?
**Answer**:
The blockchain acts as a decentralized trust anchor and status registry. In a traditional centralized system:
*   Issuers must host public API endpoints or databases that verifiers query, exposing student records and introducing a single point of failure.
*   If a university closes or its servers go offline, verifiers lose the issuer status and revocation source.

By using the blockchain:
1.  **Trust Root Registration**: The Ministry of Education (contract owner) registers authorized university identity keys on-chain (`IssuerRegistryV2`).
2.  **Cryptographic Anchoring**: When a credential is issued, its cryptographic commitments (EIP-712 metadata hashes and Merkle roots) are written to the chain (`CredentialRegistryV2`).
3.  **Decentralized Verification**: The cryptographic checks (signatures and Merkle paths) can be performed locally/off-chain. Issuer authorization and revocation status are read from the public blockchain registries, so the verifier does not need to trust a university API.

### Q: What data is stored on-chain vs. off-chain?
**Answer**:
*   **Off-chain**:
    *   Plaintext student data, course names, and grades.
    *   Cryptographic salts for each claim.
    *   Issuer secp256k1 EIP-712 signatures.
    *   Full Merkle tree structures.
*   **On-chain**:
    *   `IssuerRegistryV2`: Organization identity records (controller addresses, metadata URIs, and authorized keys per epoch).
    *   `CredentialRegistryV2`: Credential anchors (credential digest, Merkle root, holder commitment hash, timestamps, and packed bitmap revocation words).
*   **Rationale**:
    Storing Personally Identifiable Information (PII) on a public blockchain violates privacy regulations (like GDPR) and is prohibitively expensive in terms of gas. We keep the private transcript off-chain, and store only fixed-width hashes on-chain for integrity checks.

---

## 2. Cryptography and Selective Disclosure

### Q: How does selective disclosure work in this system?
**Answer**:
Selective disclosure is achieved using a **Salted Merkle Tree**:
1.  **Leaf Formation**: Each claim (e.g. `{"course": "Blockchain", "grade": "A"}`) is appended with a cryptographically secure 32-byte salt and serialized canonical JSON. A leaf is defined as:
    $$\text{Leaf} = \text{keccak256}(0x00 \mathbin{\Vert} \text{canonical\_json}(\{\text{credentialId}, \text{key}, \text{value}, \text{salt}\}))$$
2.  **Merkle Tree Building**: A binary Merkle tree is computed from all leaf hashes using domain separation ($0x01$ prefix for internal nodes):
    $$\text{Parent} = \text{keccak256}(0x01 \mathbin{\Vert} \text{Left} \mathbin{\Vert} \text{Right})$$
3.  **Redaction**: The holder can redact any claim. For redacted claims, only the sibling hashes in the Merkle path are revealed. For disclosed claims, the raw claim data (key, value, and salt) is shared.
4.  **Verification**: The verifier hashes the disclosed claims, climbs the Merkle path using the direction bits, and matches the computed root against the issuer-signed `merkleRoot` stored in the credential metadata. Live issuer and revocation checks still come from chain state.

### Q: Why use a Merkle tree instead of just revealing the whole transcript?
**Answer**:
Privacy and data minimization. A student applying for a programming job may want to prove they passed "Advanced Algorithms" without revealing their lower grade in an unrelated history class. A Merkle tree allows the student to construct mathematical proofs of individual claims while keeping the rest hidden, while verifying that the disclosed claims were part of the original, unmodified credential signed by the university.

### Q: Why are salts necessary in the Merkle tree leaves?
**Answer**:
Academic grades and course list namespaces have extremely low entropy. If leaves were not salted, an attacker knowing the Merkle root could brute-force guess the possible grades (e.g., trying "A", "B", "C" for common course names) to reconstruct the hidden claims. Adding a 32-byte high-entropy salt to each leaf preimage makes brute-force dictionary attacks computationally infeasible.

---

## 3. Registries, Authorization, and Revocation

### Q: How are issuers authorized, and how does key rotation work?
**Answer**:
*   **Authorization**: The contract owner (e.g., the regulator) registers organizations in `IssuerRegistryV2` with an ID, a controller address, and an initial signing key.
*   **Key Rotation (Epochs)**: An organization's lifecycle is structured in **Epochs**. A controller can rotate keys within the current epoch. If the registry owner suspends the organization, the current epoch is immediately terminated. Reinstatement starts a new epoch with a new initial signing key.
*   **Validity checks**: When checking if a key is authorized, `wasAuthorizedKeyAt(orgId, key, timestamp)` checks if the signing key was active and belonged to the correct epoch at the block time the credential was anchored. This prevents compromised or rotated keys from being back-dated.

### Q: How does credential revocation work?
**Answer**:
We implement **Packed Bitmap Revocation** in `CredentialRegistryV2`:
*   Each anchored credential is assigned a sequential, organization-scoped `revocationIndex`.
*   Rather than writing a boolean storage slot (costing 20,000 gas), we pack 256 revocation flags into a single `uint256` word.
*   To check if a credential is revoked, we locate the word and bit index:
    $$\text{wordIndex} = \text{revocationIndex} \gg 8$$
    $$\text{bitIndex} = \text{revocationIndex} \ \& \ 255$$
    $$\text{isRevoked} = (\text{bitmap}[\text{orgId}][\text{wordIndex}] \ \& \ (1 \ll \text{bitIndex})) \neq 0$$
*   This drops gas costs dramatically, especially when multiple credentials are revoked within the same storage word.

---

## 4. Security, Attacks, and Limitations

### Q: What attacks did you consider, and how are they mitigated?
**Answer**:
1.  **Replay Attacks (Presentation Theft)**: If a student submits a presentation to Verifier A, what stops Verifier A from submitting it to Verifier B?
    *Mitigation*: The holder must sign a `PresentationAuthorization` that binds the EIP-712 presentation digest to a verifier-provided high-entropy challenge `nonce`. Verifier B will reject the presentation if the nonce doesn't match their challenge or has already been consumed.
2.  **Second-Preimage Attacks (Merkle Tree)**: An attacker tries to present an internal node hash as a valid claim leaf.
    *Mitigation*: We implement domain-separated hashing. Leaf preimages are prefixed with `0x00`, and internal node preimages with `0x01`. The Solidity and TypeScript verifiers strictly enforce these prefixes during hashing.
3.  **Credential Cloning**: A student attempts to copy another student's credential and substitute their own address.
    *Mitigation*: The holder's address is bound inside the issuer's signed `AcademicCredential` metadata. Any change to the holder's address invalidates the issuer's EIP-712 signature.
4.  **Key Collisions / Namespace Poisoning**: An issuer attempts to overwrite another organization's credential ID.
    *Mitigation*: Anchors are scoped by organization ID and signer address in `CredentialRegistryV2`:
    $$\text{anchorKey} = \text{keccak256}(\text{abi.encode}(\text{orgId}, \text{signer}, \text{credentialId}))$$

### Q: What are the privacy limitations of this system?
**Answer**:
While undisclosed claims remain hidden, the `merkleRoot` is always public. If a credential contains very few claims and the salts are somehow compromised, the root could be recomputed to expose the structure. Furthermore, the holder commitment on-chain associates an organization and credential ID with a student's address hash. While this hides the student's identity from passive observers, a colluding issuer and verifier can link the hash back to the real-world student.

### Q: How is this different from a normal database application?
**Answer**:
In a normal database application, trust is operational: you trust that the database owner has not modified the record, that their API is secure, and that they will remain online.
In our system, trust is cryptographic: the university cannot change a grade once issued without breaking the signature, the student cannot fabricate courses or grades without breaking the Merkle proofs, and the verifier does not need to trust the database—they only trust the mathematics of the signatures, the Merkle tree, and the state of the blockchain.
