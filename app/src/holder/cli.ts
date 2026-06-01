#!/usr/bin/env node
/**
 * Holder CLI — for students to manage their credentials and create selective-disclosure
 * presentations.
 *
 * Quick reference:
 *   holder keygen --out keys/alice.json
 *   holder list --cred data/alice.cred.json
 *   holder present --cred data/alice.cred.json --disclose course:CS101,course:MATH201 --out data/alice.pres.json
 *   holder present --cred ... --disclose ... --holder-key keys/alice.json --nonce 0xabc... --out ...
 */
import {Command} from "commander";
import {
    createPresentation,
    credentialId,
    generateKeyPair,
    keyPairFromPrivateKey,
} from "../core/index.js";
import type {Credential} from "../core/types.js";
import type {Hex} from "../core/hash.js";
import {readJSON, writeJSON} from "../util/io.js";

const program = new Command();
program
    .name("holder")
    .description("Student-side CLI for managing credentials and producing redacted presentations.")
    .version("0.1.0");

program
    .command("keygen")
    .description("Generate a fresh holder keypair (used to bind presentations to a verifier challenge).")
    .requiredOption("--out <path>", "where to save the keypair JSON")
    .action((opts: {out: string}) => {
        const kp = generateKeyPair();
        writeJSON(opts.out, kp);
        console.log(`✓ holder keypair written to ${opts.out}`);
        console.log(`  address: ${kp.address}`);
    });

program
    .command("list")
    .description("Print the claim keys / values stored inside a credential (does NOT modify it).")
    .requiredOption("--cred <path>", "signed credential JSON")
    .action((opts: {cred: string}) => {
        const cred = readJSON<Credential>(opts.cred);
        console.log(`Credential ${cred.id}`);
        console.log(`  type:        ${cred.credentialType}`);
        console.log(`  issuer:      ${cred.issuer}`);
        console.log(`  holder:      ${cred.holder}`);
        console.log(`  issuedAt:    ${cred.issuedAt} (${new Date(cred.issuedAt * 1000).toISOString()})`);
        console.log(`  expiresAt:   ${cred.expiresAt === 0 ? "never" : new Date(cred.expiresAt * 1000).toISOString()}`);
        console.log(`  merkleRoot:  ${cred.merkleRoot}`);
        console.log(`  claims:`);
        for (const c of cred.claims) {
            console.log(`    - ${c.key}: ${JSON.stringify(c.value)}`);
        }
    });

program
    .command("present")
    .description("Produce a Presentation that discloses ONLY the requested claims.")
    .requiredOption("--cred <path>", "signed credential JSON")
    .requiredOption("--disclose <keys>", "comma-separated claim keys to reveal (e.g. 'course:CS101,course:MATH201')")
    .requiredOption("--out <path>", "where to write the presentation")
    .option("--holder-key <path>", "if provided, sign a holder-bound proof with this keypair")
    .option("--nonce <hex>", "32-byte hex nonce given to you by the verifier")
    .action((opts: {cred: string; disclose: string; out: string; holderKey?: string; nonce?: string}) => {
        const credential = readJSON<Credential>(opts.cred);
        const keys = opts.disclose.split(",").map((k) => k.trim()).filter(Boolean);

        const params: Parameters<typeof createPresentation>[0] = {
            credential,
            disclose: keys,
        };
        if (opts.holderKey) {
            const kp = keyPairFromPrivateKey(readJSON<{privateKey: `0x${string}`}>(opts.holderKey).privateKey);
            if (!opts.nonce) throw new Error("--nonce required when --holder-key is set");
            params.holderKey = kp;
            params.nonce = opts.nonce as Hex;
        }

        const pres = createPresentation(params);
        writeJSON(opts.out, pres);
        console.log(`✓ presentation written to ${opts.out}`);
        console.log(`  credentialId:    ${credentialId(credential)}`);
        console.log(`  disclosed claims: ${keys.length} of ${credential.claims.length}`);
        for (const k of keys) console.log(`     - ${k}`);
    });

program.parseAsync(process.argv).catch((err) => {
    console.error("error:", (err as Error).message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
});
