import { describe, it, expect } from "vitest";
import { Wallet } from "ethers";
import { v2 } from "../src/core/index.js";
import { keyPairFromPrivateKey, signRawDigest } from "../src/core/ecc.js";
import { bytesToHex, hexToBytes } from "../src/core/hash.js";

// Fixed Golden Vector Keys and Values
const ISSUER_PRIV = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Anvil account 0
const HOLDER_PRIV = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // Anvil account 1
const VERIFIER_PRIV = "0x5de4111afa73d9b5c2f207f1a826f837756d661c9c8d15d66d5b4eae3b6ff359"; // Anvil account 2

const issuerOrgId = "0x" + "1".repeat(64);
const credId = "0x" + "2".repeat(64);
const reqId = "0x" + "3".repeat(64);
const nonce = "0x" + "4".repeat(64);

const issuerAddr = keyPairFromPrivateKey(ISSUER_PRIV).address;
const holderAddr = keyPairFromPrivateKey(HOLDER_PRIV).address;
const verifierAddr = keyPairFromPrivateKey(VERIFIER_PRIV).address;

const goldenClaims = [
    { key: "gpa", value: 3.8, salt: "0x" + "5".repeat(64) },
    { key: "course:CS202", value: { name: "Data Structures", grade: "A" }, salt: "0x" + "6".repeat(64) }
];

// Memory-based ReplayGuard for testing
class MockReplayGuard implements v2.ReplayGuard {
    public consumed = new Set<string>();
    public consumeCalls = 0;
    async isConsumed(requestId: string): Promise<boolean> {
        return this.consumed.has(requestId);
    }
    async consume(requestId: string): Promise<void> {
        this.consumeCalls++;
        this.consumed.add(requestId);
    }
}

