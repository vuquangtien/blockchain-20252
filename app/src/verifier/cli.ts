#!/usr/bin/env node
/**
 * Verifier CLI — third parties (employers, other universities, government agencies)
 * use this to validate a Presentation produced by a Holder.
 *
 * Examples:
 *   verifier verify --presentation data/alice.pres.json
 *   verifier verify --presentation data/alice.pres.json --offline
 *   verifier verify --presentation ... --require-anchor false
 *   verifier challenge   # prints a fresh nonce to give to the holder
 */
import {Command} from "commander";
import {randomBytes} from "node:crypto";
import {verifyPresentation} from "../core/index.js";
import type {Presentation} from "../core/types.js";
import type {Hex} from "../core/hash.js";
import {ChainClient} from "../chain/client.js";
import {loadChainConfig} from "../util/config.js";
import {readJSON} from "../util/io.js";

const program = new Command();
program
    .name("verifier")
    .description("Third-party CLI for verifying selective-disclosure presentations of academic credentials.")
    .version("0.1.0");

program
    .command("challenge")
    .description("Print a fresh 32-byte nonce that you can give the holder for a holder-bound presentation.")
    .action(() => {
        const nonce = `0x${Buffer.from(randomBytes(32)).toString("hex")}` as Hex;
        console.log(nonce);
    });

program
    .command("verify")
    .description("Run the full verification pipeline against a presentation file.")
    .requiredOption("--presentation <path>", "presentation JSON to verify")
    .option("--offline", "skip on-chain checks (signature + Merkle proofs only)")
    .option("--require-anchor <bool>", "true|false — require credential anchored on-chain", "true")
    .option("--expected-nonce <hex>", "if you issued a nonce, provide it here to bind the holder proof")
    .option("--require-holder-proof", "fail if the presentation has no holder proof")
    .action(async (opts: {
        presentation: string;
        offline?: boolean;
        requireAnchor: string;
        expectedNonce?: string;
        requireHolderProof?: boolean;
    }) => {
        const pres = readJSON<Presentation>(opts.presentation);
        const result = await verifyPresentation(pres, {
            chain: opts.offline ? undefined : new ChainClient(loadChainConfig()),
            requireAnchor: opts.requireAnchor === "true",
            ...(opts.expectedNonce ? {expectedNonce: opts.expectedNonce as Hex} : {}),
            ...(opts.requireHolderProof ? {requireHolderProof: true} : {}),
        });

        console.log(`Verification: ${result.valid ? "✅ VALID" : "❌ INVALID"}`);
        for (const c of result.checks) {
            const mark = c.passed ? "✓" : "✗";
            console.log(`  ${mark} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
        }

        if (result.valid && result.disclosedClaims) {
            console.log("\nDisclosed claims:");
            for (const c of result.disclosedClaims) {
                console.log(`  - ${c.key}: ${JSON.stringify(c.value)}`);
            }
        }

        if (!result.valid) process.exit(2);
    });

program.parseAsync(process.argv).catch((err) => {
    console.error("error:", (err as Error).message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
});
