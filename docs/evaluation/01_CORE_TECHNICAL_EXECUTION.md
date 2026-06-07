# Core Technical Execution - 3.0 pts

## What Full Score Means

Theo rubric, mức 9-10 cần:

- Smart contract logic gần như không lỗi.
- Dùng Foundry/Hardhat thành thạo.
- Có frontend integration mượt, không chỉ code backend rời rạc.
- Demo chạy end-to-end thật: deploy, register issuer, issue credential, selective disclosure, verify, revoke.

Mục tiêu của bạn là chứng minh đây là một hệ thống hoàn chỉnh, không phải vài đoạn code riêng lẻ.

## Evidence In This Project

| Requirement | Evidence |
|---|---|
| Smart contracts | `contracts/src/IssuerRegistry.sol`, `contracts/src/CredentialRegistry.sol` |
| Contract tests | `contracts/test/IssuerRegistry.t.sol`, `contracts/test/CredentialRegistry.t.sol` |
| Foundry workflow | `contracts/foundry.toml`, `contracts/script/Deploy.s.sol`, `make check` |
| Off-chain app | `app/src/core/`, `app/src/issuer/`, `app/src/holder/`, `app/src/verifier/` |
| Frontend integration | `app/src/web/main.ts`, `app/src/web/styles.css` |
| End-to-end demo | `app/src/demo/end-to-end.ts`, `app/src/demo/with-anvil.ts` |

## Commands To Show

Run these during preparation:

```bash
make check
make demo
make web
```

Expected talking point:

```text
make check runs Foundry formatting/tests, TypeScript unit tests, CLI build, and browser build.
make audit runs npm audit separately.
make demo starts Anvil automatically and runs the full credential lifecycle.
make web opens a browser dashboard using the same cryptographic core as the CLI.
```

## Live Demo Script

### 1. Start with contract tests

```bash
make check
```

Say:

```text
The contract suite has 70 tests covering issuer registration, revocation, credential anchoring, expiry, zero-value rejection, unauthorized callers, and Solidity-side Merkle proof verification. The app has 135 TypeScript tests for ECC, Merkle proofs, credential issuance, holder nonce binding, and tamper detection.
```

### 2. Run end-to-end flow

```bash
make demo
```

Point out these 9 phases:

1. Deploy `IssuerRegistry` and `CredentialRegistry`.
2. Admin registers HUST.
3. HUST issues Alice's credential.
4. HUST anchors the credential on-chain.
5. Alice creates a redacted presentation.
6. Verifier validates signature, Merkle proofs, holder proof, anchor, and issuer authorization.
7. Tampered GPA is rejected.
8. Revoked credential is rejected.
9. Revoked issuer authority invalidates credentials.

### 3. Show browser DApp

```bash
make web
```

Open the printed local URL.

Show:

- Issuer address, holder address, credential hash.
- Select only some claims.
- Hidden claim count changes.
- Merkle proof path appears.
- Local cryptographic checks succeed in-browser.
- If Anvil is running and addresses are configured, chain verification succeeds.

## What To Say To Impress

Use this phrasing:

```text
I separated the system into three layers: Solidity registries, a reusable TypeScript cryptographic core, and user interfaces through both CLI and browser. The browser and CLI do not reimplement the protocol separately; they share the same issuance, presentation, and verification pipeline, which reduces divergence between demo and tested code.
```

## Teacher Questions And Answers

**Q: Is this really decentralized if credentials are off-chain?**  
A: Yes. The private transcript stays off-chain for privacy, while the chain stores public verification state: authorized issuers, credential anchors, and revocations. This is closer to real verifiable credential systems than storing PII on-chain.

**Q: Why both CLI and web UI?**  
A: CLI gives deterministic reproducible testing and automation. Web UI demonstrates user-facing DApp integration for issuer, holder, and verifier workflows.

**Q: What happens if the verifier is offline?**  
A: Offline mode can still verify issuer signature and Merkle proofs, but cannot check live revocation or issuer status. For high assurance, on-chain checks should be required.

## Full-Point Checklist

- [ ] Run `make check` before class.
- [ ] Run `make demo` at least once before presenting.
- [ ] Open `make web` and know where the claim picker and verification panel are.
- [ ] Be able to name all three actors: issuer, holder, verifier.
- [ ] Be able to explain why the chain stores roots/status, not full transcripts.
- [ ] Show a failure case, not only a happy path.

## Common Mistakes That Lose Points

- Only showing tests, not an end-to-end workflow.
- Forgetting to mention the frontend.
- Saying "blockchain stores diplomas" instead of "blockchain stores anchors and revocation state".
- Not showing tamper/revocation failure.
- Not explaining how the CLI, web UI, and contracts connect.
