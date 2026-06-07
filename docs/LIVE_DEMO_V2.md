# CredentialTrust V2 Live Demo

This repository now includes a one-command local product mode backed by real deployed V2
contracts.

## Recommended flow

```bash
make setup
make demo-v2
```

`make demo-v2` will:

1. build the V2 contract artifacts if they are missing,
2. start or reuse a local Anvil RPC at `http://127.0.0.1:8545`,
3. deploy `IssuerRegistryV2` and `CredentialRegistryV2`,
4. register the demo university organization, and
5. start the browser app with the Blockchain Registry portal prefilled.

The command prints a product URL that includes query parameters for the live registry
addresses, so opening that link lands directly in live local mode.

## Manual fallback

If you prefer to run the pieces yourself:

```bash
# terminal 1
anvil --host 0.0.0.0 --port 8545

# terminal 2
cd app
npm run deploy:v2-local
npm run web
```

## Generated config

The deployment step writes `app/data/chain-v2.json` with:

- `rpcUrl`
- `chainId`
- `issuerRegistryV2`
- `credentialRegistryV2`
- `deployedAt`

The file is generated locally, served by Vite from the `/chain-v2.json` path, and excluded
from the submission archive.
