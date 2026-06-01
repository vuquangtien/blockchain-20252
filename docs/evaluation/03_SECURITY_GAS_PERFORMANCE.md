# Security, Gas & Performance - 2.0 pts

## What Full Score Means

Rubric yêu cầu:

- Security best practices.
- Gas/storage efficiency.
- Performance awareness.
- Không chỉ có basic checks.

Với project này, bạn cần chứng minh:

- Không lộ transcript/PII on-chain.
- Access control đúng.
- Revocation đúng.
- Issuer authorization đúng.
- Có test các đường lỗi.
- Có gas snapshot.
- Có threat model.

## Evidence In This Project

| Security/Performance Topic | Evidence |
|---|---|
| Owner-controlled issuer registry | `IssuerRegistry.sol` uses `Ownable2Step` |
| Authorized issuers only | `CredentialRegistry.anchorCredential` checks `issuerRegistry.isAuthorized` |
| Original issuer revocation only | `CredentialRegistry.revokeCredential` checks `anchor.issuer == msg.sender` |
| PII minimization | stores `holderHash`, not plaintext holder identifier |
| Zero-value validation | rejects zero credential ID, holder hash, Merkle root |
| Expiry logic | `statusOf` and `isCurrentlyValid` |
| Issuer deauthorization | `isCurrentlyValid` cross-checks issuer registry |
| Gas baseline | `contracts/.gas-snapshot` |
| Threat model | `docs/SECURITY.md` |
| Automated tests | `contracts/test/`, `app/tests/` |

## Security Architecture

### 1. Access control

`IssuerRegistry` is controlled by an admin:

```text
Admin -> register/revoke/reinstate universities
Issuer -> anchor/revoke credentials it issued
Verifier -> read status only
```

Use this phrase:

```text
The admin is the trust root, but the verifier does not need to call the university directly. Anyone can read the registry and independently check whether the issuer is authorized.
```

### 2. Privacy

The chain stores:

- credential ID
- issuer address
- Merkle root
- holder hash
- timestamps
- revocation status

The chain does not store:

- full transcript
- grades
- course list
- student name/email

Use this phrase:

```text
The blockchain is used as a public integrity and revocation layer, not as a database for private student records.
```

### 3. Revocation

Two revocation levels:

| Revocation Type | Effect |
|---|---|
| Credential revocation | One credential becomes invalid |
| Issuer revocation | All credentials from that issuer fail current authorization |

Show this in `make demo` steps 8 and 9.

### 4. Holder replay protection

The holder signs:

```text
keccak256(credentialId || verifierNonce)
```

This prevents a verifier from reusing a presentation for another verifier's challenge.

## Gas/Performance Evidence

Run:

```bash
cd contracts
forge snapshot
```

Example gas numbers from `contracts/.gas-snapshot`:

| Operation Test | Gas |
|---|---:|
| Authorized credential anchor | 114,476 |
| Credential revocation | 143,020 |
| Unknown credential status read | 7,909 |
| Solidity Merkle proof verification | 13,926 |

How to explain:

```text
The expensive transcript data is never stored on-chain. We store only fixed-size hashes and timestamps for the core anchor. Strings are used only for human-readable issuer metadata and revocation reasons, which are audit fields rather than high-frequency transcript storage.
```

## Tests To Mention

Smart contract tests:

- Unauthorized issuer cannot anchor.
- Non-issuer cannot revoke.
- Duplicate anchor rejected.
- Zero Merkle root rejected.
- Zero credential ID rejected.
- Zero holder hash rejected.
- Expired credentials fail.
- Issuer authority loss reflected.
- Fuzz anchor/revoke roundtrip.

App tests:

- Tampered claims rejected.
- Forged signatures rejected.
- Revoked credentials rejected.
- Unauthorized issuers rejected.
- Holder nonce mismatch rejected.
- Fake Merkle proof rejected.

## Teacher Questions And Answers

**Q: Is there a reentrancy risk?**  
A: These contracts do not transfer ETH/tokens and do not call untrusted external contracts except a trusted issuer registry view call. The main risks are access control and data integrity, which are tested directly.

**Q: Why store revocation reason as string if gas matters?**  
A: It is an auditability tradeoff. The critical state is fixed-size, but the reason helps real-world verifiers understand why a credential was revoked. In production this could be replaced by an IPFS hash or reason code.

**Q: Can someone learn a student's grades from the chain?**  
A: No grades are on-chain. The public Merkle root alone is not enough to recover hidden salted leaves. Holder identifiers are also hashed.

**Q: What if the issuer key is compromised?**  
A: The admin revokes the issuer address. Existing credentials from that key then fail current authorization. A production system would add key rotation/HSM/multisig.

**Q: Why not verify all Merkle proofs on-chain?**  
A: Verifiers can do it off-chain for free and with better privacy. Solidity proof verification is included as a compatibility baseline for future on-chain services.

## Full-Point Checklist

- [ ] Show `docs/SECURITY.md`.
- [ ] Mention `Ownable2Step`.
- [ ] Mention no transcript data on-chain.
- [ ] Mention `holderHash`.
- [ ] Show revocation failure in demo.
- [ ] Mention `contracts/.gas-snapshot`.
- [ ] Explain why off-chain verification saves gas.
- [ ] Mention audit limitations honestly.

## Common Mistakes That Lose Points

- Saying "secure because blockchain" without naming actual controls.
- Ignoring privacy leakage.
- Not mentioning gas/storage tradeoffs.
- Forgetting issuer revocation vs credential revocation.
- Overclaiming production readiness without acknowledging audits/key management.
