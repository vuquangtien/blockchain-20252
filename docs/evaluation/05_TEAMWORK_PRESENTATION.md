# Teamwork & Presentation - 1.0 pt

## What Full Score Means

Rubric yêu cầu:

- Polished live demo.
- Professional defense of technical choices.
- Good coordination/teamwork.
- Answer Q&A confidently.

Nếu bạn làm một mình, hãy trình bày theo hướng "engineering workflow": issue breakdown, reproducible commands, tests, documentation, and demo reliability.

## Presentation Goal

Trong 5-7 phút, thầy phải thấy:

1. Bài toán thật.
2. Demo chạy thật.
3. Có selective disclosure thật.
4. Có smart contract thật.
5. Có security thinking.
6. Có testing/documentation nghiêm túc.

## 5-Minute Script

### Minute 0: Opening

Say:

```text
My project is a decentralized academic credential system. A university issues an ECC-signed credential, the transcript is committed into a salted Merkle tree, and the student can disclose only selected claims. The blockchain stores authorized issuers and revocation status, not the full private transcript.
```

### Minute 1: Architecture

Open `README.md`.

Show:

- Issuer.
- Holder.
- Verifier.
- IssuerRegistry.
- CredentialRegistry.

Say:

```text
The system has three actors and two registries. The issuer signs and anchors credentials, the holder creates redacted presentations, and the verifier checks signature, Merkle proofs, holder nonce, and on-chain status.
```

### Minute 2: Tests

Run:

```bash
make check
```

Say:

```text
This command checks both layers: Solidity formatting and tests, TypeScript unit tests, CLI build, browser build, and dependency audit.
```

### Minute 3: End-to-End Demo

Run:

```bash
make demo
```

Point out:

- Credential is valid before tampering.
- Tampered presentation fails.
- Revoked credential fails.
- Revoked issuer fails.

### Minute 4: Browser DApp

Run:

```bash
make web
```

Show:

- Select only 2-3 claims.
- Hidden claim count.
- Merkle proof path.
- Verification checks.

Say:

```text
The UI uses the same TypeScript core as the CLI. It is not a mock; it calls the same issue, present, and verify functions.
```

### Minute 5: Security and Tradeoffs

Open `docs/SECURITY.md` or `docs/GRADING.md`.

Say:

```text
The design avoids storing transcripts on-chain, salts each claim to prevent grade brute forcing, uses holder nonce signatures to reduce replay, and uses revocation registries for live verification. The known limitations are issuer key compromise, production wallet UX, and stronger ZK predicate privacy.
```

## If You Have A Team

Divide roles like this:

| Person | Responsibility |
|---|---|
| Presenter 1 | Problem statement and architecture |
| Presenter 2 | Cryptography and selective disclosure |
| Presenter 3 | Smart contracts, tests, security |
| Presenter 4 | Live demo and Q&A |

If presenting alone, say:

```text
I structured the work as separate modules: contracts, cryptographic core, CLI, web UI, tests, and documentation, so each part can be evaluated independently.
```

## Q&A Cheat Sheet

**Q: What is the strongest part of your project?**  
A: The selective disclosure pipeline: issuer-signed metadata commits to a salted Merkle root, and the holder reveals only selected leaves with proofs. This is implemented, tested, and shown in both CLI and browser.

**Q: What is the most important security decision?**  
A: Not storing transcript data on-chain. The blockchain only stores commitments and revocation state.

**Q: What would you improve with more time?**  
A: Add production wallet integration, issuer key rotation, and optional ZK proofs for predicates like GPA above a threshold.

**Q: Why should this score high on anti-clone?**  
A: The project implements a custom Merkle tree with canonical encoding, salts, domain separation, direction-bit proofs, and a Solidity mirror. It is not a default library demo.

**Q: What happens if the demo fails?**  
A: The project has fallback evidence: `make check`, `npm run web:build`, screenshots can be taken from the browser dashboard, and `docs/USAGE.md` gives manual CLI steps.

## Demo Backup Plan

If `make web` fails:

```bash
cd app
npm run web:build
npm run web:preview -- --port 4173
```

If Anvil auto-start fails:

```bash
anvil
cd app
npm run demo
```

If live commands take too long:

Show:

- `README.md` test output section.
- `contracts/.gas-snapshot`.
- `docs/REPORT.md` testing section.
- Browser dashboard with offline verification.

## Full-Point Checklist

- [ ] Rehearse once with timer.
- [ ] Run `make check` before class.
- [ ] Keep terminal at project root.
- [ ] Keep README open.
- [ ] Keep browser dashboard ready.
- [ ] Know the 9 demo phases.
- [ ] Prepare answers for salt, Merkle root, revocation, holder nonce.
- [ ] Do not overclaim production readiness.

## Common Mistakes That Lose Points

- Spending too long installing dependencies during presentation.
- Only talking about blockchain and ignoring privacy.
- Not showing a failing/tamper case.
- Reading code line-by-line instead of explaining system behavior.
- Being unable to explain why Merkle selective disclosure is useful.
