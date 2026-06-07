import type {PortalId} from "./demoSteps.js";

export type ChainActionName = "refresh-chain" | "register-org" | "anchor" | "revoke" | "suspend";

export interface ActionPlan {
    nextPortal?: PortalId;
    chainAction?: ChainActionName;
    openAdvancedChain?: boolean;
    rerunVerification?: boolean;
    resetClaimsToRequired?: boolean;
    refreshScenario?: boolean;
    refreshTimestamps?: boolean;
    noticeKind?: "ok" | "warn" | "bad";
    noticeText?: string;
    requiresChainConfiguration?: boolean;
}

export function getActionLabel(action: string): string {
    switch (action) {
        case "open-university":
            return "Enter University Portal";
        case "open-student":
            return "Send to Student Wallet";
        case "open-verifier":
            return "Send to Verifier Portal";
        case "open-registry":
            return "Check Blockchain Registry";
        case "open-technical":
            return "Open Technical Evidence";
        case "issue":
            return "Sign credential";
        case "reveal":
            return "Create proof";
        case "verify":
            return "Verify proof";
        case "refresh-chain":
            return "Refresh blockchain status";
        case "check-chain":
            return "Check registry";
        case "set-up-chain":
            return "Open advanced setup";
        case "register-org":
            return "Register organization";
        case "anchor":
            return "Anchor credential";
        case "revoke":
            return "Revoke credential";
        case "suspend":
            return "Suspend issuer";
        case "restart-demo":
            return "Back to Dashboard";
        default:
            return action;
    }
}

export function planAction(action: string, chainConfigured: boolean): ActionPlan {
    switch (action) {
        case "open-university":
            return {
                nextPortal: "issue"
            };
        case "open-student":
            return {
                nextPortal: "reveal"
            };
        case "open-verifier":
            return {
                nextPortal: "verify"
            };
        case "open-registry":
            return {
                nextPortal: "blockchain"
            };
        case "open-technical":
            return {
                nextPortal: "privacy"
            };
        case "restart-demo":
            return {
                nextPortal: "overview",
                refreshScenario: true,
                refreshTimestamps: true,
                noticeKind: "ok",
                noticeText: "Returned to the dashboard."
            };
        case "issue":
            return {
                refreshScenario: true,
                refreshTimestamps: true,
                noticeKind: "ok",
                noticeText: "Credential signed. Send it to the student wallet when ready."
            };
        case "reveal":
            return {
                noticeKind: "ok",
                noticeText: "Proof created. Hidden transcript facts stay inside the student wallet."
            };
        case "verify":
            return {
                rerunVerification: true
            };
        case "set-up-chain":
            return {
                nextPortal: "blockchain",
                openAdvancedChain: true,
                noticeKind: "ok",
                noticeText: "Open advanced setup to enter the RPC URL and contract addresses."
            };
        case "refresh-chain":
        case "check-chain":
            return {
                chainAction: "refresh-chain",
                requiresChainConfiguration: true,
                noticeKind: "ok",
                noticeText: "Blockchain status refreshed."
            };
        case "register-org":
        case "anchor":
        case "revoke":
        case "suspend":
            return {
                chainAction: action,
                requiresChainConfiguration: true
            };
        default:
            return {};
    }
}
