import {describe, expect, it} from "vitest";

import {
    ROLE_PORTALS,
    getPortalIndex,
    getPortalLabel,
    getPortalMeta,
    getPortalStatus
} from "../src/web/demoSteps.js";

describe("Role portals", () => {
    it("describes the six role portals", () => {
        expect(ROLE_PORTALS).toHaveLength(6);
        expect(ROLE_PORTALS.map((portal) => portal.label)).toEqual([
            "Dashboard",
            "University Portal",
            "Student Wallet",
            "Verifier Portal",
            "Blockchain Registry",
            "Technical Evidence"
        ]);
        expect(ROLE_PORTALS[5]?.advancedHiddenByDefault).toBe(true);
        expect(ROLE_PORTALS.map((portal) => portal.roleLabel)).toEqual([
            "Dashboard",
            "University",
            "Student",
            "Verifier",
            "Registry/Admin",
            "Technical reviewer"
        ]);
    });

    it("tracks active versus inactive portal state", () => {
        expect(getPortalIndex("verify")).toBe(3);
        expect(getPortalStatus("verify", "issue")).toBe("inactive");
        expect(getPortalStatus("verify", "verify")).toBe("active");
        expect(getPortalStatus("verify", "privacy")).toBe("inactive");
    });

    it("returns portal metadata with concise product labels", () => {
        const meta = getPortalMeta("issue");

        expect(meta.label).toBe("University Portal");
        expect(meta.roleLabel).toBe("University");
        expect(meta.actionLabel).toBe("Sign credential");
        expect(meta.resultLabel).toBe("Signed credential ready");
    });

    it("exposes readable portal labels", () => {
        expect(getPortalLabel("blockchain")).toBe("Blockchain Registry");
    });

    it("keeps the dashboard and registry copy role-based", () => {
        expect(getPortalMeta("overview").actionLabel).toBe("Choose role");
        expect(getPortalMeta("overview").description).toContain("actor's portal");
        expect(getPortalMeta("blockchain").actionLabel).toBe("Check registry");
    });
});
