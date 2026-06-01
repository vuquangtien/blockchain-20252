# Usage Guide

A step-by-step walkthrough of all four roles: deploying, issuing, presenting, and verifying. Every command in this guide actually runs against the local devnet started by `anvil`.

## Prerequisites

```bash
# Foundry (forge, anvil)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Node.js v20+
node --version   # should print v20.x or higher
```

## One-time setup

```bash
# from the project root
cd contracts && forge install                  # pulls forge-std + OpenZeppelin
cd ../app && npm install                       # installs ethers, noble, etc.
cd .. && mkdir -p app/data app/keys
```

## Step 1 — Run unit tests

This is the fastest sanity check that everything is wired up correctly.

From the project root:

```bash
make check
```

Or run each layer manually:

```bash
# Smart contracts (Foundry)
cd contracts
forge test
# Expected: 23 tests passed.

# Off-chain library (vitest)
cd ../app
npm test
# Expected: 26 tests passed across 3 files.

# Browser DApp bundle
npm run web:build
# Expected: Vite production build succeeds.
```

## Step 2 — Start a local Ethereum node

In a dedicated terminal:

```bash
anvil
# Anvil prints 10 funded accounts. Account #0 is the deployer; account #1 is HUST.
```

## Step 3 — Run the end-to-end demo

This is the recommended way to see everything in action.

```bash
cd app
npm run demo
```

The demo runs 9 phases. Sample output:

```
━━━━━━ 1) Deploy contracts ━━━━━━
  IssuerRegistry      : 0x5FbDB2315678afecb367f032d93F642f64180aa3
  CredentialRegistry  : 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512

━━━━━━ 2) Admin registers HUST ━━━━━━
  registered HUST @ 0x70997970c51812dc3a010c7d01b50e0d17dc79c8

━━━━━━ 3) HUST issues Alice's degree credential ━━━━━━
  credential.id        : urn:cred:9cf1a8eb...
  merkle root          : 0x00a5f666...
  credentialId (hash)  : 0x4da74344...

━━━━━━ 4) HUST anchors credential on-chain ━━━━━━
  anchor tx: 0xa924d2ea...

━━━━━━ 5) Alice produces a redacted presentation (only thesis + gpa) ━━━━━━
  verifier challenge nonce: 0x40674cc8...
  disclosed claims: thesis, gpa

━━━━━━ 6) Verifier runs the verification pipeline ━━━━━━
  valid=true
    ✓ issuer_signature — recovered 0x70997970...
    ✓ not_expired
    ✓ merkle_proof:thesis
    ✓ merkle_proof:gpa
    ✓ holder_proof — recovered 0x2fea2519...
    ✓ anchor_present — anchored and live
    ✓ issuer_authorized — issuer is registered and active

━━━━━━ 7) Tamper test — verifier should reject a modified grade ━━━━━━
  → tampered presentation valid=false (expected false)

━━━━━━ 8) HUST revokes the credential — verifier rejects ━━━━━━
  valid=false
    ✗ anchor_present — revoked: academic dishonesty

━━━━━━ 9) Issuer authority revoked — even valid credentials fail verification ━━━━━━
  before authority revoke: valid=true
  after  authority revoke: valid=false

✅ Demo completed successfully.
```

## Step 4 — Use the CLIs by hand

### 4a. Deploy contracts to your local Anvil

```bash
cd app
npm run deploy:local
# Writes data/chain.json with the deployed addresses.
```

### 4b. Generate keypairs

```bash
# Admin (registry owner)
mkdir -p keys
node -e "
  const {generateKeyPair} = require('./src/core/ecc.ts');  // (or via tsx)
" 2>/dev/null || npm run issuer -- keygen --out keys/admin.json

# Issuer (HUST)
npm run issuer -- keygen --out keys/hust.json
# → prints "address: 0xABC..."  (remember this)

# Holder (Alice)
npm run holder -- keygen --out keys/alice.json
```

> **Note:** for a *real* deployment, the admin key should be the deployer of the registry. For local play, edit `data/chain.json` after deploy or use Anvil's account 0's private key (printed when anvil starts).

### 4c. Admin registers HUST as an authorized issuer

```bash
# Use Anvil account 0 as admin (default deployer):
echo '{"privateKey":"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"}' > keys/admin.json

# Get the HUST address from keys/hust.json (the "address" field).
HUST_ADDR=$(node -p "require('./keys/hust.json').address")

npm run issuer -- register \
  --admin-key keys/admin.json \
  --address $HUST_ADDR \
  --name "Hanoi University of Science and Technology" \
  --metadata "ipfs://QmXyZ..."
```

### 4d. HUST issues a credential to Alice

Create a transcript JSON:

```bash
cat > data/alice-transcript.json <<'EOF'
{
  "holder": "did:vn:alice-2025",
  "credentialType": "Bachelor of Engineering — Computer Science",
  "schemaURI": "https://hust.edu.vn/schemas/cred/transcript-v1.json",
  "expiresAt": 0,
  "claims": [
    {"key": "course:CS101",  "value": {"name": "Intro to CS",        "credits": 3, "grade": "A"}},
    {"key": "course:MATH201","value": {"name": "Calculus II",        "credits": 4, "grade": "B+"}},
    {"key": "course:PH150",  "value": {"name": "Physics I",          "credits": 3, "grade": "A-"}},
    {"key": "course:EN101",  "value": {"name": "Academic English",   "credits": 2, "grade": "B"}},
    {"key": "gpa",           "value": {"value": 3.65, "scale": 4.0}},
    {"key": "thesis",        "value": {"title": "ZK Proofs", "grade": "A"}}
  ]
}
EOF

npm run issuer -- issue \
  --key keys/hust.json \
  --transcript data/alice-transcript.json \
  --out data/alice.cred.json
```

