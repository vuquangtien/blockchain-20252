# Academic Credential Protocol V2 - Off-chain Core Specification

> [!WARNING]
> **Off-chain Only**: Protocol V2 is currently implemented exclusively for off-chain client use (CLIs, libraries, and Vite web dashboard). Direct smart contract integration will follow in a later phase.

Protocol V2 enhances the decentralized academic credential system by addressing critical design flaws present in V1:
- **Holder-Binding**: Ensures credentials cannot be leaked or repackaged by third parties without the holder's EIP-712 consent.
- **Request Policies**: Normalizes verifier policies (required claims, accepted issuers, accepted schemas) and hashes them inside the signed request.
- **Replay Protection**: Binds presentations to a specific verifier-signed request digest and enforces single-use nonce consumption.
- **Typed-Signature standard**: Migrates raw JSON string signatures to the EIP-712 typed data standard.

---

## 1. EIP-712 Struct Types & Domains

All domains omit `chainId` and `verifyingContract` to ensure cross-chain credential portability.

### 1.1 Credential V2
- **Domain Name**: `AcademicCredentialProtocol`
- **Domain Version**: `2`
- **Primary Type**: `AcademicCredential`
- **Solidity Struct Signature**:
  ```solidity
  struct AcademicCredential {
      bytes32 id;
      bytes32 issuerOrganizationId;
      address issuerSigningAddress;
      address holder;
      string credentialType;
      string schemaURI;
      uint64 issuedAt;
      uint64 expiresAt;
      bytes32 merkleRoot;
      uint32 claimCount;
  }
  ```

### 1.2 VerificationRequest V1
- **Domain Name**: `AcademicCredentialRequest`
- **Domain Version**: `1`
- **Primary Type**: `AcademicCredentialRequest`
- **Solidity Struct Signature**:
  ```solidity
  struct AcademicCredentialRequest {
      bytes32 id;
      address verifier;
      string audience;
      bytes32 nonce;
      bytes32 requiredClaimsHash;
      bytes32 acceptedIssuerIdsHash;
      bytes32 acceptedSchemaURIsHash;
      uint64 issuedAt;
      uint64 expiresAt;
  }
  ```

### 1.3 PresentationAuthorization V1
- **Domain Name**: `AcademicCredentialPresentation`
- **Domain Version**: `1`
- **Primary Type**: `AcademicCredentialPresentation`
- **Solidity Struct Signature**:
  ```solidity
  struct AcademicCredentialPresentation {
      bytes32 credentialDigest;
      bytes32 requestDigest;
      bytes32 disclosureDigest;
      address holder;
      uint64 createdAt;
      uint64 expiresAt;
  }
  ```

---

## 2. Request Wire Format & Policy Hashing

### 2.1 Complete Wire Format
The `VerificationRequestV1` wire object contains both the raw lists of policy rules and their pre-computed cryptographic hashes:
```json
{
  "id": "0x...",
  "verifier": "0x...",
  "audience": "String",
  "nonce": "0x...",
  "requiredClaimsHash": "0x...",
  "acceptedIssuerIdsHash": "0x...",
  "acceptedSchemaURIsHash": "0x...",
  "issuedAt": 1700000000,
  "expiresAt": 1700000900,
  "requiredClaimKeys": ["gpa"],
  "acceptedIssuerIds": ["0x..."],
  "acceptedSchemaURIs": ["https://schema.hust.edu.vn"],
  "signature": "0x..."
}
```

#### 2.2 Sorting & Hashing Algorithm
To guarantee determinism:
1. **Duplicate Rejection**: Duplicate entries in policy arrays are strictly rejected during creation, validation, and hashing, never silently deduplicated.
2. **Array Sorting**: Valid unique input arrays are sorted using deterministic ASCII/UTF-16 code unit ordering (i.e. `a < b ? -1 : a > b ? 1 : 0`).
3. **Canonical Serialization**: The sorted array of strings is serialized into a JSON string using RFC 8785 Canonical JSON Serialization.
4. **Hashing**: The serialized canonical string is hashed using `keccak256`.

