import {describe, expect, it} from "vitest";
import {
    createPresentation,
    credentialId,
    generateKeyPair,
    issueCredential,
    keyPairFromPrivateKey,
    verifyPresentation,
} from "../src/core/index.js";
import type {ChainView} from "../src/core/credential.js";
import type {Hex} from "../src/core/hash.js";

const transcript = [
    {key: "course:CS101", value: {name: "Intro to CS", credits: 3, grade: "A"}},
    {key: "course:MATH201", value: {name: "Calculus II", credits: 4, grade: "B+"}},
    {key: "course:PH150", value: {name: "Physics I", credits: 3, grade: "A-"}},
    {key: "course:EN101", value: {name: "English", credits: 2, grade: "B"}},
    {key: "course:HIS200", value: {name: "World History", credits: 2, grade: "A"}},
];

function makeCredential() {
    const issuer = generateKeyPair();
    const cred = issueCredential({
        issuerKey: issuer,
        holder: "did:example:alice",
        credentialType: "Bachelor of Science in Computer Science",
        claims: transcript,
        issuedAt: 1_700_000_000,
        expiresAt: 0,
    });
    return {issuer, cred};
}

const happyChain: ChainView = {
    isAuthorizedIssuer: async () => true,
    credentialAnchorStatus: async () => ({status: "Unknown"}),
};

