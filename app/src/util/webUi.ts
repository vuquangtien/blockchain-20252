import type {VerificationCheck} from "../core/v2/types.js";
import type {ClaimV2} from "../core/v2/types.js";
import {DEMO_REQUIRED_CLAIMS} from "./v2Demo.js";

export const CLAIM_LABELS: Record<string, string> = {
    "degree:field": "Degree field",
    "degree:title": "Degree title",
    gpa: "GPA",
    thesis: "Thesis",
    "course:CS431": "Course: Applied Cryptography",
    "course:CS451": "Course: Distributed Systems",
    "course:MATH302": "Course: Probability and Statistics",
    "research:lab": "Research lab"
};

export const VERIFICATION_CATEGORY_LABELS = {
    credentialIntegrity: "Credential integrity",
    studentAuthorization: "Student authorization",
    selectiveDisclosure: "Selective disclosure",
    registryStatus: "Registry compatibility"
} as const;

export type VerificationCategory = keyof typeof VERIFICATION_CATEGORY_LABELS;

const CHECK_CATEGORY_MAP: Record<string, VerificationCategory> = {
    structure_presentation: "credentialIntegrity",
    claim_values_format: "credentialIntegrity",
    credential_not_expired: "credentialIntegrity",
    issuer_signature: "credentialIntegrity",
    merkle_proofs: "credentialIntegrity",
    digest_bindings: "credentialIntegrity",
    holder_signature: "studentAuthorization",
    presentation_not_expired: "studentAuthorization",
    presentation_created_after_request: "studentAuthorization",
    presentation_not_outlive_request: "studentAuthorization",
    structure_request: "selectiveDisclosure",
    request_not_expired: "selectiveDisclosure",
    audience_match: "selectiveDisclosure",
    request_digest_match: "selectiveDisclosure",
    policy_content_match: "selectiveDisclosure",
    verifier_signature: "selectiveDisclosure",
    replay_protection: "registryStatus",
    generic_exception: "registryStatus"
};

export const DEMO_STORY_CARDS = [
    {
        role: "Student",
        title: "Holds the credential privately",
        body: "Chooses what to reveal, one proof at a time."
    },
    {
        role: "University",
        title: "Signs the record",
        body: "Issues the credential and keeps authority in the registry."
    },
    {
        role: "Verifier",
        title: "Requests only what it needs",
        body: "Checks the proof without seeing the full transcript."
    },
    {
        role: "Blockchain",
        title: "Confirms trust and revocation",
        body: "Reads registry state before accepting the proof."
    }
] as const;

export function claimLabel(key: string): string {
    return CLAIM_LABELS[key] ?? key;
}

export function formatClaimReadableValue(claim: Pick<ClaimV2, "key" | "value">): string {
    switch (claim.key) {
        case "degree:field": {
            const value = claim.value as {discipline?: string; level?: string};
            return `${value.discipline ?? "Computer Science"}, ${value.level ?? "Bachelor of Engineering"}`;
        }
        case "degree:title":
            return String(claim.value);
        case "gpa": {
            const value = claim.value as {value?: number; scale?: number; honors?: string};
            return `${value.value ?? "—"} / ${value.scale ?? 4}${value.honors ? ` (${value.honors})` : ""}`;
        }
        case "thesis": {
            const value = claim.value as {title?: string; grade?: string};
            return value.title ?? String(claim.value);
        }
        case "course:CS431":
        case "course:CS451":
        case "course:MATH302": {
            const value = claim.value as {name?: string; grade?: string};
            return `${value.name ?? claim.key} (${value.grade ?? "—"})`;
        }
        case "research:lab": {
            const value = claim.value as {lab?: string};
            return value.lab ?? String(claim.value);
        }
        default:
            return typeof claim.value === "string" ? claim.value : JSON.stringify(claim.value);
    }
}

export function formatRevealedSummary(keys: readonly string[]): string {
    return keys.map((key) => claimLabel(key).toLowerCase()).join(", ");
}

export function formatHiddenSummary(hiddenCount: number): string {
    return `${hiddenCount} transcript detail${hiddenCount === 1 ? "" : "s"}`;
}

export function categorizeVerificationCheck(check: VerificationCheck): VerificationCategory {
    return CHECK_CATEGORY_MAP[check.name] ?? "credentialIntegrity";
}

export interface VerificationCategoryGroup {
    category: VerificationCategory;
    label: string;
    checks: VerificationCheck[];
    passed: boolean;
}

export function groupVerificationChecks(checks: VerificationCheck[]): VerificationCategoryGroup[] {
    const order: VerificationCategory[] = [
        "credentialIntegrity",
        "studentAuthorization",
        "selectiveDisclosure",
        "registryStatus"
    ];

    const buckets = new Map<VerificationCategory, VerificationCheck[]>();
    for (const category of order) buckets.set(category, []);

    for (const check of checks) {
        const category = categorizeVerificationCheck(check);
        buckets.get(category)?.push(check);
    }

    return order
        .map((category) => {
            const grouped = buckets.get(category) ?? [];
            return {
                category,
                label: VERIFICATION_CATEGORY_LABELS[category],
                checks: grouped,
                passed: grouped.length > 0 && grouped.every((check) => check.passed)
            };
        })
        .filter((group) => group.checks.length > 0);
}

export function requiredClaimLabels(): string[] {
    return DEMO_REQUIRED_CLAIMS.map((key) => claimLabel(key));
}