Output:
```
✓ credential issued: urn:cred:....
  merkle root:  0x00a5f6...
  credentialId: 0x4da743...
  saved to:     data/alice.cred.json
```

### 4e. HUST anchors the credential on-chain

```bash
npm run issuer -- anchor \
  --key keys/hust.json \
  --cred data/alice.cred.json
# ✓ anchored credentialId=0x...
#   tx: 0x...
```

### 4f. Alice creates a selective-disclosure presentation

```bash
# Verifier first generates a nonce challenge:
NONCE=$(npm run --silent verifier challenge)
echo $NONCE

# Alice discloses ONLY two claims (thesis + gpa) and binds the presentation to NONCE:
npm run holder -- present \
  --cred data/alice.cred.json \
  --disclose thesis,gpa \
  --holder-key keys/alice.json \
  --nonce $NONCE \
  --out data/alice.pres.json
```

The presentation file contains the credential metadata (issuer, holder, merkleRoot, signature), the two disclosed claims with their Merkle proofs, and a holder signature over `keccak256(credentialId ‖ NONCE)`.

It does **not** contain the other 4 claims. They are cryptographically hidden.

### 4g. Verifier checks the presentation

```bash
npm run verifier -- verify \
  --presentation data/alice.pres.json \
  --expected-nonce $NONCE \
  --require-holder-proof
```

Output:
```
Verification: ✅ VALID
  ✓ issuer_signature — recovered 0x70997970...
  ✓ not_expired
  ✓ merkle_proof:thesis
  ✓ merkle_proof:gpa
  ✓ holder_proof — recovered 0x...
  ✓ anchor_present — anchored and live
  ✓ issuer_authorized — issuer is registered and active

Disclosed claims:
  - thesis: {"title":"ZK Proofs","grade":"A"}
  - gpa: {"value":3.65,"scale":4.0}
```

### 4h. Revocation flow

```bash
# HUST decides to revoke the credential:
npm run issuer -- revoke \
  --key keys/hust.json \
  --cred data/alice.cred.json \
  --reason "academic dishonesty"

# Re-running the verification now fails:
npm run verifier -- verify --presentation data/alice.pres.json
# Verification: ❌ INVALID
#   ...
#   ✗ anchor_present — revoked: academic dishonesty
```

### 4i. Admin removes a misbehaving issuer

```bash
HUST_ADDR=$(node -p "require('./keys/hust.json').address")
npm run issuer -- revoke-issuer \
  --admin-key keys/admin.json \
  --address $HUST_ADDR \
  --reason "lost accreditation"

# All credentials previously issued by HUST now fail verification with
# "issuer_authorized: false" — even ones that haven't been individually revoked.
```

## Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| `Chain config not found` | You haven't run `npm run deploy:local` | Start Anvil and run the deploy script. |
| `nonce too low` errors | Anvil restarted but ethers cached the nonce | Restart your CLI session. |
| `not authorized issuer` | You forgot to `register` the issuer | `npm run issuer -- register --address <0x...>` |
| `Presentation valid=false, anchor_present unknown` | You forgot to `anchor` the credential | `npm run issuer -- anchor --cred ...` |
| `Holder proof: nonce mismatch` | Verifier challenge doesn't match the one used at presentation time | Re-issue presentation with the correct nonce. |

## Offline verification

The verifier can skip on-chain checks for air-gapped or fast-path scenarios:

```bash
npm run verifier -- verify \
  --presentation data/alice.pres.json \
  --offline
# Only signature + Merkle proofs are checked.
# This proves "this credential was issued by someone with this address",
# but does NOT prove the issuer is still authorized or not revoked.
```

This mode is useful inside enterprise networks where the chain is unreachable but a snapshot of the registries was distributed earlier.

## Step 5 — Browser DApp dashboard

The browser UI uses the same TypeScript core as the CLI: credential issuance, salts, Merkle proofs, ECDSA recovery, holder nonce binding, and optional on-chain checks are all real.

```bash
cd app
npm run web
# open http://localhost:5173
```

The Vite config uses polling-based file watching so the dev server is less likely to hit Linux `ENOSPC` watcher limits on machines with many IDE extensions. If it still happens, use the production preview fallback:

```bash
npm run web:build
npm run web:preview -- --port 4173
# open http://localhost:4173
```

For offline proof verification, the dashboard works immediately in the browser. For local-chain actions:

```bash
# Terminal 1
anvil

# Terminal 2
cd app
npm run deploy:local
cat data/chain.json
```

Paste the `issuerRegistry` and `credentialRegistry` addresses into the dashboard. The demo dashboard uses Anvil account #0 as the admin and account #1 as the HUST issuer, matching the CLI demo keys. You can then register HUST, anchor the currently displayed credential, verify it against the chain, and revoke it.

The dashboard is intentionally compact for a grading/demo room:

| Panel | What it proves |
|---|---|
| Holder disclosure | Only selected claims are included in the presentation. |
| Merkle proof | Shows the sibling hashes and left/right direction bits for a disclosed claim. |
| Verification | Displays each check independently: signature, expiry, Merkle proof, holder proof, anchor, and issuer authorization. |
