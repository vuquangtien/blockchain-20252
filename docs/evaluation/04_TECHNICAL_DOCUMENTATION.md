# Technical Documentation - 1.5 pts

## What Full Score Means

Rubric yêu cầu:

- High-quality report.
- Clear architecture diagrams.
- Math/crypto explanation.
- Setup guide.
- Technical rigor, không chỉ mô tả chung chung.

Bạn cần làm thầy thấy rằng project này có thể được người khác clone, chạy, hiểu, đánh giá bảo mật và bảo vệ thiết kế.

## Documentation Files

| File | Purpose |
|---|---|
| `README.md` | Project overview, architecture, quick start, test summary |
| `docs/REPORT.md` | Capstone-style technical report |
| `docs/DESIGN.md` | Deep design rationale and tradeoffs |
| `docs/SECURITY.md` | Threat model and operational guidance |
| `docs/USAGE.md` | CLI and browser walkthrough |
| `docs/PRESENTATION.md` | Live demo script and defense Q&A |
| `docs/GRADING.md` | Rubric-to-evidence map |
| `docs/SUBMISSION_CHECKLIST.md` | Final submission checklist |
| `contracts/README.md` | Smart contract-specific instructions |

## How To Present Documentation

### 1. Start with README

Show:

- Requirement mapping table.
- Architecture diagram.
- Project layout.
- Quick start commands.
- Test coverage summary.

Say:

```text
The README is designed so a grader can immediately map the project requirements to the implementation files and reproduce the results.
```

### 2. Open REPORT

Show:

- Abstract.
- System architecture.
- Cryptographic design.
- On-chain design.
- Testing section.
- Gas table.
- Conclusion.

Say:

```text
The report is written as a capstone report, not just a README. It explains why the design choices were made, not only what files exist.
```

### 3. Open DESIGN

Show:

- Why secp256k1.
- Why custom Merkle tree.
- Why metadata-only signature.
- Why holder hash.
- Why no full ZK in this scope.

Say:

```text
The design document focuses on tradeoffs. For example, ZK proofs would give stronger predicate privacy, but Merkle selective disclosure satisfies the brief with a simpler and auditable implementation.
```

### 4. Open SECURITY

Show:

- In-scope threats.
- Out-of-scope threats.
- Tested attack scenarios.
- Operational guidance.

Say:

```text
The security document separates what the system prevents from what remains out of scope, such as compromised issuer keys or quantum-safe migration.
```

## Math/Crypto Sections To Emphasize

Use these formulas from the docs:

```text
leafHash = keccak256(0x00 || canonical_json({key, value, salt}))
nodeHash = keccak256(0x01 || left || right)
signature = ECDSA_secp256k1(EIP191(canonical_json(metadata)))
holderProof = ECDSA_secp256k1(keccak256(credentialId || nonce))
```

These are the parts that make the report look rigorous.

## Setup Guide Quality

A grader should be able to run:

```bash
npm install
make check
make demo
make web
```

If Foundry dependencies are missing:

```bash
make setup
```

## Teacher Questions And Answers

**Q: Where is the architecture diagram?**  
A: In `README.md`, under High-level architecture.

**Q: Where are the mathematical details?**  
A: In `docs/DESIGN.md` and `docs/REPORT.md`, especially the ECC and Merkle sections.

**Q: Where is the security analysis?**  
A: `docs/SECURITY.md` contains the threat model, out-of-scope risks, and tested attack scenarios.

**Q: How do I reproduce the demo?**  
A: `docs/USAGE.md` gives step-by-step CLI and browser instructions. `make demo` runs the full Anvil flow automatically.

## Full-Point Checklist

- [ ] README has requirement-to-file mapping.
- [ ] README has architecture diagram.
- [ ] REPORT reads like a formal capstone report.
- [ ] DESIGN explains tradeoffs, not only implementation.
- [ ] SECURITY has threat model and limitations.
- [ ] USAGE can reproduce CLI and browser flows.
- [ ] PRESENTATION has script and Q&A.
- [ ] GRADING maps rubric to evidence.
- [ ] SUBMISSION_CHECKLIST gives final commands.

## Common Mistakes That Lose Points

- Docs only say how to install, not why the design is secure.
- No diagrams.
- No threat model.
- No test evidence.
- No explanation of limitations.
- Report does not connect back to the assignment requirements.