describe("Credential issuance + selective disclosure", () => {
    it("verifies a presentation that discloses only some claims", async () => {
        const {cred} = makeCredential();
        const pres = createPresentation({credential: cred, disclose: ["course:CS101", "course:MATH201"]});
        const result = await verifyPresentation(pres, {requireAnchor: false});
        expect(result.valid).toBe(true);
        expect(result.disclosedClaims!.map((c) => c.key).sort()).toEqual(["course:CS101", "course:MATH201"]);
    });

    it("rejects a presentation when a disclosed claim was tampered with", async () => {
        const {cred} = makeCredential();
        const pres = createPresentation({credential: cred, disclose: ["course:CS101"]});
        // Mutate the disclosed claim's value
        pres.disclosed[0]!.claim = {
            ...pres.disclosed[0]!.claim,
            value: {...(pres.disclosed[0]!.claim.value as object), grade: "A+"},
        };
        const result = await verifyPresentation(pres, {requireAnchor: false});
        expect(result.valid).toBe(false);
        expect(result.checks.find((c) => c.name.startsWith("merkle_proof:"))!.passed).toBe(false);
    });

    it("rejects when the issuer signature is forged", async () => {
        const {cred} = makeCredential();
        const pres = createPresentation({credential: cred, disclose: ["course:CS101"]});
        // tamper with merkleRoot in metadata — invalidates issuer signature
        pres.credential.merkleRoot = ("0x" + "ee".repeat(32)) as Hex;
        const result = await verifyPresentation(pres, {requireAnchor: false});
        expect(result.valid).toBe(false);
        expect(result.checks.find((c) => c.name === "issuer_signature")!.passed).toBe(false);
    });

    it("rejects expired credentials", async () => {
        const issuer = generateKeyPair();
        const cred = issueCredential({
            issuerKey: issuer,
            holder: "did:example:alice",
            credentialType: "Test",
            claims: transcript,
            issuedAt: 1_700_000_000,
            expiresAt: 1_700_000_100,
        });
        const pres = createPresentation({credential: cred, disclose: ["course:CS101"]});
        const result = await verifyPresentation(pres, {requireAnchor: false, nowSeconds: 1_700_000_500});
        expect(result.valid).toBe(false);
        expect(result.checks.find((c) => c.name === "not_expired")!.passed).toBe(false);
    });

    it("on-chain anchor must match credential's merkleRoot", async () => {
        const {cred} = makeCredential();
        const pres = createPresentation({credential: cred, disclose: ["course:CS101"]});
        const cid = credentialId(cred);
        const wrongChain: ChainView = {
            isAuthorizedIssuer: async () => true,
            credentialAnchorStatus: async () => ({
                status: "Valid",
                merkleRoot: ("0x" + "ff".repeat(32)) as Hex,
                issuedAt: cred.issuedAt,
                expiresAt: cred.expiresAt,
            }),
        };
        const result = await verifyPresentation(pres, {chain: wrongChain});
        expect(result.valid).toBe(false);
        expect(result.checks.find((c) => c.name === "anchor_present")!.detail).toMatch(/merkle root mismatch/);
        // sanity: the credentialId is deterministic
        expect(cid).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("revoked credentials fail verification", async () => {
        const {cred} = makeCredential();
        const pres = createPresentation({credential: cred, disclose: ["course:CS101"]});
        const revokedChain: ChainView = {
            isAuthorizedIssuer: async () => true,
            credentialAnchorStatus: async () => ({status: "Revoked", reason: "fraud"}),
        };
        const result = await verifyPresentation(pres, {chain: revokedChain});
        expect(result.valid).toBe(false);
        expect(result.checks.find((c) => c.name === "anchor_present")!.detail).toMatch(/revoked/);
    });

    it("issuer must be currently authorized", async () => {
        const {cred} = makeCredential();
        const pres = createPresentation({credential: cred, disclose: ["course:CS101"]});
        const unauthorizedChain: ChainView = {
            isAuthorizedIssuer: async () => false,
            credentialAnchorStatus: async () => ({
                status: "Valid",
                merkleRoot: cred.merkleRoot,
                issuedAt: cred.issuedAt,
                expiresAt: cred.expiresAt,
            }),
        };
        const result = await verifyPresentation(pres, {chain: unauthorizedChain});
        expect(result.valid).toBe(false);
        expect(result.checks.find((c) => c.name === "issuer_authorized")!.passed).toBe(false);
    });

    it("holder proof binds presentation to verifier nonce", async () => {
        const {cred} = makeCredential();
        const holderKey = generateKeyPair();
        const nonce = ("0x" + "aa".repeat(32)) as Hex;
        const pres = createPresentation({
            credential: cred,
            disclose: ["course:CS101"],
            holderKey,
            nonce,
        });
        // Correct nonce: verifies
        let result = await verifyPresentation(pres, {
            chain: happyChain,
            requireAnchor: false,
            requireHolderProof: true,
            expectedNonce: nonce,
        });
        expect(result.valid).toBe(true);

        // Wrong nonce: fails
        result = await verifyPresentation(pres, {
            chain: happyChain,
            requireAnchor: false,
            requireHolderProof: true,
            expectedNonce: ("0x" + "bb".repeat(32)) as Hex,
        });
        expect(result.valid).toBe(false);
        expect(result.checks.find((c) => c.name === "holder_proof")!.detail).toMatch(/nonce mismatch/);
    });

    it("credential without holder proof fails when required", async () => {
        const {cred} = makeCredential();
        const pres = createPresentation({credential: cred, disclose: ["course:CS101"]});
        const result = await verifyPresentation(pres, {
            requireAnchor: false,
            requireHolderProof: true,
        });
        expect(result.valid).toBe(false);
        expect(result.checks.find((c) => c.name === "holder_proof")!.passed).toBe(false);
    });

    it("an attacker cannot forge a claim by manufacturing a Merkle proof", async () => {
        const {cred} = makeCredential();
        const pres = createPresentation({credential: cred, disclose: ["course:CS101"]});
        // Inject an extra "disclosed" claim with bogus proof
        pres.disclosed.push({
            claim: {key: "course:HACKED", value: {grade: "A+"}, salt: "0x" + "00".repeat(32)},
            proof: ["0x" + "11".repeat(32)] as `0x${string}`[],
            positions: [false],
        });
        const result = await verifyPresentation(pres, {requireAnchor: false});
        expect(result.valid).toBe(false);
        expect(result.checks.find((c) => c.name === "merkle_proof:course:HACKED")!.passed).toBe(false);
    });

    it("credentialId is deterministic across re-derivations", () => {
        const issuer = keyPairFromPrivateKey(("0x" + "11".repeat(32)) as Hex);
        const cred1 = issueCredential({
            issuerKey: issuer,
            holder: "did:example:alice",
            credentialType: "Test",
            claims: transcript.map((c, i) => ({...c, salt: ("0x" + i.toString(16).padStart(64, "0")) as Hex})),
            issuedAt: 1_700_000_000,
            expiresAt: 0,
        });
        // We can't reproduce the same `id` field without forcing it (it's random),
        // but credentialId is deterministic for any given credential bytes.
        expect(credentialId(cred1)).toBe(credentialId(cred1));
    });
});
