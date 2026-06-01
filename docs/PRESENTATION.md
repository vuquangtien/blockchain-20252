# Presentation & Defense Guide

Use this as the 5-minute live demo script.

## 1. Opening claim

This project is a decentralized academic credential system. The university signs a credential with ECC, the transcript is committed into a salted Merkle tree, and the student can reveal only selected claims. The blockchain stores authorized issuers and credential revocations, not the full transcript.

## 2. Demo flow

```bash
make check
make demo
```

Then open the dashboard:

```bash
make web
```

In the dashboard:

1. Show the credential root, issuer address, holder address, and hidden claim count.
2. Select only `degree:field`, `gpa`, and `thesis`.
3. Run offline verification and point out signature, Merkle proofs, and holder nonce checks.
4. Start Anvil, deploy locally, paste registry addresses, register issuer, anchor credential, and verify against chain.
5. Revoke the credential and show verification flips from valid to invalid.

## 3. Rubric map

| Rubric item | Evidence |
|---|---|
| Core technical execution | Foundry contracts, TypeScript CLIs, Vite DApp, live Anvil integration. |
| Algorithmic logic & anti-clone | Custom salted, domain-separated Merkle tree with direction-bit proofs; ECC signing; Solidity proof mirror. |
| Security, gas & performance | Access control, zero-value validation, hashed holder identifiers, revocation, expiry, no transcript on-chain, optimized storage fields. |
| Technical documentation | `REPORT.md`, `DESIGN.md`, `SECURITY.md`, `USAGE.md`, diagrams in README, this defense guide. |
| Teamwork & presentation | Repeatable commands, browser dashboard, tamper/revoke failure cases ready for live Q&A. |

## 4. Expected questions

**Why not store the transcript on-chain?**  
Because transcripts contain private personal data. The chain stores only commitments: issuer, holder hash, Merkle root, timestamps, and revocation status.

**Why does the issuer sign metadata instead of all claims?**  
The metadata contains the Merkle root. The root commits to every claim, so signing metadata authenticates the whole transcript while still allowing redacted presentations.

**Why add salts to every leaf?**  
Grades are low entropy. Without salts, an observer could brute-force hidden course/grade leaves. A 32-byte random salt makes that infeasible.

**Why use secp256k1?**  
It is Ethereum-native. The issuer's signing key and on-chain registry identity are the same address, and verification interoperates with EVM tooling.

**What happens if a university key is compromised?**  
The admin revokes that issuer address. Existing credentials from that key fail `issuer_authorized`; the university must rotate keys and reissue valid credentials.

**What is the limitation compared with zero knowledge?**  
Merkle selective disclosure reveals the selected claims. It cannot prove aggregate predicates like "GPA >= 3.5" without revealing GPA. That extension would require ZK circuits.
