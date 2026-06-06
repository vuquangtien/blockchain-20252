import {describe, expect, it} from "vitest";

import {
    DEMO_ROLE_COPY,
    DEMO_REQUIRED_CLAIMS,
    createDemoScenario,
    derivePolicyState,
    summarizeClaimValue
} from "../src/util/v2Demo.js";

describe("V2 Demo Helper", () => {
    it("derives an exact-match policy state for the required verifier claims", () => {
        const policy = derivePolicyState(DEMO_REQUIRED_CLAIMS);

        expect(policy.exactMatch).toBe(true);
        expect(policy.selectedClaimKeys).toEqual([...DEMO_REQUIRED_CLAIMS]);
        expect(policy.disclosedCount).toBe(3);
        expect(policy.hiddenCount).toBe(5);
        expect(policy.missingClaimKeys).toEqual([]);
        expect(policy.extraClaimKeys).toEqual([]);
    });

    it("surfaces missing and extra claims when disclosure drifts from policy", () => {
        const policy = derivePolicyState(["degree:field", "gpa", "course:CS431"]);

        expect(policy.exactMatch).toBe(false);
        expect(policy.missingClaimKeys).toEqual(["thesis"]);
        expect(policy.extraClaimKeys).toEqual(["course:CS431"]);
        expect(policy.hiddenClaimKeys).toContain("thesis");
    });

    it("creates a verifiable deterministic demo scenario when policy matches", () => {
        const scenario = createDemoScenario(DEMO_REQUIRED_CLAIMS, 1_717_600_120);

        expect(scenario.presentation).not.toBeNull();
        expect(scenario.presentationError).toBeUndefined();
        expect(scenario.presentation?.disclosed.map((claim) => claim.key)).toEqual([
            "degree:field",
            "gpa",
            "thesis"
        ]);
        expect(scenario.credential.claimCount).toBe(8);
        expect(scenario.anchorKey).toMatch(/^0x[0-9a-f]{64}$/);
        expect(scenario.holderCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("refuses to build a presentation when disclosure does not exactly match the request", () => {
        const scenario = createDemoScenario(["degree:field", "gpa"], 1_717_600_120);

        expect(scenario.presentation).toBeNull();
        expect(scenario.presentationError).toContain("Selective disclosure must exactly match");
    });

    it("summarizes structured claim values for compact UI rendering", () => {
        expect(summarizeClaimValue("Bachelor of Engineering")).toBe("Bachelor of Engineering");
        expect(summarizeClaimValue(3.72)).toBe("3.72");
        expect(summarizeClaimValue({grade: "A"})).toBe('{"grade":"A"}');
    });

    it("describes suspension as an admin or registry-owner action", () => {
        expect(DEMO_ROLE_COPY.suspendOrganization).toContain("Admin or registry owner");
        expect(DEMO_ROLE_COPY.suspendOrganization).not.toContain("controller");
        expect(DEMO_ROLE_COPY.anchorCredential).toContain("Issuer signing key");
    });
});
