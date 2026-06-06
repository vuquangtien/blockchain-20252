import {describe, expect, it} from "vitest";

import {
    DEMO_STEPS,
    getDemoStepIndex,
    getDemoStepProgress,
    getDemoStepStatus,
    getNextDemoStep,
    getWorkspaceMeta
} from "../src/web/demoSteps.js";

describe("Demo steps", () => {
    it("describes the guided six-step flow", () => {
        expect(DEMO_STEPS).toHaveLength(6);
        expect(DEMO_STEPS.map((step) => step.label)).toEqual([
            "Dashboard",
            "University Issuer",
            "Student Wallet",
            "Verifier Portal",
            "Blockchain Registry",
            "Evidence / Advanced"
        ]);
        expect(DEMO_STEPS[5]?.advancedHiddenByDefault).toBe(true);
        expect(DEMO_STEPS.map((step) => step.roleLabel)).toEqual([
            "Operations console",
            "University issuer",
            "Student wallet",
            "Verifier portal",
            "Blockchain registry",
            "Evidence vault"
        ]);
    });

    it("formats progress labels and completion state", () => {
        expect(getDemoStepProgress("reveal")).toBe("Workspace 3 of 6 · Student Wallet");
        expect(getDemoStepIndex("verify")).toBe(3);
        expect(getDemoStepStatus("verify", "issue")).toBe("completed");
        expect(getDemoStepStatus("verify", "verify")).toBe("current");
        expect(getDemoStepStatus("verify", "privacy")).toBe("pending");
    });

    it("advances to the next guided step", () => {
        expect(getNextDemoStep("overview")).toBe("issue");
        expect(getNextDemoStep("privacy")).toBe("privacy");
    });

    it("returns workspace metadata with concise product labels", () => {
        const meta = getWorkspaceMeta("issue");

        expect(meta.label).toBe("University Issuer");
        expect(meta.roleLabel).toBe("University issuer");
        expect(meta.actionLabel).toBe("Issue credential");
        expect(meta.resultLabel).toBe("Signed credential ready");
    });
});
