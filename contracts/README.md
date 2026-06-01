# Smart Contracts

Foundry project for the academic credential registries.

## Contracts

| Contract | Purpose |
|---|---|
| `IssuerRegistry.sol` | Owner-controlled registry of authorized universities. |
| `CredentialRegistry.sol` | Credential anchors, revocation list, status checks, and pure Merkle proof helpers. |
| `IIssuerRegistry.sol` | Interface used by `CredentialRegistry`. |

## Commands

```bash
forge build
forge test
forge snapshot
```

Current test suite: 23 passing tests, including access-control checks, revocation flows, expiry, fuzzed anchor/revoke round trips, zero-value validation, and Solidity-side Merkle proof verification.

`contracts/.gas-snapshot` is committed as a lightweight gas/performance baseline.

## Local Deployment

```bash
anvil
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --private-key <deployer-key> \
  --broadcast
```

The TypeScript app also provides `npm run deploy:local`, which deploys both registries and writes `app/data/chain.json` for the CLI tools.
