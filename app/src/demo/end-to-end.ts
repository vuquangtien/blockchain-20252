/**
 * End-to-end demo of the academic credential system.
 *
 * Story:
 *   1. Admin (Ministry) deploys IssuerRegistry + CredentialRegistry.
 *   2. Admin registers HUST as an authorized issuer.
 *   3. HUST issues Alice a degree credential with 5 courses, anchors it on-chain.
 *   4. Alice creates a presentation revealing only 2 of the 5 courses.
 *   5. A verifier checks the presentation — it's valid.
 *   6. Tamper test: modifying a disclosed grade breaks the proof.
 *   7. HUST revokes the credential — verification now fails.
 *   8. New credential anchored, then HUST itself loses authority — verification fails.
 *
 * Prerequisites:
 *   - anvil running at $RPC_URL (default http://127.0.0.1:8545)
 *   - `forge build` has been run in ../contracts
 *
 * Run:
 *   npm run demo
 */
import {Wallet, JsonRpcProvider, ContractFactory, type InterfaceAbi} from "ethers";
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";

import {
    createPresentation,
    credentialId,
    generateKeyPair,
    holderHash,
    issueCredential,
    keyPairFromPrivateKey,
    verifyPresentation,
} from "../core/index.js";
import {ChainClient} from "../chain/client.js";
import type {ChainConfig} from "../core/types.js";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ADMIN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil[0]
const HUST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil[1]

function section(title: string): void {
    console.log(`\n${"━".repeat(70)}\n  ${title}\n${"━".repeat(70)}`);
}

function loadArtifact(name: string): {abi: InterfaceAbi; bytecode: {object: string}} {
    const path = resolve(process.cwd(), `../contracts/out/${name}.sol/${name}.json`);
    if (!existsSync(path)) throw new Error(`Missing artifact: ${path} — run forge build`);
    return JSON.parse(readFileSync(path, "utf8"));
}

