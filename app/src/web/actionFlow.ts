import type {DemoStepId} from "./demoSteps.js";

export type ChainActionName = "refresh-chain" | "register-org" | "anchor" | "revoke" | "suspend";

export interface ActionPlan {
    nextStep?: DemoStepId;
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
        case "start-demo":
        case "issue":
            return "Issue credential";
        case "reveal":
            return "Share proof";
        case "verify":
            return "Verify proof";
        case "refresh-chain":
        case "check-chain":
            return "Check registry";
        case "set-up-chain":
            return "Open advanced setup";
        case "continue-to-privacy":
            return "View evidence";
        case "register-org":
            return "Register organization";
        case "anchor":
            return "Anchor credential";
        case "revoke":
            return "Revoke credential";
        case "suspend":
            return "Suspend issuer";
        case "restart-demo":
            return "Open dashboard";
        default:
            return action;
    }
}

export function planAction(action: string, chainConfigured: boolean): ActionPlan {
    switch (action) {
        case "restart-demo":
            return {
                nextStep: "overview",
                refreshScenario: true,
                refreshTimestamps: true,
                noticeKind: "ok",
                noticeText: "Returned to the dashboard."
            };
        case "start-demo":
            return {
                nextStep: "issue"
            };
        case "issue":
            return {
                nextStep: "reveal",
                refreshScenario: true,
                refreshTimestamps: true,
                rerunVerification: true,
                noticeKind: "ok",
                noticeText: "A fresh credential was issued with updated timestamps."
            };
        case "reveal":
        case "match-policy":
            return {
                nextStep: "verify",
                resetClaimsToRequired: true,
                rerunVerification: true,
                noticeKind: "ok",
                noticeText: "The wallet is ready to share the requested facts."
            };
        case "verify":
            return {
                nextStep: "blockchain",
                rerunVerification: true
            };
        case "continue-to-privacy":
            return {
                nextStep: "privacy"
            };
        case "set-up-chain":
            return {
                nextStep: "blockchain",
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
