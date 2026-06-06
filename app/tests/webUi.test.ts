import {describe, expect, it} from "vitest";

import type {VerificationCheck} from "../src/core/v2/types.js";
import {
    claimLabel,
    formatClaimReadableValue,
    formatHiddenSummary,
    formatRevealedSummary,
    groupVerificationChecks,
    requiredClaimLabels
} from "../src/util/webUi.js";

describe("Web UI helpers", () => {
    it("maps claim keys to human-readable labels", () => {
        expect(claimLabel("degree:field")).toBe("Degree field");
        expect(claimLabel("gpa")).toBe("GPA");
        expect(claimLabel("unknown:key")).toBe("unknown:key");
    });

    it("formats claim values for readable display", () => {
        expect(
            formatClaimReadableValue({
                key: "gpa",
                value: {value: 3.72, scale: 4, honors: "Very Good"}
            })
        ).toBe("3.72 / 4 (Very Good)");

        expect(
            formatClaimReadableValue({
                key: "thesis",
                value: {title: "Selective Disclosure Proof Systems for Academic Credentials", grade: "A"}
            })
        ).toBe("Selective Disclosure Proof Systems for Academic Credentials");
    });

    it("builds plain-language disclosure summaries", () => {
        expect(formatRevealedSummary(["degree:field", "gpa", "thesis"])).toBe(
            "degree field, gpa, thesis"
        );
        expect(formatHiddenSummary(5)).toBe("5 transcript details");
        expect(formatHiddenSummary(1)).toBe("1 transcript detail");
    });

    it("lists required claim labels for the verifier policy", () => {
        expect(requiredClaimLabels()).toEqual(["Degree field", "GPA", "Thesis"]);
    });

    it("groups verification checks into four human categories", () => {
        const checks: VerificationCheck[] = [
            {name: "issuer_signature", passed: true, code: "OK"},
            {name: "holder_signature", passed: true, code: "OK"},
            {name: "policy_content_match", passed: true, code: "OK"},
            {name: "replay_protection", passed: true, code: "OK"}
        ];

        const groups = groupVerificationChecks(checks);

        expect(groups).toHaveLength(4);
        expect(groups.map((group) => group.label)).toEqual([
            "Credential integrity",
            "Student authorization",
            "Selective disclosure",
            "Registry status"
        ]);
        expect(groups.every((group) => group.passed)).toBe(true);
    });
});
