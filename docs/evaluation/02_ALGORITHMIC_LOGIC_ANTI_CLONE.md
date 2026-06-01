# Algorithmic Logic & Anti-Clone - 2.5 pts

## What Full Score Means

Rubric yêu cầu điểm cao khi project có logic thuật toán rõ ràng, có mô hình/custom math, không chỉ copy boilerplate. Với đề này, phần ăn điểm mạnh nhất là:

- ECC signing.
- Merkle tree selective disclosure.
- Canonical encoding.
- Domain separation.
- Salting chống brute force.
- Direction-bit Merkle proofs.
- Cross-layer TypeScript/Solidity compatibility.

## Evidence In This Project

| Concept | File |
|---|---|
| secp256k1 ECDSA signing | `app/src/core/ecc.ts` |
| Merkle tree custom implementation | `app/src/core/merkle.ts` |
| Credential lifecycle | `app/src/core/credential.ts` |
| Deterministic JSON | `app/src/core/canonical.ts` |
| Hash primitives | `app/src/core/hash.ts` |
| Solidity proof mirror | `contracts/src/CredentialRegistry.sol` |
| Merkle tests | `app/tests/merkle.test.ts` |
| Credential tests | `app/tests/credential.test.ts` |

## Core Algorithm Explanation

### 1. Credential signing

The issuer signs only the credential metadata:

```text
metadata = {
  version,
  id,
  issuer,
  holder,
  credentialType,
  schemaURI,
  issuedAt,
  expiresAt,
  merkleRoot
}

signature = secp256k1_ECDSA(EIP191(canonical_json(metadata)))
```

Why this matters:

- The signature authenticates the issuer.
- The `merkleRoot` inside metadata commits to all transcript claims.
- The verifier can validate a redacted presentation without seeing the full transcript.

### 2. Merkle leaf encoding

Each claim is encoded as:

```text
encodedClaim = canonical_json({ key, value, salt })
leafHash = keccak256(0x00 || encodedClaim)
```

Why `salt` matters:

- Grades are low entropy.
- Without salts, an attacker could guess possible course/grade combinations.
- A 32-byte salt makes hidden leaves infeasible to brute force.

### 3. Merkle internal nodes

```text
nodeHash = keccak256(0x01 || left || right)
```

Why domain separation matters:

- `0x00` means leaf.
- `0x01` means internal node.
- This prevents second-preimage confusion between a leaf and an internal node.

### 4. Direction-bit proof

Proof shape:

```text
proof = {
  siblings: bytes32[],
  positions: bool[]
}
```

Verification:

```text
current = leafHash(claim)
for each sibling:
  if positions[i] == true:
    current = hashNode(sibling, current)
  else:
    current = hashNode(current, sibling)
return current == merkleRoot
```

Why this is anti-clone:

- Many libraries use sorted-pair Merkle trees.
- This project intentionally keeps left/right direction bits.
- This makes the proof structure explicit and portable to Solidity.

## What To Show In The Browser

Open:

```bash
make web
```

Show:

1. Claim list has many claims.
2. Only selected claims appear in the presentation.
3. Merkle proof panel shows sibling hashes.
4. Hidden claim count proves the full transcript is not disclosed.

Say:

```text
The verifier receives only selected claims plus Merkle proofs. The hidden claims are neither transmitted nor stored on-chain. The Merkle root is enough to bind the selected claim to the original issuer-signed credential.
```

## What To Show In Code

Open these sections:

- `app/src/core/merkle.ts`: `hashLeaf`, `hashNode`, `verifyMerkleProof`.
- `app/src/core/credential.ts`: `issueCredential`, `createPresentation`, `verifyPresentation`.
- `contracts/src/CredentialRegistry.sol`: `verifyClaimHash`.

Say:

```text
The Merkle proof algorithm is implemented in TypeScript for normal verifier use and mirrored as a pure Solidity function to prove cross-runtime compatibility. This makes the implementation more than a UI demo; the cryptographic commitment scheme can be reused by future on-chain verifier contracts.
```

## Teacher Questions And Answers

**Q: Why not just hash the whole transcript?**  
A: Hashing the whole transcript proves integrity only if the verifier sees the whole transcript. Merkle trees allow verifying a subset without revealing the rest.

**Q: Why add salt if the Merkle root is a hash already?**  
A: A root alone does not stop dictionary attacks on low-entropy leaves. Grades and course names are guessable. Salt makes each leaf high entropy.

**Q: Why canonical JSON?**  
A: Without canonicalization, two equivalent objects may serialize differently and produce different hashes. Canonical JSON makes signing and hashing deterministic.

**Q: Why not use a Merkle library?**  
A: The project needs custom leaf encoding, domain separation, salts, and explicit direction bits. Implementing this directly demonstrates algorithmic understanding and avoids hidden defaults.

## Full-Point Checklist

- [ ] Explain signed metadata and Merkle root commitment.
- [ ] Explain why claims are salted.
- [ ] Explain `0x00` leaf prefix and `0x01` node prefix.
- [ ] Explain direction-bit proofs.
- [ ] Show tampering changes the leaf hash and breaks verification.
- [ ] Mention TypeScript and Solidity proof compatibility.

## Common Mistakes That Lose Points

- Saying "Merkle tree encrypts data". It does not encrypt; it commits to data.
- Forgetting salt and domain separation.
- Claiming hidden claims are impossible to guess without explaining salts.
- Not distinguishing signature verification from Merkle proof verification.
- Presenting the algorithm as library magic instead of custom logic.
