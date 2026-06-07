import {describe, expect, it} from "vitest";

import {getActionLabel, planAction} from "../src/web/actionFlow.js";

describe("Action flow", () => {
    it("maps portal actions to product-facing labels", () => {
        expect(getActionLabel("open-university")).toBe("Enter University Portal");
        expect(getActionLabel("open-student")).toBe("Send to Student Wallet");
        expect(getActionLabel("open-verifier")).toBe("Send to Verifier Portal");
        expect(getActionLabel("open-technical")).toBe("Open Technical Evidence");
        expect(getActionLabel("issue")).toBe("Sign credential");
        expect(getActionLabel("reveal")).toBe("Create proof");
        expect(getActionLabel("refresh-chain")).toBe("Refresh blockchain status");
        expect(getActionLabel("open-registry")).toBe("Check Blockchain Registry");
    });

    it("routes blockchain transaction actions without jumping to technical evidence", () => {
        expect(planAction("anchor", true).nextPortal).toBeUndefined();
        expect(planAction("anchor", true).chainAction).toBe("anchor");
        expect(planAction("revoke", true).nextPortal).toBeUndefined();
        expect(planAction("suspend", true).nextPortal).toBeUndefined();
        expect(planAction("register-org", true).nextPortal).toBeUndefined();
        expect(planAction("register-org", true).chainAction).toBe("register-org");
    });

    it("opens each role portal from the dashboard", () => {
        expect(planAction("open-university", true).nextPortal).toBe("issue");
        expect(planAction("open-student", true).nextPortal).toBe("reveal");
        expect(planAction("open-verifier", true).nextPortal).toBe("verify");
        expect(planAction("open-registry", true).nextPortal).toBe("blockchain");
        expect(planAction("open-technical", true).nextPortal).toBe("privacy");
    });

    it("keeps refresh-chain and check-chain as chain-executing refresh actions even with notices", () => {
        const refreshPlan = planAction("refresh-chain", true);
        const checkPlan = planAction("check-chain", true);

        expect(refreshPlan.chainAction).toBe("refresh-chain");
        expect(refreshPlan.noticeText).toBe("Blockchain status refreshed.");
        expect(refreshPlan.nextPortal).toBeUndefined();
        expect(checkPlan.chainAction).toBe("refresh-chain");
        expect(checkPlan.noticeText).toBe("Blockchain status refreshed.");
        expect(checkPlan.nextPortal).toBeUndefined();
    });

    it("keeps set-up-chain on the non-chain portal path", () => {
        const plan = planAction("set-up-chain", true);

        expect(plan.chainAction).toBeUndefined();
        expect(plan.nextPortal).toBe("blockchain");
        expect(plan.openAdvancedChain).toBe(true);
        expect(plan.noticeText).toContain("Open advanced setup");
    });

    it("keeps the main portal actions inside the current portal", () => {
        expect(planAction("issue", true).nextPortal).toBeUndefined();
        expect(planAction("reveal", true).nextPortal).toBeUndefined();
        expect(planAction("verify", true).nextPortal).toBeUndefined();
        expect(planAction("issue", true).rerunVerification).toBeUndefined();
        expect(planAction("reveal", true).rerunVerification).toBeUndefined();
        expect(planAction("reveal", true).noticeText).toContain("student wallet");
    });

    it("returns to the dashboard without a chain action", () => {
        const plan = planAction("restart-demo", true);

        expect(plan.nextPortal).toBe("overview");
        expect(plan.chainAction).toBeUndefined();
        expect(plan.refreshScenario).toBe(true);
    });
});
