# Presentation Runbook

This guide is for a short live defense of CredentialTrust V2. It matches the current browser UI and the one-command live local product mode.

## Team Roles

| Role | Focus |
|---|---|
| Member 1 | Problem, architecture, and why selective disclosure matters |
| Member 2 | Cryptography and proof construction |
| Member 3 | Issuer/registry logic and security |
| Member 4 | Live demo operator and UI walkthrough |

## Prep

Run these from the project root:

```bash
make setup
make check
make demo-v2
```

`make check` is the static validation step. `make demo-v2` is the live product mode. Use the printed Product URL from the terminal when the browser does not open automatically.

## 7 to 10 Minute Script

### 1. Open with the Dashboard

Show the **Dashboard** workspace first.

Say:

> "CredentialTrust is a credential operations console. The dashboard shows who we are, what action we take next, what changed after that action, and why blockchain is part of the trust model."

Point out:

* Live local mode badge when V2 chain config is loaded.
* The current role card.
* The primary action card.
* The result card.
* The six workspaces:
  * Dashboard
  * University Issuer
  * Student Wallet
  * Verifier Portal
  * Blockchain Registry
  * Evidence / Advanced

### 2. Issue a credential

Click **University Issuer** and then **Issue credential**.

Say:

> "The university signs the record once. The default view stays compact: signed state, V2 status, total facts, and hidden facts are visible immediately. The detailed issuer evidence stays collapsed unless we open it."

Point out:

* Signed state
* `8 facts`
* `5 hidden`
* The issuer profile card
* The advanced issuer details toggle

### 3. Reveal only what is needed

Click **Student Wallet** and then **Share proof**.

Say:

> "The student chooses what to reveal. The wallet shows the selected facts and keeps the rest hidden by default."

Point out:

* The revealed facts count
* The hidden facts count
* The selected claims
* The wallet privacy summary
* The raw wallet data toggle for graders

### 4. Verify the proof

Click **Verifier Portal** and then **Verify proof**.

Say:

> "The verifier checks the proof against the request. The cryptographic checks are local and the live registry status comes from the chain. Accepted or rejected is visible immediately, along with grouped checks."

Point out:

* The verification request card
* The result chip
* The grouped check panels
* The evidence details toggle

### 5. Check the registry

Click **Blockchain Registry** and then **Check registry**.

Say:

> "The registry is the independent trust source. It confirms issuer authority and revocation state, but it does not store the full transcript."

Point out:

* `Connected to local chain` before refresh
* `Not checked yet` until the live read runs
* The four status cards
* The **View evidence** button
* The fact that refresh is a real chain read, not a static sample

### 6. Show the technical evidence

Click **Evidence / Advanced** and then **Show advanced evidence**.

Say:

> "This is where the technical proof material lives. Hashes, Merkle paths, raw values, and other advanced details are available for grading, but they stay collapsed in the normal product view."

Point out:

* Revealed facts
* Hidden facts
* What went on-chain
* Raw transcript data remains private by default
* The dashboard return button

## Fallback Plan

If the live demo stalls:

1. Press `Ctrl-C` on the current `make demo-v2` run.
2. Run `make demo-v2` again.
3. Open the printed Product URL from the terminal.
4. If the browser still does not cooperate, use the live screenshots, README, and the validation output from `make check`.
5. If you need a manual rebuild with already-installed tools, use:

```bash
cd app
npm run deploy:v2-local
npm run web
```

Keep the demo calm and short. If a step already proves the point, move on.
