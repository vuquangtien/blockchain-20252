export const DEMO_STEP_IDS = [
    "overview",
    "issue",
    "reveal",
    "verify",
    "blockchain",
    "privacy"
] as const;

export type DemoStepId = (typeof DEMO_STEP_IDS)[number];

export interface DemoStepDefinition {
    id: DemoStepId;
    label: string;
    title: string;
    description: string;
    actionLabel: string;
    roleLabel: string;
    resultLabel: string;
    advancedHiddenByDefault?: boolean;
}

export const DEMO_STEPS: DemoStepDefinition[] = [
    {
        id: "overview",
        label: "Dashboard",
        title: "Operations console for issuing, sharing, verifying, and registry checks.",
        description: "Pick one workspace to continue the credential flow.",
        actionLabel: "Issue credential",
        roleLabel: "Operations console",
        resultLabel: "One clear action per workspace"
    },
    {
        id: "issue",
        label: "University Issuer",
        title: "University creates and signs a credential.",
        description: "Issue a signed record the student can hold.",
        actionLabel: "Issue credential",
        roleLabel: "University issuer",
        resultLabel: "Signed credential ready"
    },
    {
        id: "reveal",
        label: "Student Wallet",
        title: "Student chooses what to reveal from the wallet.",
        description: "Share only the facts the verifier asked for.",
        actionLabel: "Share proof",
        roleLabel: "Student wallet",
        resultLabel: "Revealed facts only"
    },
    {
        id: "verify",
        label: "Verifier Portal",
        title: "Verifier checks the submitted proof against the request.",
        description: "Accepted or rejected appears with grouped checks.",
        actionLabel: "Verify proof",
        roleLabel: "Verifier portal",
        resultLabel: "Proof verdict"
    },
    {
        id: "blockchain",
        label: "Blockchain Registry",
        title: "Registry confirms issuer authority and revocation state.",
        description: "Refresh live chain status on demand.",
        actionLabel: "Check registry",
        roleLabel: "Blockchain registry",
        resultLabel: "Live chain status"
    },
    {
        id: "privacy",
        label: "Evidence / Advanced",
        title: "Technical evidence, signatures, and proof material for grading.",
        description: "Advanced details stay collapsed until opened.",
        actionLabel: "View evidence",
        roleLabel: "Evidence vault",
        resultLabel: "Hashes, proofs, and checks",
        advancedHiddenByDefault: true
    }
] as const;

export function getDemoStepIndex(stepId: DemoStepId): number {
    return DEMO_STEP_IDS.indexOf(stepId);
}

export function getDemoStepByIndex(index: number): DemoStepDefinition {
    return DEMO_STEPS[Math.max(0, Math.min(DEMO_STEPS.length - 1, index))]!;
}

export function getWorkspaceMeta(stepId: DemoStepId): DemoStepDefinition {
    return DEMO_STEPS[getDemoStepIndex(stepId)]!;
}

export function getDemoStepProgress(stepId: DemoStepId): string {
    const index = getDemoStepIndex(stepId);
    return `Workspace ${index + 1} of ${DEMO_STEPS.length} · ${getDemoStepByIndex(index).label}`;
}

export function getDemoStepStatus(activeStep: DemoStepId, stepId: DemoStepId): "completed" | "current" | "pending" {
    const activeIndex = getDemoStepIndex(activeStep);
    const stepIndex = getDemoStepIndex(stepId);

    if (stepIndex < activeIndex) return "completed";
    if (stepIndex === activeIndex) return "current";
    return "pending";
}

export function getNextDemoStep(stepId: DemoStepId): DemoStepId {
    const nextIndex = getDemoStepIndex(stepId) + 1;
    return getDemoStepByIndex(nextIndex).id;
}
