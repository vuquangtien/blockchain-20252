# Setup

This guide helps the user set up the repository, verify the implementation, and understand where the main pieces live.

CredentialTrust is a decentralized academic credential system. The private transcript stays off-chain for privacy. The chain stores issuer authorization, credential anchors, and revocation state. The browser app and the TypeScript core let the student reveal only selected facts while the verifier checks the proof and the live registry status.

## Prerequisites

- Node.js 20+
- npm
- Foundry / `forge`
- git
- zip/unzip

## Setup From The Repository

```bash
make setup
make check
make audit
make smoke-check
```

What each command proves:

- `make setup` installs dependencies and prepares the repo for local work.
- `make check` verifies formatting, runs the Foundry test suite, runs the Vitest suite, and builds the app.
- `make audit` runs `npm audit` separately.
- `make smoke-check` packages the submission, unpacks it, and reruns setup and check in a clean temp directory.

Expected validation results:

- 70 Foundry tests pass
- 137 Vitest tests pass
- browser production build passes
- `npm audit` reports 0 vulnerabilities

## Where The Core Code Lives

- `app/src/core/v2`
- `app/src/chain/v2`
- `contracts/src/*V2.sol`
- `contracts/test/*V2.t.sol`
- `app/src/web`

What these cover:

- `app/src/core/v2` contains the TypeScript Protocol V2 hashing, Merkle, and validation logic.
- `app/src/chain/v2` contains the V2 chain client and ABI bindings.
- `contracts/src/*V2.sol` contains the issuer and credential registry contracts.
- `contracts/test/*V2.t.sol` contains the V2 Foundry coverage.
- `app/src/web` contains the browser product UI.

## Live Demo Command

```bash
make demo-v2
```

This command starts or reuses local Anvil, deploys the V2 contracts, writes `app/data/chain-v2.json`, and starts the browser app. Open the printed Product URL from the terminal.

The browser app is organized as separate role-based portals:

- `Dashboard`
- `University Portal`
- `Student Wallet`
- `Verifier Portal`
- `Blockchain Registry`
- `Technical Evidence`

The main grading flow in the browser is role-based:

- Open `University Portal` and click `Sign credential`.
- Use `Send to Student Wallet` only when you want to switch roles.
- In `Student Wallet`, click `Create proof`.
- Use `Send to Verifier Portal` only when you want to switch roles.
- In `Verifier Portal`, click `Verify proof`.
- Use `Check Blockchain Registry` to inspect issuer, anchor, and revocation state.
- Open `Technical Evidence` only for hashes, signatures, Merkle paths, and registry bindings.

## On-Chain Versus Off-Chain

- Off-chain: transcript data, salts, Merkle proofs, signatures, and the selective-disclosure presentation are handled in the app and core libraries.
- On-chain: `IssuerRegistryV2` and `CredentialRegistryV2` store issuer authorization, credential anchors, holder commitments, revocation state, and registry status.
- Verification is split across both layers: the cryptographic proof checks can run locally, while live issuer and revocation status come from the chain.

## Troubleshooting

- Foundry missing:
  - Install Foundry, then rerun `make setup` and `make check`.
- npm install or network issue:
  - Retry `make setup` or run `npm ci` in the `app` directory if the package lock is available and the network is working.
- Port already in use:
  - Stop the current `make demo-v2` run with `Ctrl-C`, then rerun `make demo-v2`.
  - Open the printed Product URL rather than assuming a fixed port.
- Anvil or RPC issue:
  - Check whether `http://127.0.0.1:8545` responds.
  - Rerun `make demo-v2` if the local node failed to start cleanly.
  - If needed, start Anvil manually with the already installed command and rerun the deploy/web steps.