async function main(): Promise<void> {
    section("1) Deploy contracts");
    const provider = new JsonRpcProvider(RPC_URL);
    const admin = new Wallet(ADMIN_KEY, provider);

    let network;
    try {
        network = await provider.getNetwork();
    } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("ECONNREFUSED") || msg.includes("failed to detect network")) {
            console.error(
                `\n❌ Cannot reach Ethereum node at ${RPC_URL}.\n\n` +
                `Start a local node first, in another terminal:\n` +
                `   anvil\n\n` +
                `Or run \`npm run demo:full\` to auto-start anvil for this demo.\n`,
            );
            process.exit(1);
        }
        throw err;
    }

    const issuerArtifact = loadArtifact("IssuerRegistry");
    const credArtifact = loadArtifact("CredentialRegistry");

    const nonce0 = await provider.getTransactionCount(admin.address, "latest");
    const issuerFactory = new ContractFactory(issuerArtifact.abi, issuerArtifact.bytecode.object, admin);
    const issuerRegistry = await issuerFactory.deploy(admin.address, {nonce: nonce0});
    await issuerRegistry.deploymentTransaction()?.wait();
    const issuerAddr = (await issuerRegistry.getAddress()) as `0x${string}`;
    console.log(`  IssuerRegistry      : ${issuerAddr}`);

    const credFactory = new ContractFactory(credArtifact.abi, credArtifact.bytecode.object, admin);
    const credentialRegistry = await credFactory.deploy(issuerAddr, {nonce: nonce0 + 1});
    await credentialRegistry.deploymentTransaction()?.wait();
    const credAddr = (await credentialRegistry.getAddress()) as `0x${string}`;
    console.log(`  CredentialRegistry  : ${credAddr}`);

    const config: ChainConfig = {
        rpcUrl: RPC_URL,
        chainId: Number(network.chainId),
        issuerRegistry: issuerAddr,
        credentialRegistry: credAddr,
    };

    section("2) Admin registers HUST");
    const adminClient = new ChainClient(config, admin);
    const hustKey = keyPairFromPrivateKey(HUST_KEY);
    await adminClient.registerIssuer(hustKey.address, "Hanoi University of Science and Technology", "");
    console.log(`  registered HUST @ ${hustKey.address}`);

    section("3) HUST issues Alice's degree credential");
    const aliceHolderId = "did:vn:alice-2025"; // could be a wallet, DID, or opaque id
    const aliceHolderKey = generateKeyPair();   // optional — only needed for holder-bound proofs

    const credential = issueCredential({
        issuerKey: hustKey,
        holder: aliceHolderId,
        credentialType: "Bachelor of Engineering — Computer Science",
        schemaURI: "https://hust.edu.vn/schemas/cred/transcript-v1.json",
        expiresAt: 0,
        claims: [
            {key: "course:CS101", value: {name: "Intro to CS", credits: 3, grade: "A", semester: "20241"}},
            {key: "course:MATH201", value: {name: "Calculus II", credits: 4, grade: "B+", semester: "20241"}},
            {key: "course:PH150", value: {name: "Physics I", credits: 3, grade: "A-", semester: "20242"}},
            {key: "course:EN101", value: {name: "Academic English", credits: 2, grade: "B", semester: "20242"}},
            {key: "course:HIS200", value: {name: "Vietnamese History", credits: 2, grade: "A", semester: "20243"}},
            {key: "gpa", value: {value: 3.65, scale: 4.0}},
            {key: "thesis", value: {title: "ZK Proofs for Academic Credentials", grade: "A"}},
        ],
    });
    console.log(`  credential.id        : ${credential.id}`);
    console.log(`  merkle root          : ${credential.merkleRoot}`);
    console.log(`  credentialId (hash)  : ${credentialId(credential)}`);

    section("4) HUST anchors credential on-chain");
    const hustClient = new ChainClient(config, new Wallet(HUST_KEY, provider));
    const txAnchor = await hustClient.anchorCredential({
        credentialId: credentialId(credential),
        holderHash: holderHash(aliceHolderId),
        merkleRoot: credential.merkleRoot,
        issuedAt: credential.issuedAt,
        expiresAt: credential.expiresAt,
    });
    console.log(`  anchor tx: ${txAnchor}`);

    section("5) Alice produces a redacted presentation (only thesis + gpa)");
    const verifierClient = new ChainClient(config); // read-only client
    const challengeNonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as `0x${string}`;
    console.log(`  verifier challenge nonce: ${challengeNonce}`);

    const pres = createPresentation({
        credential,
        disclose: ["thesis", "gpa"],
        holderKey: aliceHolderKey,
        nonce: challengeNonce,
    });
    console.log(`  disclosed claims: ${pres.disclosed.map((d) => d.claim.key).join(", ")}`);

    section("6) Verifier runs the verification pipeline");
    let res = await verifyPresentation(pres, {
        chain: verifierClient,
        requireAnchor: true,
        requireHolderProof: true,
        expectedNonce: challengeNonce,
    });
    printResult(res);
    if (!res.valid) throw new Error("expected the presentation to be valid");

    section("7) Tamper test — verifier should reject a modified grade");
    const tampered = JSON.parse(JSON.stringify(pres));
    // Flip the GPA from 3.65 to 4.0
    const gpa = tampered.disclosed.find((d: {claim: {key: string}}) => d.claim.key === "gpa");
    gpa.claim.value = {value: 4.0, scale: 4.0};
    res = await verifyPresentation(tampered, {chain: verifierClient, requireAnchor: true});
    console.log(`  → tampered presentation valid=${res.valid} (expected false)`);
    if (res.valid) throw new Error("tampered presentation should not verify");

    section("8) HUST revokes the credential — verifier rejects");
    await hustClient.revokeCredential(credentialId(credential), "academic dishonesty");
    res = await verifyPresentation(pres, {chain: verifierClient, requireAnchor: true});
    printResult(res);
    if (res.valid) throw new Error("revoked presentation should not verify");

    section("9) Issuer authority revoked — even valid credentials fail verification");
    // Issue a new credential to demonstrate "issuer authority" check
    const cred2 = issueCredential({
        issuerKey: hustKey,
        holder: aliceHolderId,
        credentialType: "Certificate of Attendance",
        claims: [{key: "course:WORKSHOP", value: {hours: 8}}],
    });
    await hustClient.anchorCredential({
        credentialId: credentialId(cred2),
        holderHash: holderHash(aliceHolderId),
        merkleRoot: cred2.merkleRoot,
        issuedAt: cred2.issuedAt,
        expiresAt: cred2.expiresAt,
    });
    const pres2 = createPresentation({credential: cred2, disclose: ["course:WORKSHOP"]});
    res = await verifyPresentation(pres2, {chain: verifierClient, requireAnchor: true});
    console.log(`  before authority revoke: valid=${res.valid}`);

    await adminClient.revokeIssuer(hustKey.address, "lost accreditation");
    res = await verifyPresentation(pres2, {chain: verifierClient, requireAnchor: true});
    console.log(`  after  authority revoke: valid=${res.valid}`);
    if (res.valid) throw new Error("credential from unauthorized issuer should not verify");

    console.log("\n✅ Demo completed successfully.");
}

function printResult(r: {valid: boolean; checks: {name: string; passed: boolean; detail?: string}[]}): void {
    console.log(`  valid=${r.valid}`);
    for (const c of r.checks) {
        console.log(`    ${c.passed ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
}

main().catch((err) => {
    console.error("DEMO FAILED:", err);
    process.exit(1);
});
