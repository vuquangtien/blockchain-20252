# Student Live Demo Guide

Use this as the live presentation script. Keep it short, direct, and tied to the actual UI.

## Pre-Demo Checklist

```bash
make setup
make check
make demo-v2
```

Open the printed Product URL from `make demo-v2`.

## 30-Second Opening

Say:

> "CredentialTrust is a role-based credential ecosystem. The university issues a credential, the student reveals only selected facts, the verifier checks the proof, and the blockchain registry confirms issuer authority and revocation status. The private transcript stays with the student."

## Happy Path Walkthrough

### 1. Dashboard

- What to click: nothing yet, just start here.
- What to point at: the five equal portal cards and the privacy card.
- What to say: "Each actor has a separate portal. I choose a role first, then perform only that role's action."
- What should appear: the portal navigation and the role cards for University, Student, Verifier, Registry/Admin, and Technical Reviewer.

### 2. University Portal

- What to click: `Open University Portal`, then `Sign credential`.
- What to point at: the signed state, `8 facts`, `5 hidden`, and the issuer profile card.
- What to say: "The university signs the record once. This action stays in the University Portal. I switch roles only with the secondary handoff."
- What should appear: a signed credential-ready state with the result cards updated and a `Send to Student Wallet` handoff button.

### 3. Student Wallet

- What to click: `Send to Student Wallet`, then `Create proof`.
- What to point at: the revealed-facts count, hidden-facts count, selected claims, and the wallet privacy note.
- What to say: "The student chooses what to reveal. Only the requested facts are shared, and the full transcript stays with the student."
- What should appear: a proof-ready state with the revealed versus hidden counts visible and a `Send to Verifier Portal` handoff button.

### 4. Verifier Portal

- What to click: `Send to Verifier Portal`, then `Verify proof`.
- What to point at: the verification request, the result card, and the grouped checks.
- What to say: "The verifier checks the proof against the request without seeing the full transcript. The registry is a separate portal."
- What should appear: an accepted or rejected verdict with the grouped checks underneath and a `Check Blockchain Registry` handoff button.

### 5. Blockchain Registry

- What to click: `Check Blockchain Registry`, then `Check registry now` or `Connect local registry`.
- What to point at: the connected or sample-mode status and the issuer/anchor/revocation cards.
- What to say: "The registry is the independent trust source. It shows issuer status and revocation status, but it does not expose the full transcript."
- What should appear: live chain status cards that change only after the registry read runs.

### 6. Technical Evidence

- What to click: `Open Technical Evidence`, then `Show advanced evidence`.
- What to point at: the revealed facts, hidden facts, on-chain commitments, Merkle proofs, signatures, and any collapsed proof details.
- What to say: "This is where the technical proof material lives. The normal product view stays simple, while the advanced view holds the hashes, proofs, and other grading evidence."
- What should appear: the advanced evidence panels and toggles.

## One Clean Happy Path

1. Start on the Dashboard.
2. Open University Portal and sign the credential.
3. Send to Student Wallet and create the proof.
4. Open Verifier Portal and verify the proof.
5. Check Blockchain Registry.
6. Open Technical Evidence.

## Optional Failure Path

If your build shows a visible `Revoke Credential` or `Suspend Issuer` control in the Blockchain Registry portal:

1. Use that control once.
2. Refresh or check the registry again.
3. Point out the changed issuer or revocation status.

If the control is not visible, skip this path and describe the status cards instead.

## Fallback Plan

- If the demo gets stuck, press `Ctrl-C` and rerun `make demo-v2`.
- Use the printed Product URL rather than guessing a port.
- If the live chain fails, show `make check` output and the Technical Evidence portal.
- Avoid broad destructive commands as first-line recovery steps.