```typescript
// Example Hashing Order
const sorted = [...arr].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const canonicalString = canonicalize(sorted);
const hash = keccak256(utf8(canonicalString));
```

---

## 3. Merkle Tree & Claim Leaf Structure

To prevent second-preimage attacks, V2 utilizes domain-separated tree hashing:
- **Leaf Hash**: `keccak256(0x00 || canonical_json({credentialId, key, value, salt}))`
- **Node Hash**: `keccak256(0x01 || left || right)`

Including `credentialId` inside the leaf preimage ensures that claim leaves cannot be replayed or combined across different credentials, establishing strong cryptographic encapsulation.

---

## 4. Strict Validation Bounds

All operations enforce strict runtime schema validations:
- **Claim Limits**: 1 to 256 claims per credential. `claims.length` must exactly match `claimCount`.
- **Policy Array Limits**: The three policy arrays (`requiredClaimKeys`, `acceptedIssuerIds`, `acceptedSchemaURIs`) must contain between 1 and 256 entries.
- **Presentation Disclosures**: 1 to 256 disclosures.
- **Claim Keys**: 1 to 128 ASCII characters from the set `[a-zA-Z0-9:._/-]`.
- **String Length Limits**:
  - `credentialType`: <= 128 UTF-8 bytes.
  - `schemaURI`: <= 512 UTF-8 bytes. Must prefix with `https:` or `ipfs:`.
  - `audience`: <= 256 UTF-8 bytes.
- **Identifiers**: Salts, IDs, nonces, roots, and digests must be exact nonzero 32-byte hex values (regex: `/^0x[0-9a-fA-F]{64}$/`).
- **Addresses**: Verifier, issuer, and holder addresses must be valid nonzero Ethereum addresses (regex: `/^0x[0-9a-fA-F]{40}$/`).
- **Merkle Proofs**: Proof elements must be exact 32-byte hex values (where zero is allowed, using `bytes32Schema`). Proof siblings array length must equal positions array length (both bounded <= 8).
- **Timestamps**: Safe integers in range `0..18446744073709551615` (uint64).
- **Creation Parameter Validation**: The creation APIs `issueCredentialV2` and `createVerificationRequest` enforce strict parameter schemas (`issueParamsSchema`, `requestParamsSchema`) rejecting unrecognized keys, and perform strict timestamp verification. `createPresentationV2` does not use a parameter-object Zod schema; instead, it semantically validates its input `credential` and `request` objects using their respective parsers and performs semantic validation on its positional timing/disclosure arguments.

---

## 5. Verification Execution Order and Failures

The `verifyPresentationV2` operation performs strict, non-throwing validation in the following order:

1. **Presentation Structure Check**: Parsed with `parsePresentationV2`. Fails with `MALFORMED_INPUT`.
2. **Request Structure Check**: Parsed with `parseVerificationRequestV1`.
   - Arrays must be sorted and unique.
   - Hashes must match the recomputed hashes from arrays.
   - Fails with `MALFORMED_INPUT`.
3. **Replay Protection**: `isConsumed(req.id)` checks via `ReplayGuard`. Fails with `REPLAY_DETECTED` or `REPLAY_GUARD_ERROR`.
4. **Disclosed Claims Value Parsing**: Depth checks (<=8), canonical serialization size (<=4096B), no sparse arrays, no prototype polluting keys. Fails with `MALFORMED_INPUT`.
5. **Credential Lifetimes & Skew**:
   - Skew validation on `credential.issuedAt`. Fails with `FUTURE_TIMESTAMP`.
   - Credential expiration `credential.expiresAt` (when `expiresAt != 0`). Fails with `INVALID_CREDENTIAL_EXPIRED`.
   - Malformed timestamp checks (e.g. `expiresAt <= issuedAt`). Fails with `MALFORMED_INPUT`.
