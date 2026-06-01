#!/usr/bin/env node
/**
 * Issuer CLI — for universities to manage signing keys, issue credentials, and
 * anchor / revoke them on-chain.
 *
 * Quick reference:
 *   issuer keygen --out keys/hust.json
 *   issuer issue --key keys/hust.json --transcript data/alice.json --out data/alice.cred.json
 *   issuer anchor --key keys/hust.json --cred data/alice.cred.json
 *   issuer revoke --key keys/hust.json --cred-id 0xabc... --reason "academic dishonesty"
 *   issuer register --admin-key keys/admin.json --address 0x... --name "HUST"
 */
import {Command} from "commander";
import {writeFileSync} from "node:fs";
import {
    credentialId,
    holderHash,
    issueCredential,
    generateKeyPair,
    keyPairFromPrivateKey,
} from "../core/index.js";
import type {Credential, Claim} from "../core/types.js";
import {ChainClient} from "../chain/client.js";
import {loadChainConfig} from "../util/config.js";
import {readJSON, writeJSON} from "../util/io.js";

const program = new Command();
program
    .name("issuer")
    .description("University-side CLI for issuing and managing academic credentials.")
    .version("0.1.0");

program
    .command("keygen")
    .description("Generate a new secp256k1 keypair and write it to disk.")
    .requiredOption("--out <path>", "where to save the keypair JSON")
    .action((opts: {out: string}) => {
        const kp = generateKeyPair();
        writeJSON(opts.out, kp);
        console.log(`✓ keypair written to ${opts.out}`);
        console.log(`  address: ${kp.address}`);
    });

program
    .command("issue")
    .description("Build, ECC-sign, and Merkle-commit a credential from a transcript JSON.")
    .requiredOption("--key <path>", "issuer keypair file")
    .requiredOption("--transcript <path>", "JSON file with {holder, credentialType, schemaURI?, expiresAt?, claims:[{key,value}]}")
    .requiredOption("--out <path>", "where to save the signed credential")
    .action((opts: {key: string; transcript: string; out: string}) => {
        const issuerKey = readJSON<{privateKey: `0x${string}`}>(opts.key);
        const kp = keyPairFromPrivateKey(issuerKey.privateKey);
        const transcript = readJSON<{
            holder: string;
            credentialType: string;
            schemaURI?: string;
            expiresAt?: number;
            claims: Array<Pick<Claim, "key" | "value">>;
        }>(opts.transcript);

        const credential = issueCredential({
            issuerKey: kp,
            holder: transcript.holder,
            credentialType: transcript.credentialType,
            schemaURI: transcript.schemaURI,
            expiresAt: transcript.expiresAt,
            claims: transcript.claims,
        });

        writeJSON(opts.out, credential);
        console.log(`✓ credential issued: ${credential.id}`);
        console.log(`  merkle root:  ${credential.merkleRoot}`);
        console.log(`  credentialId: ${credentialId(credential)}`);
        console.log(`  saved to:     ${opts.out}`);
    });

program
    .command("anchor")
    .description("Anchor a signed credential's Merkle root on-chain.")
    .requiredOption("--key <path>", "issuer keypair (also used as wallet)")
    .requiredOption("--cred <path>", "signed credential JSON to anchor")
    .action(async (opts: {key: string; cred: string}) => {
        const issuerKey = readJSON<{privateKey: `0x${string}`}>(opts.key);
        const cred = readJSON<Credential>(opts.cred);
        const cid = credentialId(cred);
        const client = ChainClient.withWallet(loadChainConfig(), issuerKey.privateKey);
        const txHash = await client.anchorCredential({
            credentialId: cid,
            holderHash: holderHash(cred.holder),
            merkleRoot: cred.merkleRoot,
            issuedAt: cred.issuedAt,
            expiresAt: cred.expiresAt,
        });
        console.log(`✓ anchored credentialId=${cid}`);
        console.log(`  tx: ${txHash}`);
    });

program
    .command("revoke")
    .description("Revoke a previously anchored credential.")
    .requiredOption("--key <path>", "issuer keypair")
    .option("--cred <path>", "signed credential JSON (used to derive credentialId)")
    .option("--cred-id <hex>", "credentialId hex if you don't have the credential file")
    .requiredOption("--reason <reason>", "human-readable reason, stored on-chain")
    .action(async (opts: {key: string; cred?: string; credId?: string; reason: string}) => {
        if (!opts.cred && !opts.credId) {
            console.error("provide --cred or --cred-id");
            process.exit(1);
        }
        const issuerKey = readJSON<{privateKey: `0x${string}`}>(opts.key);
        const cid = (opts.credId ?? credentialId(readJSON<Credential>(opts.cred!))) as `0x${string}`;
        const client = ChainClient.withWallet(loadChainConfig(), issuerKey.privateKey);
        const txHash = await client.revokeCredential(cid, opts.reason);
        console.log(`✓ revoked credentialId=${cid}`);
        console.log(`  tx: ${txHash}`);
    });

program
    .command("register")
    .description("[admin] Register an issuer in the on-chain IssuerRegistry.")
    .requiredOption("--admin-key <path>", "admin keypair (registry owner)")
    .requiredOption("--address <0x...>", "issuer address to register")
    .requiredOption("--name <name>", "human-readable issuer name")
    .option("--metadata <uri>", "optional metadata URI", "")
    .action(async (opts: {adminKey: string; address: `0x${string}`; name: string; metadata: string}) => {
        const adminKey = readJSON<{privateKey: `0x${string}`}>(opts.adminKey);
        const client = ChainClient.withWallet(loadChainConfig(), adminKey.privateKey);
        const txHash = await client.registerIssuer(opts.address, opts.name, opts.metadata);
        console.log(`✓ registered issuer ${opts.address} (${opts.name})`);
        console.log(`  tx: ${txHash}`);
    });

program
    .command("revoke-issuer")
    .description("[admin] Revoke an issuer in the IssuerRegistry.")
    .requiredOption("--admin-key <path>", "admin keypair")
    .requiredOption("--address <0x...>", "issuer to revoke")
    .requiredOption("--reason <reason>", "reason string")
    .action(async (opts: {adminKey: string; address: `0x${string}`; reason: string}) => {
        const adminKey = readJSON<{privateKey: `0x${string}`}>(opts.adminKey);
        const client = ChainClient.withWallet(loadChainConfig(), adminKey.privateKey);
        const txHash = await client.revokeIssuer(opts.address, opts.reason);
        console.log(`✓ revoked issuer ${opts.address}`);
        console.log(`  tx: ${txHash}`);
    });

program.parseAsync(process.argv).catch((err) => {
    console.error("error:", (err as Error).message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
});

// Silence "no shebang permission" warnings; fs.chmod is not strictly necessary because
// users invoke us via `npm run issuer -- ...` rather than directly.
void writeFileSync;
