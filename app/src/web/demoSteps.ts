export const ROLE_PORTAL_IDS = [
    "overview",
    "issue",
    "reveal",
    "verify",
    "blockchain",
    "privacy"
] as const;

export type PortalId = (typeof ROLE_PORTAL_IDS)[number];

export interface RolePortalDefinition {
    id: PortalId;
    label: string;
    title: string;
    description: string;
    actionLabel: string;
    roleLabel: string;
    resultLabel: string;
    advancedHiddenByDefault?: boolean;
}

export const ROLE_PORTALS: RolePortalDefinition[] = [
    {
        id: "overview",
        label: "Dashboard",
        title: "Choose a role.",
        description: "Enter one actor's portal and run only that actor's job.",
        actionLabel: "Choose role",
        roleLabel: "Dashboard",
        resultLabel: "Transcript private by default"
    },
    {
        id: "issue",
        label: "University Portal",
        title: "Issue the credential.",
        description: "Sign the academic record once and send it to the student.",
        actionLabel: "Sign credential",
        roleLabel: "University",
        resultLabel: "Signed credential ready"
    },
    {
        id: "reveal",
        label: "Student Wallet",
        title: "Create a private proof.",
        description: "Reveal only the facts requested by the verifier.",
        actionLabel: "Create proof",
        roleLabel: "Student",
        resultLabel: "Only required facts disclosed"
    },
    {
        id: "verify",
        label: "Verifier Portal",
        title: "Verify the proof.",
        description: "Accept or reject without seeing the full transcript.",
        actionLabel: "Verify proof",
        roleLabel: "Verifier",
        resultLabel: "Decision with grouped checks"
    },
    {
        id: "blockchain",
        label: "Blockchain Registry",
        title: "Check public trust state.",
        description: "Read issuer authority, anchoring, and revocation.",
        actionLabel: "Check registry",
        roleLabel: "Registry/Admin",
        resultLabel: "Issuer and revocation state"
    },
    {
        id: "privacy",
        label: "Technical Evidence",
        title: "Inspect the evidence.",
        description: "Open hashes, signatures, Merkle paths, and registry bindings.",
        actionLabel: "Review evidence",
        roleLabel: "Technical reviewer",
        resultLabel: "Technical details hidden by default",
        advancedHiddenByDefault: true
    }
] as const;

export function getPortalIndex(portalId: PortalId): number {
    return ROLE_PORTAL_IDS.indexOf(portalId);
}

export function getPortalByIndex(index: number): RolePortalDefinition {
    return ROLE_PORTALS[Math.max(0, Math.min(ROLE_PORTALS.length - 1, index))]!;
}

export function getPortalMeta(portalId: PortalId): RolePortalDefinition {
    return ROLE_PORTALS[getPortalIndex(portalId)]!;
}

export function getPortalStatus(activePortal: PortalId, portalId: PortalId): "active" | "inactive" {
    return activePortal === portalId ? "active" : "inactive";
}

export function getPortalLabel(portalId: PortalId): string {
    return getPortalMeta(portalId).label;
}
