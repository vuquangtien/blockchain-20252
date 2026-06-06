import {describe, expect, it} from "vitest";

import {getActionLabel, planAction} from "../src/web/actionFlow.js";

describe("Action flow", () => {
    it("maps guided actions to product-facing labels", () => {
        expect(getActionLabel("start-demo")).toBe("Issue credential");
        expect(getActionLabel("refresh-chain")).toBe("Check registry");
        expect(getActionLabel("continue-to-privacy")).toBe("View evidence");
    });

    it("routes blockchain transaction actions without jumping to privacy", () => {
        expect(planAction("anchor", true).nextStep).toBeUndefined();
        expect(planAction("anchor", true).chainAction).toBe("anchor");
        expect(planAction("revoke", true).nextStep).toBeUndefined();
        expect(planAction("suspend", true).nextStep).toBeUndefined();
        expect(planAction("register-org", true).nextStep).toBeUndefined();
        expect(planAction("register-org", true).chainAction).toBe("register-org");
    });

    it("keeps refresh-chain and check-chain as chain-executing refresh actions even with notices", () => {
        const refreshPlan = planAction("refresh-chain", true);
        const checkPlan = planAction("check-chain", true);

        expect(refreshPlan.chainAction).toBe("refresh-chain");
        expect(refreshPlan.noticeText).toBe("Blockchain status refreshed.");
        expect(refreshPlan.nextStep).toBeUndefined();
        expect(checkPlan.chainAction).toBe("refresh-chain");
        expect(checkPlan.noticeText).toBe("Blockchain status refreshed.");
        expect(checkPlan.nextStep).toBeUndefined();
    });

    it("keeps set-up-chain on the non-chain guided path", () => {
        const plan = planAction("set-up-chain", true);

        expect(plan.chainAction).toBeUndefined();
        expect(plan.nextStep).toBe("blockchain");
        expect(plan.openAdvancedChain).toBe(true);
        expect(plan.noticeText).toContain("Open advanced setup");
    });

    it("supports explicit continuation to privacy", () => {
        expect(planAction("continue-to-privacy", true).nextStep).toBe("privacy");
    });

    it("restarts the demo from the overview without a chain action", () => {
        const plan = planAction("restart-demo", true);

        expect(plan.nextStep).toBe("overview");
        expect(plan.chainAction).toBeUndefined();
        expect(plan.refreshScenario).toBe(true);
    });
});