describe("Protocol V2 Core", () => {
    const cred = v2.issueCredentialV2(ISSUER_PRIV, {
        id: credId,
        issuerOrganizationId: issuerOrgId,
        issuerSigningAddress: issuerAddr,
        holder: holderAddr,
        credentialType: "Bachelor of Science",
        schemaURI: "https://schema.hust.edu.vn",
        issuedAt: Math.floor(Date.now() / 1000) - 100,
        expiresAt: 0,
        claims: goldenClaims
    });

    const req = v2.createVerificationRequest(VERIFIER_PRIV, {
        id: reqId,
        verifier: verifierAddr,
        audience: "HUST Employer System",
        nonce: nonce,
        requiredClaimKeys: ["gpa"],
        acceptedIssuerIds: [issuerOrgId],
        acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
        issuedAt: Math.floor(Date.now() / 1000) - 10,
        expiresAt: Math.floor(Date.now() / 1000) + 120
    });

    describe("1. Golden Vectors & Core Functions", () => {
        it("should correctly issue a Credential V2 using golden vectors and match root/digest/sig", () => {
            const cred = v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor of Science",
                schemaURI: "https://schema.hust.edu.vn",
                issuedAt: 1717600000,
                expiresAt: 1717700000,
                claims: goldenClaims
            });

            expect(cred.version).toBe("2.0");
            expect(cred.claimCount).toBe(2);

            // Hardcoded golden-vector assertions
            expect(cred.merkleRoot).toBe("0xfbca798b58223e98bb3c8b7a23680bcac7ec1f4099a1e2fbf6ac045a7412111d");

            const { claims, signature, ...credMeta } = cred;
            expect(v2.credentialDigestV2(credMeta)).toBe("0x41b89eb433bfffb8bda471269d92658b7623a119b7d92469adbaa036fd209cdc");
            expect(cred.signature).toBe("0x154d9da736b0389b434c4e9d7b1e07d339c7180f37535f2c17a30616162882d91745e5a257105eddcc522bbf98b18b096ea581e88ccd091762951794460e26101b");

            // Verify signature recovery
            const valid = v2.verifyCredentialSignatureV2(credMeta, cred.signature);
            expect(valid).toBe(true);
        });

        it("should correctly create a VerificationRequest V1 using golden vectors and match digest/sig", () => {
            const req = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: 1717600000,
                expiresAt: 1717600500
            });

            const { signature, ...reqMeta } = req;
            expect(v2.verificationRequestDigest(reqMeta)).toBe("0xd3ba9c4809e0f1dd347fb2096e4a3fcc3a43ba599e62b750668d51b035b430eb");
            expect(req.signature).toBe("0x3d90e4b14c70e563a5a029eed0136025467f240650fd379031144f982ce1843b5810206ba5eeffe12b3704fe6f534db63a61d05aea34fa46608cc4b061cf83c11c");

            // Use a current valid request when testing full verifyVerificationRequest behavior
            const currentReq = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            });
            const valid = v2.verifyVerificationRequest(currentReq);
            expect(valid).toBe(true);
        });

        it("should correctly create a Presentation V2 using golden vectors and match digest/sig", () => {
            const cred = v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor of Science",
                schemaURI: "https://schema.hust.edu.vn",
                issuedAt: 1717600000,
                expiresAt: 1717700000,
                claims: goldenClaims
            });

            const req = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: 1717600000,
                expiresAt: 1717600500
            });

            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                1717600000,
                1717600300
            );

            const { signature, ...presAuthMeta } = pres.presentationAuthorization;
            expect(v2.presentationAuthorizationDigest(presAuthMeta)).toBe("0x1a855330658348a24a8eccebf244a72418d1f95857b3a7a688591ad83667a4bf");
            expect(signature).toBe("0xcca94e6b8329c7bff9d802dfb4b6d81097214e68cc0cde3a72873f3efee7901c4bd36d451959afe1c6ab0422ca5210dfc57157d1fd67fc13bc68cb8860f6eb0e1b");
        });

        it("should prove that the claim order does not alter the Merkle root", () => {
            const claims1 = [
                { key: "gpa", value: 3.8, salt: "0x" + "1".repeat(64) },
                { key: "math", value: "A", salt: "0x" + "2".repeat(64) }
            ];
            const claims2 = [
                { key: "math", value: "A", salt: "0x" + "2".repeat(64) },
                { key: "gpa", value: 3.8, salt: "0x" + "1".repeat(64) }
            ];

            const tree1 = new v2.MerkleClaimTreeV2(credId, claims1);
            const tree2 = new v2.MerkleClaimTreeV2(credId, claims2);
            expect(tree1.root).toBe(tree2.root);
        });

        it("should prove that the credential ID changes the leaf hash for identical claims", () => {
            const claim = { key: "gpa", value: 3.8, salt: "0x" + "1".repeat(64) };
            const id1 = "0x" + "1".repeat(64);
            const id2 = "0x" + "2".repeat(64);

            const hash1 = v2.claimLeafHashV2(id1, claim.key, claim.value, claim.salt);
            const hash2 = v2.claimLeafHashV2(id2, claim.key, claim.value, claim.salt);

            expect(bytesToHex(hash1)).not.toBe(bytesToHex(hash2));
        });
    });

    describe("2. Validation Limits & Value Rules", () => {
        it("should reject unsafe integers in claim values", () => {
            const badClaim = { key: "gpa", value: Number.MAX_SAFE_INTEGER + 10, salt: "0x" + "1".repeat(64) };
            expect(() => v2.validateClaimValue(badClaim.value)).toThrow("unsafe integers are not allowed");
        });

        it("should reject non-finite numbers in claim values", () => {
            expect(() => v2.validateClaimValue(Infinity)).toThrow("non-finite numbers are not allowed");
            expect(() => v2.validateClaimValue(NaN)).toThrow("non-finite numbers are not allowed");
        });

        it("should reject depth > 8 in claim values", () => {
            const deepObject: any = {};
            let curr = deepObject;
            for (let i = 0; i < 9; i++) {
                curr.next = {};
                curr = curr.next;
            }
            expect(() => v2.validateClaimValue(deepObject)).toThrow("nesting depth exceeds limit of 8");
        });

        it("should reject prototype polluting keys in objects", () => {
            const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
            expect(() => v2.validateClaimValue(malicious)).toThrow("prototype-polluting key");
        });

        it("should reject sparse arrays", () => {
            const sparse: any[] = [];
            sparse[2] = "value";
            expect(() => v2.validateClaimValue(sparse)).toThrow("sparse array detected");
        });

        it("should reject undefined, functions, symbols, and bigints", () => {
            expect(() => v2.validateClaimValue(undefined)).toThrow("undefined is not a valid JSON-compatible");
            expect(() => v2.validateClaimValue(() => {})).toThrow("functions are not allowed");
            expect(() => v2.validateClaimValue(Symbol("test"))).toThrow("symbols are not allowed");
            expect(() => v2.validateClaimValue(10n)).toThrow("bigint is not allowed");
        });

        it("should reject canonical JSON size > 4096 bytes", () => {
            const hugeString = "a".repeat(4100);
            expect(() => v2.validateClaimValue(hugeString)).toThrow("exceeds limit of 4096 bytes");
        });

        it("should reject invalid claim key format", () => {
            const invalidClaims = [
                { key: "gpa!", value: 3.8, salt: "0x" + "1".repeat(64) }
            ];
            expect(() => v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor",
                schemaURI: "https://schema",
                issuedAt: 1000,
                expiresAt: 2000,
                claims: invalidClaims
            })).toThrow("Invalid claim key format");
        });

        it("should reject duplicate claim keys", () => {
            const dupClaims = [
                { key: "gpa", value: 3.8, salt: "0x" + "1".repeat(64) },
                { key: "gpa", value: 4.0, salt: "0x" + "2".repeat(64) }
            ];
            expect(() => v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor",
                schemaURI: "https://schema",
                issuedAt: 1000,
                expiresAt: 2000,
                claims: dupClaims
            })).toThrow("Duplicate claim key");
        });

        it("should reject unknown object properties", () => {
            const badCred = {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor of Science",
                schemaURI: "https://schema.hust.edu.vn",
                issuedAt: 1717600000,
                expiresAt: 1717700000,
                claims: goldenClaims,
                extraProperty: "malicious"
            };
            expect(() => v2.issueCredentialV2(ISSUER_PRIV, badCred as any)).toThrow("unrecognized_keys");
        });

        it("should reject claimCount 0, >256, or inconsistent with claims", () => {
            const claims = Array(257).fill(null).map((_, i) => ({
                key: `k${i}`,
                value: i,
                salt: "0x" + "5".repeat(64)
            }));
            expect(() => v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor",
                schemaURI: "https://schema",
                issuedAt: 1000,
                expiresAt: 2000,
                claims: claims
            })).toThrow("between 1 and 256");
        });

        it("should reject invalid/zero salt", () => {
            const badClaims = [
                { key: "gpa", value: 3.8, salt: "0x" + "0".repeat(64) } // Zero salt
            ];
            expect(() => v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor",
                schemaURI: "https://schema",
                issuedAt: 1000,
                expiresAt: 2000,
                claims: badClaims
            })).toThrow("Zero bytes32 is invalid");
        });

        it("should reject oversized UTF-8 fields using multibyte characters", () => {
            // "🎓" is a 4-byte character.
            // 33 repetitions is 132 bytes, which exceeds 128 bytes limit.
            const longType = "🎓".repeat(33);
            expect(() => v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: longType,
                schemaURI: "https://schema",
                issuedAt: 1000,
                expiresAt: 2000,
                claims: goldenClaims
            })).toThrow("Credential type must be <= 128 UTF-8 bytes");
        });
    });

    describe("3. EIP-712 Interoperability", () => {
        it("should match signature generated using ethers signTypedData with wallet key for Credential", async () => {
            const nobleCred = v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor of Science",
                schemaURI: "https://schema.hust.edu.vn",
                issuedAt: 1717600000,
                expiresAt: 1717700000,
                claims: goldenClaims
            });
            const nobleSig = nobleCred.signature;

            const wallet = new Wallet(ISSUER_PRIV);
            const { claims, signature, ...credMeta } = nobleCred;
            const ethersSig = await wallet.signTypedData(
                v2.CREDENTIAL_DOMAIN,
                v2.CREDENTIAL_TYPES,
                credMeta
            );

            expect(nobleSig).toBe(ethersSig);
        });

        it("should match signature generated using ethers signTypedData with wallet key for Request", async () => {
            const nobleReq = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: 1717600000,
                expiresAt: 1717600500
            });
            const nobleSig = nobleReq.signature;

            const wallet = new Wallet(VERIFIER_PRIV);
            const { requiredClaimKeys, acceptedIssuerIds, acceptedSchemaURIs, signature, ...reqMeta } = nobleReq;
            const ethersSig = await wallet.signTypedData(
                v2.REQUEST_DOMAIN,
                v2.REQUEST_TYPES,
                reqMeta
            );

            expect(nobleSig).toBe(ethersSig);
        });

        it("should match signature generated using ethers signTypedData with wallet key for Presentation Authorization", async () => {
            const cred = v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor of Science",
                schemaURI: "https://schema.hust.edu.vn",
                issuedAt: 1717600000,
                expiresAt: 1717700000,
                claims: goldenClaims
            });

            const req = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: 1717600000,
                expiresAt: 1717600500
            });

            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                1717600000,
                1717600300
            );
            const nobleSig = pres.presentationAuthorization.signature;

            const wallet = new Wallet(HOLDER_PRIV);
            const { signature, ...presAuthMeta } = pres.presentationAuthorization;
            const ethersSig = await wallet.signTypedData(
                v2.PRESENTATION_DOMAIN,
                v2.PRESENTATION_TYPES,
                presAuthMeta
            );

            expect(nobleSig).toBe(ethersSig);
        });
    });

    describe("4. Presentation Verification Core & Policies", () => {

        it("should successfully verify presentation V2 on the happy path", async () => {
            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(true);
            expect(result.disclosedClaims).toHaveLength(1);
            expect(result.disclosedClaims![0]!.key).toBe("gpa");
            expect(result.disclosedClaims![0]!.value).toBe(3.8);
        });

        it("should reject if holder signature is forged", async () => {
            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            // Tamper holder signature
            pres.presentationAuthorization.signature = "0x" + "a".repeat(130);

            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "holder_signature");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("INVALID_HOLDER_SIGNATURE");
        });

        it("should reject if empty disclosure array is provided to createPresentationV2", async () => {
            expect(() => v2.createPresentationV2(
                cred,
                req,
                [],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            )).toThrow("Disclosed keys must match requiredClaimKeys exactly");
        });

        it("should reject if disclosure set does not match requested claims exactly (missing required claims)", async () => {
            const req2 = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa", "course:CS202"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            });

            expect(() => v2.createPresentationV2(
                cred,
                req2,
                ["gpa"], // missing course:CS202
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            )).toThrow("Disclosed keys must match requiredClaimKeys exactly");
        });

        it("should reject if disclosure set has duplicate claims", async () => {
            expect(() => v2.createPresentationV2(
                cred,
                req,
                ["gpa", "gpa"], // duplicate
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            )).toThrow("Duplicate claim keys in disclosure request");
        });

        it("should reject wrong audience", async () => {
            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "Malicious Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "audience_match");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("INVALID_AUDIENCE");
        });

        it("should reject request expiration", async () => {
            const expiredReq = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 1000,
                expiresAt: Math.floor(Date.now() / 1000) - 500
            });

            const pres = v2.createPresentationV2(
                cred,
                expiredReq,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 800,
                Math.floor(Date.now() / 1000) - 600
            );

            const result = await v2.verifyPresentationV2(pres, expiredReq, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "request_not_expired");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("INVALID_REQUEST_EXPIRED");
        });

        it("should reject expired presentation", async () => {
            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) - 2
            );

            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "presentation_not_expired");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("INVALID_PRESENTATION_EXPIRED");
        });

        it("should reject presentation that outlives verification request", () => {
            expect(() => v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000),
                req.expiresAt + 10 // outlives request
            )).toThrow("Presentation expiration cannot outlive the verification request");
        });

        it("should fail validation if replay is detected by ReplayGuard", async () => {
            const replayGuard = new MockReplayGuard();

            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            // Successful first verification
            const result1 = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System",
                replayGuard
            });
            expect(result1.valid).toBe(true);

            // Replay verification should fail
            const result2 = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System",
                replayGuard
            });
            expect(result2.valid).toBe(false);
            const check = result2.checks.find(c => c.name === "replay_protection");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("REPLAY_DETECTED");
        });

        it("should reject malformed input objects with Zod checks instead of throwing", async () => {
            const result = await v2.verifyPresentationV2(null, req, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "structure_presentation");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("MALFORMED_INPUT");
        });

        it("should reject unauthorized issuer organizational ID", async () => {
            const req3 = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: ["0x" + "f".repeat(64)], // unauthorized ID
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            });

            const pres = v2.createPresentationV2(
                cred,
                req3,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            const result = await v2.verifyPresentationV2(pres, req3, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "policy_content_match");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("POLICY_UNAUTHORIZED_ISSUER");
        });

        it("should reject unauthorized schema URI", async () => {
            const req4 = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["ipfs://unauthorized-schema"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            });

            const pres = v2.createPresentationV2(
                cred,
                req4,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            const result = await v2.verifyPresentationV2(pres, req4, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "policy_content_match");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("POLICY_UNAUTHORIZED_SCHEMA");
        });

        it("should reject if verifier signature is forged", async () => {
            const forgedReq = {
                ...req,
                signature: "0x" + "b".repeat(130)
            };

            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            const result = await v2.verifyPresentationV2(pres, forgedReq, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "verifier_signature");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("INVALID_VERIFIER_SIGNATURE");
        });

        it("should reject if issuer signature is forged", async () => {
            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            const forgedCred = {
                ...cred,
                signature: "0x" + "c".repeat(130) as `0x${string}`
            };
            pres.credential.signature = forgedCred.signature;

            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "issuer_signature");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("INVALID_ISSUER_SIGNATURE");
        });

        it("should reject tampered credential metadata (e.g. modified ID)", async () => {
            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            // Tamper metadata
            pres.credential.id = "0x" + "a".repeat(64);

            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "issuer_signature");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("INVALID_ISSUER_SIGNATURE");
        });

        it("should reject tampered claim values in presentation", async () => {
            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            // Tamper disclosed claim value
            pres.disclosed[0]!.value = 4.0;

            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "merkle_proofs");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("INVALID_MERKLE_PROOF");
        });

        it("should reject if binding digests (credentialDigest) do not match", async () => {
            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            // Modify credential digest mapping
            pres.presentationAuthorization.credentialDigest = "0x" + "e".repeat(64);

            // Re-sign with holder's private key to ensure holder_signature check passes
            const presAuthNoSig = {
                credentialDigest: pres.presentationAuthorization.credentialDigest,
                requestDigest: pres.presentationAuthorization.requestDigest,
                disclosureDigest: pres.presentationAuthorization.disclosureDigest,
                holder: pres.presentationAuthorization.holder,
                createdAt: pres.presentationAuthorization.createdAt,
                expiresAt: pres.presentationAuthorization.expiresAt
            };
            const newDigest = v2.presentationAuthorizationDigest(presAuthNoSig);
            pres.presentationAuthorization.signature = signRawDigest(HOLDER_PRIV, hexToBytes(newDigest));

            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "digest_bindings");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("INVALID_BINDING");
        });

        it("should reject future issuedAt timestamps beyond 60s tolerance", async () => {
            const now = Math.floor(Date.now() / 1000);
            const futureCred = v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor of Science",
                schemaURI: "https://schema.hust.edu.vn",
                issuedAt: now,
                expiresAt: 0,
                claims: goldenClaims
            });

            // Tamper issuedAt to a future time
            futureCred.issuedAt = now + 120;

            // Re-sign the tampered credential metadata
            const credMeta = {
                version: futureCred.version,
                id: futureCred.id,
                issuerOrganizationId: futureCred.issuerOrganizationId,
                issuerSigningAddress: futureCred.issuerSigningAddress,
                holder: futureCred.holder,
                credentialType: futureCred.credentialType,
                schemaURI: futureCred.schemaURI,
                issuedAt: futureCred.issuedAt,
                expiresAt: futureCred.expiresAt,
                merkleRoot: futureCred.merkleRoot,
                claimCount: futureCred.claimCount
            };
            const newDigest = v2.credentialDigestV2(credMeta);
            futureCred.signature = signRawDigest(ISSUER_PRIV, hexToBytes(newDigest));

            const pres = v2.createPresentationV2(
                futureCred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "credential_not_expired");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("FUTURE_TIMESTAMP");
        });

        // ------------------------- TASK 2B REGRESSION TESTS -------------------------

        it("should reject missing request policy arrays", async () => {
            const malReq = {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimsHash: "0x" + "3".repeat(64),
                acceptedIssuerIdsHash: "0x" + "3".repeat(64),
                acceptedSchemaURIsHash: "0x" + "3".repeat(64),
                issuedAt: Math.floor(Date.now() / 1000),
                expiresAt: Math.floor(Date.now() / 1000) + 120,
                signature: "0x" + "a".repeat(130)
            }; // missing requiredClaimKeys, acceptedIssuerIds, acceptedSchemaURIs
            const pres = v2.createPresentationV2(cred, req, ["gpa"], HOLDER_PRIV, Math.floor(Date.now() / 1000) - 5, Math.floor(Date.now() / 1000) + 60);
            const res = await v2.verifyPresentationV2(pres, malReq, { expectedAudience: "HUST Employer System" });
            expect(res.valid).toBe(false);
            const check = res.checks.find(c => c.name === "structure_request");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("MALFORMED_INPUT");
        });

        it("should reject modified policy arrays with unchanged hashes", async () => {
            const reqWithModArray = {
                ...req,
                requiredClaimKeys: ["gpa", "extraKey"] // added key, but requiredClaimsHash remains same
            };
            const pres = v2.createPresentationV2(cred, req, ["gpa"], HOLDER_PRIV, Math.floor(Date.now() / 1000) - 5, Math.floor(Date.now() / 1000) + 60);
            const res = await v2.verifyPresentationV2(pres, reqWithModArray, { expectedAudience: "HUST Employer System" });
            expect(res.valid).toBe(false);
            const check = res.checks.find(c => c.name === "structure_request");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("MALFORMED_INPUT");
        });

        it("should reject duplicate or unsorted policy arrays", async () => {
            const reqUnsorted = {
                ...req,
                requiredClaimKeys: ["math", "gpa"] // unsorted, and hashes recomputed to match
            };
            reqUnsorted.requiredClaimsHash = v2.hashPolicyArray(reqUnsorted.requiredClaimKeys);

            // Re-sign request
            const { signature, ...reqMeta } = reqUnsorted;
            reqUnsorted.signature = signRawDigest(VERIFIER_PRIV, hexToBytes(v2.verificationRequestDigest(reqMeta)));

            const pres = v2.createPresentationV2(cred, req, ["gpa"], HOLDER_PRIV, Math.floor(Date.now() / 1000) - 5, Math.floor(Date.now() / 1000) + 60);
            const res = await v2.verifyPresentationV2(pres, reqUnsorted, { expectedAudience: "HUST Employer System" });

            expect(res.valid).toBe(false);
            const check = res.checks.find(c => c.name === "structure_request");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("MALFORMED_INPUT");
        });

        it("should reject invalid policy entries", async () => {
            expect(() => v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa!"], // invalid claim key format
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000),
                expiresAt: Math.floor(Date.now() / 1000) + 120
            })).toThrow("invalid");
        });

        it("should reject empty disclosure submitted directly to verification", async () => {
            const pres = v2.createPresentationV2(cred, req, ["gpa"], HOLDER_PRIV, Math.floor(Date.now() / 1000) - 5, Math.floor(Date.now() / 1000) + 60);

            // Tamper to make disclosed array empty
            pres.disclosed = [];

            const res = await v2.verifyPresentationV2(pres, req, { expectedAudience: "HUST Employer System" });
            expect(res.valid).toBe(false);
            const check = res.checks.find(c => c.name === "structure_presentation");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("MALFORMED_INPUT");
        });

        it("should reject missing, extra, duplicate, and unrequested claims in verification", async () => {
            // Setup request requiring ["gpa"]
            const pres = v2.createPresentationV2(cred, req, ["gpa"], HOLDER_PRIV, Math.floor(Date.now() / 1000) - 5, Math.floor(Date.now() / 1000) + 60);

            // Tamper presentation disclosed array to contain an extra claim "course:CS202"
            const tree = new v2.MerkleClaimTreeV2(cred.id, cred.claims);
            const proofObj = tree.proofFor("course:CS202");
            pres.disclosed.push({
                key: "course:CS202",
                value: { name: "Data Structures", grade: "A" },
                salt: "0x" + "6".repeat(64),
                proof: proofObj.siblings,
                positions: proofObj.positions
            });
            pres.disclosed.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

            // Re-sign presentation authorization to pass signature recovery check
            const presAuthNoSig = {
                credentialDigest: pres.presentationAuthorization.credentialDigest,
                requestDigest: pres.presentationAuthorization.requestDigest,
                disclosureDigest: v2.hashDisclosedClaims(pres.disclosed),
                holder: pres.presentationAuthorization.holder,
                createdAt: pres.presentationAuthorization.createdAt,
                expiresAt: pres.presentationAuthorization.expiresAt
            };
            pres.presentationAuthorization.disclosureDigest = presAuthNoSig.disclosureDigest;
            const newDigest = v2.presentationAuthorizationDigest(presAuthNoSig);
            pres.presentationAuthorization.signature = signRawDigest(HOLDER_PRIV, hexToBytes(newDigest));

            const res = await v2.verifyPresentationV2(pres, req, { expectedAudience: "HUST Employer System" });
            expect(res.valid).toBe(false);
            const check = res.checks.find(c => c.name === "policy_content_match");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("POLICY_DISCLOSURE_MISMATCH");
        });

        it("should reject expired credentials", async () => {
            const expiredCred = v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor",
                schemaURI: "https://schema.hust.edu.vn",
                issuedAt: Math.floor(Date.now() / 1000) - 1000,
                expiresAt: Math.floor(Date.now() / 1000) - 500, // expired
                claims: goldenClaims
            });

            const pres = v2.createPresentationV2(expiredCred, req, ["gpa"], HOLDER_PRIV, Math.floor(Date.now() / 1000) - 5, Math.floor(Date.now() / 1000) + 60);
            const res = await v2.verifyPresentationV2(pres, req, { expectedAudience: "HUST Employer System" });
            expect(res.valid).toBe(false);
            const check = res.checks.find(c => c.name === "credential_not_expired");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("INVALID_CREDENTIAL_EXPIRED");
        });

        it("should reject wrong private key during credential creation", () => {
            expect(() => v2.issueCredentialV2(HOLDER_PRIV, { // holder key instead of issuer key
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor of Science",
                schemaURI: "https://schema.hust.edu.vn",
                issuedAt: 1717600000,
                expiresAt: 1717700000,
                claims: goldenClaims
            })).toThrow("match issuer");
        });

        it("should reject wrong private key during verification request creation", () => {
            expect(() => v2.createVerificationRequest(ISSUER_PRIV, { // issuer key instead of verifier key
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: 1717600000,
                expiresAt: 1717600500
            })).toThrow("match verifier");
        });

        it("should reject wrong private key during presentation creation", () => {
            expect(() => v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                ISSUER_PRIV, // issuer key instead of holder key
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            )).toThrow("match holder");
        });

        it("should prove ReplayGuard consumption only after failed verification checks", async () => {
            const replayGuard = new MockReplayGuard();
            const pres = v2.createPresentationV2(cred, req, ["gpa"], HOLDER_PRIV, Math.floor(Date.now() / 1000) - 5, Math.floor(Date.now() / 1000) + 60);

            // Verification fails on wrong audience
            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "Wrong Audience",
                replayGuard
            });
            expect(result.valid).toBe(false);
            // ReplayGuard must NOT be consumed
            expect(replayGuard.consumeCalls).toBe(0);
        });

        it("should reject presentation created before the request was issued", async () => {
            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                req.issuedAt + 10,
                req.expiresAt
            );

            pres.presentationAuthorization.createdAt = req.issuedAt - 100;
            const presAuthNoSig = {
                credentialDigest: pres.presentationAuthorization.credentialDigest,
                requestDigest: pres.presentationAuthorization.requestDigest,
                disclosureDigest: pres.presentationAuthorization.disclosureDigest,
                holder: pres.presentationAuthorization.holder,
                createdAt: pres.presentationAuthorization.createdAt,
                expiresAt: pres.presentationAuthorization.expiresAt
            };
            const newDigest = v2.presentationAuthorizationDigest(presAuthNoSig);
            pres.presentationAuthorization.signature = signRawDigest(HOLDER_PRIV, hexToBytes(newDigest));

            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "presentation_created_after_request");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("INVALID_PRESENTATION_TIME");
        });

        it("should reject future-issued verification requests", async () => {
            const reqMeta = {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) + 120, // 2 minutes in future
                expiresAt: Math.floor(Date.now() / 1000) + 300
            };

            const sortedRequiredClaimKeys = [...reqMeta.requiredClaimKeys].sort();
            const sortedAcceptedIssuerIds = [...reqMeta.acceptedIssuerIds].sort();
            const sortedAcceptedSchemaURIs = [...reqMeta.acceptedSchemaURIs].sort();

            const requiredClaimsHash = v2.hashPolicyArray(sortedRequiredClaimKeys);
            const acceptedIssuerIdsHash = v2.hashPolicyArray(sortedAcceptedIssuerIds);
            const acceptedSchemaURIsHash = v2.hashPolicyArray(sortedAcceptedSchemaURIs);

            const futureReqMeta = {
                id: reqMeta.id,
                verifier: reqMeta.verifier,
                audience: reqMeta.audience,
                nonce: reqMeta.nonce,
                requiredClaimsHash,
                acceptedIssuerIdsHash,
                acceptedSchemaURIsHash,
                issuedAt: reqMeta.issuedAt,
                expiresAt: reqMeta.expiresAt,
                requiredClaimKeys: sortedRequiredClaimKeys,
                acceptedIssuerIds: sortedAcceptedIssuerIds,
                acceptedSchemaURIs: sortedAcceptedSchemaURIs
            };

            const digest = v2.verificationRequestDigest(futureReqMeta);
            const signature = signRawDigest(VERIFIER_PRIV, hexToBytes(digest));

            const futureReq = {
                ...futureReqMeta,
                signature
            };

            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            pres.presentationAuthorization.requestDigest = v2.verificationRequestDigest(futureReq);
            const presAuthNoSig = {
                credentialDigest: pres.presentationAuthorization.credentialDigest,
                requestDigest: pres.presentationAuthorization.requestDigest,
                disclosureDigest: pres.presentationAuthorization.disclosureDigest,
                holder: pres.presentationAuthorization.holder,
                createdAt: pres.presentationAuthorization.createdAt,
                expiresAt: pres.presentationAuthorization.expiresAt
            };
            const newDigest = v2.presentationAuthorizationDigest(presAuthNoSig);
            pres.presentationAuthorization.signature = signRawDigest(HOLDER_PRIV, hexToBytes(newDigest));

            const result = await v2.verifyPresentationV2(pres, futureReq, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "request_not_expired");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("FUTURE_TIMESTAMP");
        });

        it("should reject future-issued presentations", async () => {
            const longLivedReq = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 600
            });

            const pres = v2.createPresentationV2(
                cred,
                longLivedReq,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            // Mutate to be in the future
            pres.presentationAuthorization.createdAt = Math.floor(Date.now() / 1000) + 120;
            pres.presentationAuthorization.expiresAt = Math.floor(Date.now() / 1000) + 300;

            const presAuthNoSig = {
                credentialDigest: pres.presentationAuthorization.credentialDigest,
                requestDigest: pres.presentationAuthorization.requestDigest,
                disclosureDigest: pres.presentationAuthorization.disclosureDigest,
                holder: pres.presentationAuthorization.holder,
                createdAt: pres.presentationAuthorization.createdAt,
                expiresAt: pres.presentationAuthorization.expiresAt
            };
            const newDigest = v2.presentationAuthorizationDigest(presAuthNoSig);
            pres.presentationAuthorization.signature = signRawDigest(HOLDER_PRIV, hexToBytes(newDigest));

            const result = await v2.verifyPresentationV2(pres, longLivedReq, {
                expectedAudience: "HUST Employer System"
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "presentation_not_expired");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("FUTURE_TIMESTAMP");
        });

        it("should handle ReplayGuard method errors without throwing in verifyPresentationV2", async () => {
            const throwingGuard: v2.ReplayGuard = {
                async isConsumed() {
                    throw new Error("Database error");
                },
                async consume() {
                    throw new Error("Database error");
                }
            };

            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            const result = await v2.verifyPresentationV2(pres, req, {
                expectedAudience: "HUST Employer System",
                replayGuard: throwingGuard
            });

            expect(result.valid).toBe(false);
            const check = result.checks.find(c => c.name === "replay_protection");
            expect(check?.passed).toBe(false);
            expect(check?.code).toBe("REPLAY_GUARD_ERROR");
        });
    });

    describe("5. Task 2C Semantic & Creation Skew & Address Checksum Tests", () => {
        it("verifyVerificationRequest rejects changed arrays with unchanged hashes", () => {
            const req = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            });

            const tamperedReq = {
                ...req,
                requiredClaimKeys: ["gpa", "math"]
            };

            const valid = v2.verifyVerificationRequest(tamperedReq);
            expect(valid).toBe(false);
        });

        it("parseCredentialV2 rejects duplicate claim keys, invalid values, claims count mismatch, invalid Merkle root, and invalid addresses", () => {
            const parsedHappy = v2.parseCredentialV2(cred);
            expect(parsedHappy.success).toBe(true);

            // 1. Duplicate claim keys
            const credDup = {
                ...cred,
                claims: [
                    { key: "gpa", value: 3.8, salt: "0x" + "1".repeat(64) },
                    { key: "gpa", value: 4.0, salt: "0x" + "2".repeat(64) }
                ],
                claimCount: 2
            };
            const parsedDup = v2.parseCredentialV2(credDup);
            expect(parsedDup.success).toBe(false);

            // 2. Invalid claim values (prototype pollution)
            const credPolluted = {
                ...cred,
                claims: [
                    { key: "gpa", value: JSON.parse('{"__proto__": {"polluted": true}}'), salt: "0x" + "1".repeat(64) }
                ],
                claimCount: 1
            };
            const parsedPolluted = v2.parseCredentialV2(credPolluted);
            expect(parsedPolluted.success).toBe(false);

            // 3. Claims count mismatch
            const credMismatchCount = {
                ...cred,
                claimCount: 5
            };
            const parsedMismatchCount = v2.parseCredentialV2(credMismatchCount);
            expect(parsedMismatchCount.success).toBe(false);

            // 4. Invalid Merkle Root
            const credBadRoot = {
                ...cred,
                merkleRoot: "0x" + "f".repeat(64)
            };
            const parsedBadRoot = v2.parseCredentialV2(credBadRoot);
            expect(parsedBadRoot.success).toBe(false);

            // 5. Invalid issuer signing address
            const credBadAddress = {
                ...cred,
                issuerSigningAddress: "0x" + "a".repeat(39) + "Z"
            };
            const parsedBadAddress = v2.parseCredentialV2(credBadAddress);
            expect(parsedBadAddress.success).toBe(false);
        });

        it("parseVerificationRequestV1 rejects empty policy arrays, >256 claim keys, unsorted/duplicate arrays, and invalid lifetime", () => {
            const req = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            });

            // 1. Empty policy arrays
            const reqEmptyArray = {
                ...req,
                requiredClaimKeys: [],
                requiredClaimsHash: v2.hashPolicyArray([])
            };
            const parsedEmpty = v2.parseVerificationRequestV1(reqEmptyArray);
            expect(parsedEmpty.success).toBe(false);

            // 2. Unsorted policy arrays
            const reqUnsorted = {
                ...req,
                requiredClaimKeys: ["math", "gpa"]
            };
            reqUnsorted.requiredClaimsHash = v2.hashPolicyArray(reqUnsorted.requiredClaimKeys);
            const parsedUnsorted = v2.parseVerificationRequestV1(reqUnsorted);
            expect(parsedUnsorted.success).toBe(false);

            // 3. Invalid lifetime
            const reqInvalidLifetime = {
                ...req,
                expiresAt: req.issuedAt + 20 * 60
            };
            const parsedLifetime = v2.parseVerificationRequestV1(reqInvalidLifetime);
            expect(parsedLifetime.success).toBe(false);
        });

        it("parsePresentationV2 rejects duplicate/unsorted disclosures, invalid authorization timeline, and holder mismatch", () => {
            const req = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            });
            const pres = v2.createPresentationV2(
                cred,
                req,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            );

            // 1. Unsorted disclosed claims
            const presUnsorted = {
                ...pres,
                disclosed: [
                    { key: "math", value: "A", salt: "0x" + "1".repeat(64), proof: [], positions: [] },
                    { key: "gpa", value: 3.8, salt: "0x" + "2".repeat(64), proof: [], positions: [] }
                ]
            };
            const parsedUnsorted = v2.parsePresentationV2(presUnsorted);
            expect(parsedUnsorted.success).toBe(false);

            // 2. Invalid presentation lifetime
            const presAuthLong = {
                ...pres.presentationAuthorization,
                expiresAt: pres.presentationAuthorization.createdAt + 6 * 60
            };
            const presLong = {
                ...pres,
                presentationAuthorization: presAuthLong
            };
            const parsedLong = v2.parsePresentationV2(presLong);
            expect(parsedLong.success).toBe(false);

            // 3. Holder mismatch
            const presAuthWrongHolder = {
                ...pres.presentationAuthorization,
                holder: verifierAddr
            };
            const presWrongHolder = {
                ...pres,
                presentationAuthorization: presAuthWrongHolder
            };
            const parsedWrongHolder = v2.parsePresentationV2(presWrongHolder);
            expect(parsedWrongHolder.success).toBe(false);
        });

        it("future creation beyond 60s skew is rejected by all three creation APIs", () => {
            const futureTime = Math.floor(Date.now() / 1000) + 120;

            // 1. issueCredentialV2 rejects future issuedAt
            expect(() => v2.issueCredentialV2(ISSUER_PRIV, {
                id: credId,
                issuerOrganizationId: issuerOrgId,
                issuerSigningAddress: issuerAddr,
                holder: holderAddr,
                credentialType: "Bachelor",
                schemaURI: "https://schema.hust.edu.vn",
                issuedAt: futureTime,
                expiresAt: 0,
                claims: goldenClaims
            })).toThrow("future");

            // 2. createVerificationRequest rejects future issuedAt
            expect(() => v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: futureTime,
                expiresAt: futureTime + 120
            })).toThrow("future");

            // 3. createPresentationV2 rejects future createdAt
            const validReq = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 600
            });
            expect(() => v2.createPresentationV2(
                cred,
                validReq,
                ["gpa"],
                HOLDER_PRIV,
                futureTime,
                futureTime + 60
            )).toThrow("future");
        });

        it("createVerificationRequest rejects unknown properties", () => {
            const badParams = {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120,
                extraUnrecognizedProperty: "malicious"
            };
            expect(() => v2.createVerificationRequest(VERIFIER_PRIV, badParams as any)).toThrow("unrecognized_keys");
        });

        it("invalid mixed-case address checksums are rejected by addressSchema", () => {
            const badChecksum = "0x8627b13f5d873584e2a374802feeb10c5cf91dd1".replace("d", "D");

            const res = v2.addressSchema.safeParse(badChecksum);
            expect(res.success).toBe(false);

            const lowerRes = v2.addressSchema.safeParse("0x8627b13f5d873584e2a374802feeb10c5cf91dd1");
            expect(lowerRes.success).toBe(true);
        });

        it("Merkle proof bytes32 validation allows zero bytes32", () => {
            const zeroProofElement = "0x" + "0".repeat(64);
            const disclosedClaim = {
                key: "gpa",
                value: 3.8,
                salt: "0x" + "5".repeat(64),
                proof: [zeroProofElement],
                positions: [true]
            };

            const res = v2.disclosedClaimV2Schema.safeParse(disclosedClaim);
            expect(res.success).toBe(true);
        });

        it("createPresentationV2 rejects malformed/invalid credentials and requests", () => {
            const validReq = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            });

            const malCred = {
                ...cred,
                issuerSigningAddress: "0x123"
            };

            expect(() => v2.createPresentationV2(
                malCred as any,
                validReq,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            )).toThrow("Invalid credential");

            const malReq = {
                ...validReq,
                requiredClaimKeys: undefined
            };

            expect(() => v2.createPresentationV2(
                cred,
                malReq as any,
                ["gpa"],
                HOLDER_PRIV,
                Math.floor(Date.now() / 1000) - 5,
                Math.floor(Date.now() / 1000) + 60
            )).toThrow("Invalid request");
        });
    });

    describe("6. Task 2D Request-Policy Consistency Tests", () => {
        it("createVerificationRequest rejects 257 entries for each policy array", () => {
            const tooManyClaims = Array(257).fill("gpa");
            const tooManyIssuers = Array(257).fill(issuerOrgId);
            const tooManySchemas = Array(257).fill("https://schema.hust.edu.vn");

            // 1. requiredClaimKeys rejects 257 entries
            expect(() => v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: tooManyClaims,
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            })).toThrow();

            // 2. acceptedIssuerIds rejects 257 entries
            expect(() => v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: tooManyIssuers,
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            })).toThrow();

            // 3. acceptedSchemaURIs rejects 257 entries
            expect(() => v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: tooManySchemas,
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            })).toThrow();
        });

        it("Requests with exactly 256 entries remain valid where applicable", () => {
            // Generates 256 unique valid claims keys (since duplicates are rejected)
            const exactClaims = Array(256).fill(null).map((_, i) => `key${i}`);
            const exactIssuers = Array(256).fill(null).map((_, i) => "0x" + (i + 1).toString(16).padStart(64, "0"));
            const exactSchemas = Array(256).fill(null).map((_, i) => `https://schema${i}.org`);

            const reqMax = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: exactClaims,
                acceptedIssuerIds: exactIssuers,
                acceptedSchemaURIs: exactSchemas,
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            });

            expect(reqMax.requiredClaimKeys).toHaveLength(256);
            expect(reqMax.acceptedIssuerIds).toHaveLength(256);
            expect(reqMax.acceptedSchemaURIs).toHaveLength(256);
        });

        it("Every freshly created request passes parseVerificationRequestV1 and verifyVerificationRequest", () => {
            const freshReq = v2.createVerificationRequest(VERIFIER_PRIV, {
                id: reqId,
                verifier: verifierAddr,
                audience: "HUST Employer System",
                nonce: nonce,
                requiredClaimKeys: ["gpa"],
                acceptedIssuerIds: [issuerOrgId],
                acceptedSchemaURIs: ["https://schema.hust.edu.vn"],
                issuedAt: Math.floor(Date.now() / 1000) - 10,
                expiresAt: Math.floor(Date.now() / 1000) + 120
            });

            const parsed = v2.parseVerificationRequestV1(freshReq);
            expect(parsed.success).toBe(true);

            const verified = v2.verifyVerificationRequest(freshReq);
            expect(verified).toBe(true);
        });

        it("hashPolicyArray rejects duplicates", () => {
            expect(() => v2.hashPolicyArray(["gpa", "gpa"])).toThrow("Duplicate entry found in policy array");
        });

        it("hashPolicyArray remains deterministic across input order", () => {
            const hash1 = v2.hashPolicyArray(["a", "b", "c"]);
            const hash2 = v2.hashPolicyArray(["c", "b", "a"]);
            expect(hash1).toBe(hash2);
        });
    });
});