6. **Request Lifetimes & Skew**:
   - Skew validation on `request.issuedAt`. Fails with `FUTURE_TIMESTAMP`.
   - Request expiration check (current time > `request.expiresAt` or request lifetime > 15m). Fails with `INVALID_REQUEST_EXPIRED`.
   - Malformed timestamp checks. Fails with `MALFORMED_INPUT`.
7. **Presentation Lifetimes & Skew**:
   - Skew validation on `presentationAuthorization.createdAt`. Fails with `FUTURE_TIMESTAMP`.
   - Presentation expiration check (current time > `expiresAt` or presentation lifetime > 5m). Fails with `INVALID_PRESENTATION_EXPIRED`.
   - Malformed timestamp checks. Fails with `MALFORMED_INPUT`.
8. **Inter-object Time Ordering**:
   - Presentation `createdAt` < Request `issuedAt`. Fails with `INVALID_PRESENTATION_TIME`.
   - Presentation `expiresAt` > Request `expiresAt`. Fails with `INVALID_PRESENTATION_OUTLIVES_REQUEST`.
9. **Audience Check**: Ensure `request.audience` matches expected audience. Fails with `INVALID_AUDIENCE`.
10. **Optional Request Digest Match**: Fails with `INVALID_BINDING`.
11. **Policy Content Enforcement**:
    - Issuer organization ID is in `req.acceptedIssuerIds`. Fails with `POLICY_UNAUTHORIZED_ISSUER`.
    - Schema URI is in `req.acceptedSchemaURIs`. Fails with `POLICY_UNAUTHORIZED_SCHEMA`.
    - Disclosed keys list matches `req.requiredClaimKeys` exactly. Fails with `POLICY_DISCLOSURE_MISMATCH`.
12. **Signature Recoveries**:
    - Verifier signature recovery. Fails with `INVALID_VERIFIER_SIGNATURE`.
    - Issuer signature recovery. Fails with `INVALID_ISSUER_SIGNATURE`.
    - Holder signature recovery. Fails with `INVALID_HOLDER_SIGNATURE`.
13. **Merkle Proof Verification**: Proof paths checked against `credential.merkleRoot`. Fails with `INVALID_MERKLE_PROOF`.
14. **Digest Bindings**: Verify `credentialDigest`, `requestDigest`, and `disclosureDigest` inside `presentationAuthorization`. Fails with `INVALID_BINDING`.
15. **ReplayGuard Finalization**: Call `replayGuard.consume(req.id)` ONLY after every other step succeeds. Fails with `REPLAY_GUARD_ERROR`.

---

## 6. Security, Privacy & Replay Considerations

### 6.1 ReplayGuard Expectations
- `ReplayGuard` must be a single-use consumer. Once a request ID is successfully verified, its ID is consumed. Any further presentation verification attempts using that request ID must fail instantly.

### 6.2 Cross-Chain Domain Replay Considerations
- To maintain cross-chain credential portability, EIP-712 domains deliberately omit `chainId` and `verifyingContract`. This allows credentials to be presented and verified across multiple chains.
- **Risk mitigation**: To prevent cross-chain presentation replays, verifiers MUST use unique, high-entropy nonces in verification requests and keep a persistent, stateful `ReplayGuard` shared across all verification channels.

### 6.3 Selective-Disclosure Privacy Limitations
- Selective disclosure allows holders to reveal only a subset of their credential claims.
- **Privacy leak warning**: Although claims not disclosed are kept hidden, the credential's `merkleRoot` is always revealed in the `CredentialV2` struct. If the full set of claims was previously publicized or is brute-forceable (e.g., small search space), an observer might reconstruct the undisclosed claims by brute-forcing and checking if the computed Merkle root matches the revealed root. Using secure, high-entropy 32-byte salts for all claims prevents this attack.
