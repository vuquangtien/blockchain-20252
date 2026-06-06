import "./styles.css";

import {id} from "ethers";

import {keyPairFromPrivateKey} from "../core/ecc.js";
import type {Hex} from "../core/hash.js";
import {
    verifyPresentationV2,
    type VerificationResultV2
} from "../core/v2/protocol.js";
import type {AnchorComparisonResult, AnchorStatusNameV2} from "../chain/v2/types.js";
import {ChainClientV2, compareAnchorToCredentialV2} from "../chain/v2/index.js";
import {
    DEMO_AUDIENCE,
    DEMO_IDENTITIES,
    DEMO_ORGANIZATION,
    DEMO_PRIVATE_KEYS,
    DEMO_REQUIRED_CLAIMS,
    DEMO_ROLE_COPY,
    createDemoScenario,
    summarizeClaimValue,
    type DemoScenario
} from "../util/v2Demo.js";
import {
    claimLabel,
    DEMO_STORY_CARDS,
    formatClaimReadableValue,
    formatHiddenSummary,
    formatRevealedSummary,
    groupVerificationChecks,
    requiredClaimLabels
} from "../util/webUi.js";

interface ChainInputs {
    rpcUrl: string;
    issuerRegistryV2: string;
    credentialRegistryV2: string;
}

interface ChainSnapshot {
    organizationRegistered: boolean;
    organizationActive?: boolean;
    organizationName?: string;
    organizationEpoch?: number;
    status?: AnchorStatusNameV2;
    isRevoked?: boolean;
    nextRevocationIndex?: number;
    revocationWordIndex?: bigint;
    revocationWordValue?: bigint;
    anchorExists?: boolean;
    anchorComparison?: AnchorComparisonResult;
    anchorRevocationIndex?: bigint;
    error?: string;
    txHash?: string;
    updatedAt: number;
}

interface AppNotice {
    kind: "ok" | "warn" | "bad";
    text: string;
}

interface UiToggles {
    showHeroTechnical: boolean;
    showCredentialDetails: boolean;
    showRawClaims: boolean;
    showAdvancedVerification: boolean;
    showMerkleInternals: boolean;
    showAdvancedChain: boolean;
}

interface AppState {
    selectedClaims: Set<string>;
    scenario: DemoScenario;
    verification?: VerificationResultV2;
    verificationRan: boolean;
    chainInputs: ChainInputs;
    chainSnapshot?: ChainSnapshot;
    busyAction?: string;
    busyLabel?: string;
    notice?: AppNotice;
    proofFocusKey?: string;
    toggles: UiToggles;
}

const CHAIN_STORAGE_KEY = "credential-dapp-v2-chain";
const storedChain = JSON.parse(localStorage.getItem(CHAIN_STORAGE_KEY) ?? "{}") as Partial<ChainInputs>;

const state: AppState = {
    selectedClaims: new Set(DEMO_REQUIRED_CLAIMS),
    scenario: createDemoScenario(DEMO_REQUIRED_CLAIMS),
    verificationRan: false,
    chainInputs: {
        rpcUrl: storedChain.rpcUrl ?? "http://127.0.0.1:8545",
        issuerRegistryV2: storedChain.issuerRegistryV2 ?? "",
        credentialRegistryV2: storedChain.credentialRegistryV2 ?? ""
    },
    proofFocusKey: DEMO_REQUIRED_CLAIMS[0],
    toggles: {
        showHeroTechnical: false,
        showCredentialDetails: false,
        showRawClaims: false,
        showAdvancedVerification: false,
        showMerkleInternals: false,
        showAdvancedChain: false
    }
};

void primeDemo();

async function primeDemo(): Promise<void> {
    await runVerification();
    render();
}

function synchronizeScenario(refreshTimestamps = false): void {
    state.scenario = createDemoScenario(
        [...state.selectedClaims],
        refreshTimestamps ? Math.floor(Date.now() / 1000) : state.scenario.credential.issuedAt + 120
    );

    if (
        !state.proofFocusKey
        || !state.scenario.presentation?.disclosed.some((claim) => claim.key === state.proofFocusKey)
    ) {
        state.proofFocusKey = state.scenario.presentation?.disclosed[0]?.key
            ?? state.scenario.credential.claims[0]?.key;
    }

    state.verification = undefined;
    state.verificationRan = false;
    state.chainSnapshot = undefined;
}

function short(value: string, head = 14, tail = 8): string {
    return value.length <= head + tail ? value : `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function escapeHtml(value: unknown): string {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatTimestamp(timestamp: number): string {
    if (timestamp === 0) return "No expiry";
    return new Date(timestamp * 1000).toLocaleString("en-GB", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short"
    });
}

function formatSignature(signature: string): string {
    return `${signature.slice(0, 22)}...${signature.slice(-18)}`;
}

function formatWord(value?: bigint): string {
    if (value === undefined) return "Unavailable";
    return `0x${value.toString(16).padStart(64, "0")}`;
}

function formatStatus(status?: AnchorStatusNameV2): string {
    return status ?? "Awaiting registry read";
}

function setBusy(action?: string, label?: string): void {
    state.busyAction = action;
    state.busyLabel = label;
    render();
}

function setNotice(kind: AppNotice["kind"], text: string): void {
    state.notice = {kind, text};
}

function saveChainInputs(): void {
    localStorage.setItem(CHAIN_STORAGE_KEY, JSON.stringify(state.chainInputs));
}

function isChainConfigured(): boolean {
    return Boolean(
        state.chainInputs.rpcUrl
        && state.chainInputs.issuerRegistryV2
        && state.chainInputs.credentialRegistryV2
    );
}

function ensureChainConfigured(): void {
    if (!isChainConfigured()) {
        throw new Error("Enter the V2 IssuerRegistry and CredentialRegistry addresses to use the live registry panel.");
    }
}

function readClient(): ChainClientV2 {
    return new ChainClientV2({...state.chainInputs});
}

function writeClient(privateKey: Hex): ChainClientV2 {
    return ChainClientV2.withWallet({...state.chainInputs}, privateKey);
}

async function runVerification(): Promise<void> {
    if (!state.scenario.presentation) {
        state.verification = undefined;
        state.verificationRan = false;
        return;
    }

    state.verification = await verifyPresentationV2(
        state.scenario.presentation,
        state.scenario.request,
        {
            expectedAudience: DEMO_AUDIENCE,
            expectedRequestDigest: state.scenario.requestDigest
        }
    );
    state.verificationRan = true;
}

async function refreshChainSnapshot(txHash?: string): Promise<void> {
    ensureChainConfigured();

    const client = readClient();
    const organizationId = state.scenario.credential.issuerOrganizationId as Hex;
    const signer = state.scenario.credential.issuerSigningAddress as `0x${string}`;
    const credentialId = state.scenario.credential.id as Hex;

    const snapshot: ChainSnapshot = {
        organizationRegistered: false,
        updatedAt: Math.floor(Date.now() / 1000),
        txHash
    };

    try {
        try {
            const organization = await client.getOrganization(organizationId);
            snapshot.organizationRegistered = true;
            snapshot.organizationName = organization.name;
            snapshot.organizationActive = organization.active;
            snapshot.organizationEpoch = organization.currentEpoch;
        } catch {
            snapshot.organizationRegistered = false;
        }

        snapshot.status = await client.statusOf(organizationId, signer, credentialId);
        snapshot.isRevoked = await client.isRevoked(organizationId, signer, credentialId);
        snapshot.nextRevocationIndex = await client.nextRevocationIndex(organizationId);
        snapshot.revocationWordIndex = snapshot.nextRevocationIndex > 0
            ? BigInt(Math.floor((snapshot.nextRevocationIndex - 1) / 256))
            : 0n;
        snapshot.revocationWordValue = await client.revocationWord(
            organizationId,
            snapshot.revocationWordIndex
        );

        if (snapshot.status !== "Unknown") {
            const anchor = await client.getAnchor(organizationId, signer, credentialId);
            snapshot.anchorExists = anchor.exists;
            snapshot.anchorRevocationIndex = anchor.revocationIndex;
            if (anchor.exists) {
                snapshot.anchorComparison = compareAnchorToCredentialV2(
                    anchor,
                    state.scenario.credential
                );
            }
        } else {
            snapshot.anchorExists = false;
        }
    } catch (error) {
        snapshot.error = (error as Error).message;
    }

    state.chainSnapshot = snapshot;
}

function buttonLabel(action: string): string {
    const labels: Record<string, string> = {
        issue: "Issue credential",
        "match-policy": "Reveal required facts",
        verify: "Verify proof",
        "refresh-chain": "Refresh blockchain status",
        "register-org": "Register organization",
        anchor: "Anchor credential",
        revoke: "Revoke credential",
        suspend: "Suspend issuer"
    };
    return labels[action] ?? action;
}

function renderToggle(
    key: keyof UiToggles,
    label: string,
    options: {expanded?: boolean} = {}
): string {
    const expanded = options.expanded ?? state.toggles[key];
    return `
        <button
            type="button"
            class="ui-toggle"
            data-toggle="${key}"
            aria-expanded="${expanded ? "true" : "false"}"
        >
            ${escapeHtml(label)}
        </button>
    `;
}

function isBusy(action: string): boolean {
    return state.busyAction === action;
}

function renderButton(
    action: string,
    options: {variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean} = {}
): string {
    const variant = options.variant ?? "secondary";
    const disabled = options.disabled || Boolean(state.busyAction);
    const loading = isBusy(action);

    return `
        <button
            type="button"
            class="ui-button ${variant}"
            data-action="${action}"
            ${disabled ? "disabled" : ""}
            aria-busy="${loading ? "true" : "false"}"
        >
            <span class="button-face">${escapeHtml(loading ? `${buttonLabel(action)}...` : buttonLabel(action))}</span>
        </button>
    `;
}

function renderVerificationSummary(): string {
    if (!state.scenario.presentation) {
        return `
            <div class="empty-state">
                <strong>Cannot verify yet</strong>
                <p>${escapeHtml(state.scenario.presentationError ?? "Reveal exactly the three facts the verifier asked for, then run verification.")}</p>
            </div>
        `;
    }

    if (!state.verificationRan || !state.verification) {
        return `
            <div class="empty-state">
                <strong>Ready to verify</strong>
                <p>The student has revealed only the required facts. Click Verify proof to confirm everything checks out.</p>
            </div>
        `;
    }

    const verdictClass = state.verification.valid ? "good" : "bad";
    const groups = groupVerificationChecks(state.verification.checks);

    return `
        <div class="verification-board ${verdictClass}">
            <div class="verification-verdict">
                <span>Result</span>
                <strong>${state.verification.valid ? "Verification passed" : "Verification failed"}</strong>
                <p class="verdict-summary">
                    ${state.verification.valid
                        ? "The proof is valid, the issuer signature is trusted, and hidden transcript data was not revealed."
                        : "One or more checks failed. Open the advanced verification log to see which step did not pass."}
                </p>
            </div>
            <div class="category-list">
                ${groups
                    .map(
                        (group) => `
                            <article class="category-row ${group.passed ? "pass" : "fail"}">
                                <div>
                                    <h4>${escapeHtml(group.label)}</h4>
                                    <p>${group.checks.length} check${group.checks.length === 1 ? "" : "s"}</p>
                                </div>
                                <span>${group.passed ? "Passed" : "Failed"}</span>
                            </article>
                        `
                    )
                    .join("")}
            </div>
            <div class="toggle-row">
                ${renderToggle("showAdvancedVerification", "Advanced verification log")}
            </div>
            ${state.toggles.showAdvancedVerification ? `
                <div class="check-list advanced-check-list">
                    ${state.verification.checks
                        .map(
                            (check) => `
                                <article class="check-row ${check.passed ? "pass" : "fail"}">
                                    <div>
                                        <h4>${escapeHtml(check.name)}</h4>
                                        <p>${escapeHtml(check.code)}${check.detail ? ` | ${escapeHtml(check.detail)}` : ""}</p>
                                    </div>
                                    <span>${check.passed ? "PASS" : "FAIL"}</span>
                                </article>
                            `
                        )
                        .join("")}
                </div>
            ` : ""}
        </div>
    `;
}

function renderProofPanel(): string {
    const focus = state.scenario.presentation?.disclosed.find((claim) => claim.key === state.proofFocusKey)
        ?? state.scenario.presentation?.disclosed[0];

    if (!state.scenario.presentation || !focus) {
        return `
            <div class="empty-state">
                <strong>Proof not available yet</strong>
                <p>Reveal exactly the three required facts first. The student can then prove each one without exposing the rest of the transcript.</p>
            </div>
        `;
    }

    return `
        <div class="proof-shell">
            <p class="proof-intro">
                Each revealed fact is linked to the full credential through a Merkle tree.
                The verifier can confirm the fact is authentic without seeing hidden transcript rows.
            </p>
            <div class="proof-tabs">
                ${state.scenario.presentation.disclosed
                    .map(
                        (claim) => `
                            <button
                                type="button"
                                class="proof-chip ${claim.key === focus.key ? "active" : ""}"
                                data-proof-key="${claim.key}"
                            >
                                ${escapeHtml(claimLabel(claim.key))}
                            </button>
                        `
                    )
                    .join("")}
            </div>
            <div class="proof-head">
                <div>
                    <span>Revealed fact</span>
                    <strong>${escapeHtml(claimLabel(focus.key))}</strong>
                </div>
                <div>
                    <span>Readable value</span>
                    <strong>${escapeHtml(formatClaimReadableValue(focus))}</strong>
                </div>
            </div>
            <div class="toggle-row">
                ${renderToggle("showMerkleInternals", "Show Merkle proof internals")}
            </div>
            ${state.toggles.showMerkleInternals ? `
                <div class="proof-head proof-head-technical">
                    <div>
                        <span>Proof depth</span>
                        <strong>${focus.proof.length} steps</strong>
                    </div>
                    <div>
                        <span>Leaf key</span>
                        <code>${escapeHtml(focus.key)}</code>
                    </div>
                </div>
                <div class="proof-steps">
                    ${focus.proof
                        .map(
                            (sibling, index) => `
                                <article class="proof-step">
                                    <span>${index + 1}</span>
                                    <code>${escapeHtml(short(sibling, 18, 12))}</code>
                                    <small>${focus.positions[index] ? "Current hash was right child" : "Current hash was left child"}</small>
                                </article>
                            `
                        )
                        .join("")}
                </div>
                <div class="proof-foot">
                    <div>
                        <span>Salt</span>
                        <code>${escapeHtml(short(focus.salt, 18, 12))}</code>
                    </div>
                    <div>
                        <span>Raw value</span>
                        <code>${escapeHtml(summarizeClaimValue(focus.value))}</code>
                    </div>
                </div>
            ` : ""}
        </div>
    `;
}

function renderClaims(): string {
    return state.scenario.credential.claims
        .map((claim) => {
            const checked = state.selectedClaims.has(claim.key);
            const requested = DEMO_REQUIRED_CLAIMS.includes(claim.key as (typeof DEMO_REQUIRED_CLAIMS)[number]);
            return `
                <label class="claim-toggle ${checked ? "selected revealed" : "hidden-claim"}">
                    <input type="checkbox" data-claim-key="${claim.key}" ${checked ? "checked" : ""} />
                    <div>
                        <div class="claim-head">
                            <strong>${escapeHtml(claimLabel(claim.key))}</strong>
                            ${requested ? '<span class="claim-badge">Required</span>' : '<span class="claim-badge muted">Stays hidden</span>'}
                            ${checked ? '<span class="claim-badge revealed-badge">Revealed</span>' : ""}
                        </div>
                        <p class="claim-readable">${escapeHtml(formatClaimReadableValue(claim))}</p>
                        ${state.toggles.showRawClaims ? `<p class="claim-raw"><code>${escapeHtml(summarizeClaimValue(claim.value))}</code></p>` : ""}
                    </div>
                </label>
            `;
        })
        .join("");
}

function renderPolicyWarnings(): string {
    const revealed = formatRevealedSummary(
        state.scenario.policy.selectedClaimKeys.filter((key) =>
            DEMO_REQUIRED_CLAIMS.includes(key as (typeof DEMO_REQUIRED_CLAIMS)[number])
        )
    );
    const hidden = formatHiddenSummary(state.scenario.policy.hiddenCount);

    if (state.scenario.policy.exactMatch) {
        return `
            <div class="policy-callout good">
                <strong>Only these facts are revealed</strong>
                <p class="disclosure-summary"><span>Revealed:</span> ${escapeHtml(revealed)}</p>
                <p class="disclosure-summary"><span>Hidden:</span> ${escapeHtml(hidden)}</p>
            </div>
        `;
    }

    return `
        <div class="policy-callout bad">
            <strong>Selection does not match the verifier request</strong>
            <p>${escapeHtml(state.scenario.presentationError ?? "Reveal exactly degree field, GPA, and thesis — no more, no less.")}</p>
        </div>
    `;
}

function renderChainStatusCards(snapshot?: ChainSnapshot): string {
    if (!snapshot || snapshot.error) {
        return `
            <div class="status-cards">
                <article class="status-card neutral">
                    <span>Issuer authorized</span>
                    <strong>Not checked yet</strong>
                    <p>Connect to a local chain and refresh to see live status.</p>
                </article>
                <article class="status-card neutral">
                    <span>Credential anchored</span>
                    <strong>Unknown</strong>
                    <p>Anchor the credential on-chain to record its status.</p>
                </article>
                <article class="status-card neutral">
                    <span>Not revoked</span>
                    <strong>Unknown</strong>
                    <p>Revocation status appears after a registry read.</p>
                </article>
                <article class="status-card neutral">
                    <span>Issuer active</span>
                    <strong>Unknown</strong>
                    <p>Issuer activity is checked against the registry.</p>
                </article>
            </div>
        `;
    }

    const issuerAuthorized = snapshot.organizationRegistered;
    const credentialAnchored = Boolean(snapshot.anchorExists);
    const notRevoked = !snapshot.isRevoked;
    const issuerActive = Boolean(snapshot.organizationActive);

    return `
        <div class="status-cards">
            <article class="status-card ${issuerAuthorized ? "good" : "bad"}">
                <span>Issuer authorized</span>
                <strong>${issuerAuthorized ? "Yes" : "No"}</strong>
                <p>${escapeHtml(snapshot.organizationName ?? DEMO_ORGANIZATION.name)} is ${issuerAuthorized ? "registered" : "not registered"} on the chain.</p>
            </article>
            <article class="status-card ${credentialAnchored ? "good" : "neutral"}">
                <span>Credential anchored</span>
                <strong>${credentialAnchored ? "Yes" : "No"}</strong>
                <p>${credentialAnchored ? "A commitment for this credential exists on-chain." : "Not anchored yet — use Anchor credential in advanced setup."}</p>
            </article>
            <article class="status-card ${notRevoked ? "good" : "bad"}">
                <span>Not revoked</span>
                <strong>${notRevoked ? "Yes" : "No"}</strong>
                <p>${notRevoked ? "No revocation flag is set for this credential." : "This credential has been revoked on-chain."}</p>
            </article>
            <article class="status-card ${issuerActive ? "good" : "bad"}">
                <span>Issuer active</span>
                <strong>${issuerActive ? "Yes" : "No"}</strong>
                <p>${issuerActive ? "The issuing organization is active." : "The issuer organization is inactive or suspended."}</p>
            </article>
        </div>
    `;
}

function renderChainHelpPanel(): string {
    const chainReady = isChainConfigured();
    const snapshot = state.chainSnapshot;

    if (!chainReady) {
        return `
            <div class="chain-help-panel">
                <strong>Blockchain not connected</strong>
                <p>Open advanced local chain setup below and enter contract addresses to check live registry status.</p>
            </div>
        `;
    }

    if (snapshot?.error) {
        return `
            <div class="chain-help-panel error">
                <strong>Registry read failed</strong>
                <p>${escapeHtml(snapshot.error)}</p>
            </div>
        `;
    }

    if (!snapshot) {
        return `
            <div class="chain-help-panel">
                <strong>Ready to check blockchain status</strong>
                <p>Click Refresh blockchain status to read issuer authorization, anchoring, and revocation state.</p>
            </div>
        `;
    }

    return "";
}

function renderChainPanel(): string {
    const chainReady = isChainConfigured();
    const snapshot = state.chainSnapshot;
    const chainDisabled = !chainReady;
    const helpPanel = renderChainHelpPanel();

    return `
        <div class="chain-flow">
            <div class="chain-status-band">
                ${renderChainStatusCards(snapshot)}
            </div>
            <div class="chain-primary-actions">
                ${renderButton("refresh-chain", {variant: "primary", disabled: chainDisabled})}
            </div>
            ${helpPanel}
            <div class="chain-advanced-toggle">
                ${renderToggle("showAdvancedChain", "Advanced local chain setup")}
            </div>
            ${state.toggles.showAdvancedChain ? `
                <div class="chain-advanced nested-band">
                    <div class="chain-form">
                        <label>
                            <span>RPC URL</span>
                            <input data-chain-field="rpcUrl" value="${escapeHtml(state.chainInputs.rpcUrl)}" />
                        </label>
                        <label>
                            <span>IssuerRegistryV2</span>
                            <input
                                data-chain-field="issuerRegistryV2"
                                value="${escapeHtml(state.chainInputs.issuerRegistryV2)}"
                                placeholder="0x..."
                            />
                        </label>
                        <label>
                            <span>CredentialRegistryV2</span>
                            <input
                                data-chain-field="credentialRegistryV2"
                                value="${escapeHtml(state.chainInputs.credentialRegistryV2)}"
                                placeholder="0x..."
                            />
                        </label>
                    </div>
                    <div class="action-cluster">
                        ${renderButton("register-org", {disabled: chainDisabled})}
                        ${renderButton("anchor", {disabled: chainDisabled})}
                        ${renderButton("revoke", {variant: "danger", disabled: chainDisabled})}
                        ${renderButton("suspend", {variant: "ghost", disabled: chainDisabled})}
                    </div>
                    <p class="chain-note">
                        ${escapeHtml(
                            `${DEMO_ROLE_COPY.registerOrganization} ${DEMO_ROLE_COPY.suspendOrganization} ${DEMO_ROLE_COPY.anchorCredential} ${DEMO_ROLE_COPY.revokeCredential} ${DEMO_ROLE_COPY.organizationAdministration}`
                        )}
                    </p>
                    ${chainReady && snapshot && !snapshot.error ? `
                        <div class="registry-grid">
                            <article>
                                <span>Organization</span>
                                <strong>${escapeHtml(snapshot.organizationName ?? DEMO_ORGANIZATION.name)}</strong>
                                <p>${snapshot.organizationRegistered ? "Registered on chain" : "Not yet registered"}</p>
                            </article>
                            <article>
                                <span>Issuer epoch</span>
                                <strong>${snapshot.organizationEpoch ?? "Unavailable"}</strong>
                                <p>${snapshot.organizationActive ? "Active controller path" : "Inactive or unknown"}</p>
                            </article>
                            <article>
                                <span>StatusOf</span>
                                <strong>${escapeHtml(formatStatus(snapshot.status))}</strong>
                                <p>${snapshot.isRevoked ? "Revocation bit is set" : "Revocation bit is clear"}</p>
                            </article>
                            <article>
                                <span>Next revocation index</span>
                                <strong>${snapshot.nextRevocationIndex ?? "Unavailable"}</strong>
                                <p>Word ${snapshot.revocationWordIndex?.toString() ?? "0"}: ${escapeHtml(short(formatWord(snapshot.revocationWordValue), 18, 12))}</p>
                            </article>
                        </div>
                        <div class="registry-details">
                            <div>
                                <span>Anchor key</span>
                                <code>${escapeHtml(short(state.scenario.anchorKey, 20, 14))}</code>
                            </div>
                            <div>
                                <span>Holder commitment</span>
                                <code>${escapeHtml(short(state.scenario.holderCommitment, 20, 14))}</code>
                            </div>
                            <div>
                                <span>Anchor record</span>
                                <code>${snapshot.anchorExists ? "Present" : "Not anchored"}</code>
                            </div>
                            <div>
                                <span>Revocation slot</span>
                                <code>${snapshot.anchorRevocationIndex?.toString() ?? "Unavailable"}</code>
                            </div>
                        </div>
                        <div class="comparison-panel ${snapshot.anchorComparison?.matches ? "good" : "neutral"}">
                            <div class="comparison-head">
                                <strong>On-chain anchor comparison</strong>
                                <span>
                                    ${snapshot.anchorComparison
                                        ? snapshot.anchorComparison.matches
                                            ? "All anchored fields match the local V2 credential."
                                            : `${snapshot.anchorComparison.mismatches.length} mismatch codes returned.`
                                        : "Anchor comparison becomes available after the credential is anchored."}
                                </span>
                            </div>
                            ${snapshot.anchorComparison && !snapshot.anchorComparison.matches ? `
                                <div class="mismatch-list">
                                    ${snapshot.anchorComparison.mismatches
                                        .map(
                                            (mismatch) => `
                                                <article>
                                                    <strong>${escapeHtml(mismatch.code)}</strong>
                                                    <p>Expected ${escapeHtml(String(mismatch.expected))}</p>
                                                    <p>Actual ${escapeHtml(String(mismatch.actual))}</p>
                                                </article>
                                            `
                                        )
                                        .join("")}
                                </div>
                            ` : ""}
                        </div>
                        ${snapshot.txHash ? `<p class="chain-note">Latest transaction: <code>${escapeHtml(short(snapshot.txHash, 18, 14))}</code></p>` : ""}
                    ` : ""}
                </div>
            ` : ""}
        </div>
    `;
}

function render(): void {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) throw new Error("Missing #app");

    const disclosedCount = state.scenario.policy.disclosedCount;
    const hiddenCount = state.scenario.policy.hiddenCount;

    app.innerHTML = `
        <div class="page-shell">
            <header class="hero">
                <div class="hero-copy">
                    <p class="eyebrow">Academic credential demo</p>
                    <h1>Prove graduation without revealing your transcript</h1>
                    <p class="hero-text">
                        Watch a university issue a credential, a student share only what a verifier needs,
                        and a blockchain registry confirm the result — while private transcript details stay hidden.
                    </p>
                    <div class="hero-actions">
                        ${renderButton("issue", {variant: "primary"})}
                        ${renderButton("match-policy", {variant: "secondary"})}
                        ${renderButton("verify", {variant: "ghost", disabled: !state.scenario.presentation})}
                    </div>
                </div>
                <aside class="hero-rail">
                    <div class="metric-block">
                        <span>University</span>
                        <strong>${escapeHtml(DEMO_ORGANIZATION.name)}</strong>
                        <p class="hero-note">${disclosedCount} facts revealed · ${hiddenCount} stay private</p>
                    </div>
                    <div class="toggle-row">
                        ${renderToggle("showHeroTechnical", "Inspect technical identifiers")}
                    </div>
                    ${state.toggles.showHeroTechnical ? `
                        <div class="metric-strip">
                            <article>
                                <span>Organization id</span>
                                <code>${escapeHtml(short(state.scenario.credential.issuerOrganizationId, 18, 12))}</code>
                            </article>
                            <article>
                                <span>Credential digest</span>
                                <code>${escapeHtml(short(state.scenario.credentialDigest, 16, 10))}</code>
                            </article>
                            <article>
                                <span>Merkle root</span>
                                <code>${escapeHtml(short(state.scenario.credential.merkleRoot, 16, 10))}</code>
                            </article>
                        </div>
                    ` : ""}
                </aside>
            </header>

            ${state.notice ? `<div class="notice ${state.notice.kind}">${escapeHtml(state.notice.text)}</div>` : ""}
            ${state.busyLabel ? `<div class="status-line"><span></span>${escapeHtml(state.busyLabel)}</div>` : ""}

            <section class="story-band">
                ${DEMO_STORY_CARDS
                    .map(
                        (card) => `
                            <article class="story-card">
                                <span>${escapeHtml(card.role)}</span>
                                <strong>${escapeHtml(card.title)}</strong>
                                <p>${escapeHtml(card.body)}</p>
                            </article>
                        `
                    )
                    .join("")}
            </section>

            <main class="content-grid">
                <section class="section issue">
                    <div class="section-head">
                        <div>
                            <h2>Step 1 — University issues a credential</h2>
                            <p class="section-deck">${escapeHtml(DEMO_ORGANIZATION.name)} signs a full academic record with eight facts. Most stay private unless the student chooses to reveal them.</p>
                        </div>
                        <span>${state.scenario.credential.claimCount} facts in the credential</span>
                    </div>
                    <div class="issue-layout">
                        <div class="ledger-panel">
                            <div class="meta-grid meta-grid-simple">
                                <article>
                                    <span>Issued by</span>
                                    <strong>${escapeHtml(DEMO_ORGANIZATION.name)}</strong>
                                </article>
                                <article>
                                    <span>Credential type</span>
                                    <strong>${escapeHtml(state.scenario.credential.credentialType)}</strong>
                                </article>
                                <article>
                                    <span>Issued at</span>
                                    <strong>${escapeHtml(formatTimestamp(state.scenario.credential.issuedAt))}</strong>
                                </article>
                                <article>
                                    <span>Total facts</span>
                                    <strong>${state.scenario.credential.claimCount}</strong>
                                </article>
                            </div>
                            <div class="toggle-row">
                                ${renderToggle("showCredentialDetails", "Inspect credential details")}
                            </div>
                            ${state.toggles.showCredentialDetails ? `
                                <div class="meta-grid">
                                    <article>
                                        <span>Issuer signing address</span>
                                        <code>${escapeHtml(short(state.scenario.credential.issuerSigningAddress, 18, 12))}</code>
                                    </article>
                                    <article>
                                        <span>Holder address</span>
                                        <code>${escapeHtml(short(state.scenario.credential.holder, 18, 12))}</code>
                                    </article>
                                    <article>
                                        <span>Credential id</span>
                                        <code>${escapeHtml(short(state.scenario.credential.id, 18, 12))}</code>
                                    </article>
                                    <article>
                                        <span>Expires at</span>
                                        <strong>${escapeHtml(formatTimestamp(state.scenario.credential.expiresAt))}</strong>
                                    </article>
                                </div>
                                <div class="signature-stack">
                                    <div>
                                        <span>Issuer signature</span>
                                        <code>${escapeHtml(formatSignature(state.scenario.credential.signature))}</code>
                                    </div>
                                    <div>
                                        <span>Holder signature</span>
                                        <code>${escapeHtml(
                                            state.scenario.presentation
                                                ? formatSignature(state.scenario.presentation.presentationAuthorization.signature)
                                                : "Awaiting exact policy match"
                                        )}</code>
                                    </div>
                                    <div>
                                        <span>Request digest</span>
                                        <code>${escapeHtml(short(state.scenario.requestDigest, 20, 14))}</code>
                                    </div>
                                </div>
                            ` : ""}
                        </div>
                        <div class="story-panel">
                            <h3>Sample narrative</h3>
                            <p>
                                The issuer is ${escapeHtml(DEMO_ORGANIZATION.name)}. The credential tells a concrete story:
                                a computer science degree, a strong GPA, a thesis on privacy-preserving credentials, and several course-level transcript facts that stay hidden unless explicitly requested.
                            </p>
                            <dl class="story-list">
                                <div><dt>Degree field</dt><dd>Computer Science, Bachelor of Engineering</dd></div>
                                <div><dt>GPA</dt><dd>3.72 / 4.00 with Very Good honors</dd></div>
                                <div><dt>Thesis</dt><dd>Selective Disclosure Proof Systems for Academic Credentials</dd></div>
                                <div><dt>Hidden transcript facts</dt><dd>Courses, research lab affiliation, and transcript detail remain off-chain and undisclosed here.</dd></div>
                            </dl>
                        </div>
                    </div>
                </section>

                <section class="section disclosure">
                    <div class="section-head">
                        <div>
                            <p>Step 2 — Selective disclosure</p>
                            <h2>Only these facts are revealed</h2>
                            <p class="section-deck">The verifier asked for ${escapeHtml(requiredClaimLabels().join(", ").toLowerCase())}. Everything else stays hidden.</p>
                        </div>
                        <span>${disclosedCount} revealed · ${hiddenCount} hidden</span>
                    </div>
                    <div class="disclosure-layout">
                        <div class="policy-panel">
                            <div class="policy-tags">
                                ${requiredClaimLabels()
                                    .map((label) => `<span>${escapeHtml(label)}</span>`)
                                    .join("")}
                            </div>
                            ${renderPolicyWarnings()}
                            <div class="toggle-row">
                                ${renderToggle("showRawClaims", "Inspect raw claim data")}
                            </div>
                            <p class="support-text">
                                The student must reveal exactly what the verifier requested — no extra transcript fields, and no missing required facts.
                            </p>
                        </div>
                        <div class="claim-column">
                            ${renderClaims()}
                        </div>
                    </div>
                </section>

                <section class="section merkle">
                    <div class="section-head alt-head">
                        <div>
                            <p>Step 3 — Cryptographic proof</p>
                            <h2>Why hidden data still proves correctly</h2>
                            <p class="section-deck">Revealed facts are mathematically linked to the full credential without exposing private transcript rows.</p>
                        </div>
                        <span>${state.scenario.presentation?.disclosed.length ?? 0} revealed facts</span>
                    </div>
                    ${renderProofPanel()}
                </section>

                <section class="section verification">
                    <div class="section-head alt-head">
                        <div>
                            <p>Step 4 — Verification</p>
                            <h2>Does the proof check out?</h2>
                            <p class="section-deck">The verifier confirms signatures, policy match, and that hidden transcript data was not revealed.</p>
                        </div>
                        <span>${state.verification?.valid ? "Passed" : state.verificationRan ? "Failed" : "Not run yet"}</span>
                    </div>
                    <div class="verification-layout">
                        <div class="binding-panel">
                            <article>
                                <span>Verifier requested</span>
                                <strong>${escapeHtml(requiredClaimLabels().join(", "))}</strong>
                            </article>
                            <article>
                                <span>Audience</span>
                                <strong>${escapeHtml(DEMO_AUDIENCE)}</strong>
                            </article>
                            ${state.toggles.showAdvancedVerification ? `
                                <article>
                                    <span>Holder authorization digest</span>
                                    <code>${escapeHtml(
                                        state.scenario.presentationAuthorizationDigest
                                            ? short(state.scenario.presentationAuthorizationDigest, 20, 14)
                                            : "Unavailable until disclosure matches policy"
                                    )}</code>
                                </article>
                                <article>
                                    <span>Verifier signing address</span>
                                    <code>${escapeHtml(short(DEMO_IDENTITIES.verifier.address, 18, 12))}</code>
                                </article>
                            ` : ""}
                        </div>
                        <div class="verification-panel">
                            ${renderVerificationSummary()}
                        </div>
                    </div>
                </section>

                <section class="section chain">
                    <div class="section-head">
                        <div>
                            <p>Step 5 — Blockchain registry</p>
                            <h2>Blockchain status</h2>
                            <p class="section-deck">The on-chain registry confirms the issuer is authorized and the credential has not been revoked.</p>
                        </div>
                        <span>Live registry check</span>
                    </div>
                    ${renderChainPanel()}
                </section>

                <section class="section privacy section-spaced">
                    <div class="section-head alt-head">
                        <div>
                            <h2>Privacy boundary</h2>
                            <p class="section-deck">The registry stores commitments, not transcript contents, and undisclosed transcript data never leaves the holder here.</p>
                        </div>
                        <span>Hidden transcript material stays local unless the holder reveals it</span>
                    </div>
                    <div class="privacy-grid">
                        <article class="boundary-card">
                            <span>Anchored on-chain</span>
                            <strong>Only commitment material</strong>
                            <ul>
                                <li>Organization id and issuer signing address</li>
                                <li>Credential digest, Merkle root, holder commitment</li>
                                <li>IssuedAt, expiresAt, claim count, revocation slot, status</li>
                            </ul>
                        </article>
                        <article class="boundary-card">
                            <span>Never written on-chain</span>
                            <strong>Private transcript contents</strong>
                            <ul>
                                ${state.scenario.policy.hiddenClaimKeys
                                    .map((claimKey) => `<li>${escapeHtml(claimKey)}</li>`)
                                    .join("")}
                            </ul>
                        </article>
                        <article class="boundary-card emphasis">
                            <span>Demo takeaway</span>
                            <strong>Hidden claims remain hidden</strong>
                            <p>
                                The undisclosed courses, research lab affiliation, and extra transcript structure are absent from the request,
                                absent from the presentation, and impossible to reconstruct from the on-chain V2 registry.
                            </p>
                        </article>
                    </div>
                </section>
            </main>
        </div>
    `;

    bindEvents(app);
}

function bindEvents(root: HTMLElement): void {
    root.querySelectorAll<HTMLInputElement>("[data-claim-key]").forEach((input) => {
        input.addEventListener("change", () => {
            const claimKey = input.dataset.claimKey;
            if (!claimKey) return;

            if (input.checked) state.selectedClaims.add(claimKey);
            else state.selectedClaims.delete(claimKey);

            synchronizeScenario();
            render();
        });
    });

    root.querySelectorAll<HTMLInputElement>("[data-chain-field]").forEach((input) => {
        input.addEventListener("change", () => {
            const field = input.dataset.chainField as keyof ChainInputs | undefined;
            if (!field) return;

            state.chainInputs[field] = input.value.trim();
            saveChainInputs();
            state.chainSnapshot = undefined;
        });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-proof-key]").forEach((button) => {
        button.addEventListener("click", () => {
            const proofKey = button.dataset.proofKey;
            if (!proofKey) return;
            state.proofFocusKey = proofKey;
            render();
        });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
        button.addEventListener("click", () => {
            const action = button.dataset.action;
            if (!action) return;
            void handleAction(action);
        });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
            const key = button.dataset.toggle as keyof UiToggles | undefined;
            if (!key || !(key in state.toggles)) return;
            state.toggles[key] = !state.toggles[key];
            render();
        });
    });
}

async function handleAction(action: string): Promise<void> {
    try {
        if (action === "issue") {
            synchronizeScenario(true);
            await runVerification();
            setNotice("ok", "A fresh credential was issued with updated timestamps.");
            render();
            return;
        }

        if (action === "match-policy") {
            state.selectedClaims = new Set(DEMO_REQUIRED_CLAIMS);
            synchronizeScenario();
            await runVerification();
            setNotice("ok", "Revealed facts reset to the three required by the verifier.");
            render();
            return;
        }

        if (action === "verify") {
            if (!state.scenario.presentation) {
                throw new Error(state.scenario.presentationError ?? "The disclosure must exactly match the verifier policy before verification can run.");
            }
            setBusy(action, "Verifying signatures, policy match, and cryptographic proofs...");
            await runVerification();
            setNotice(state.verification?.valid ? "ok" : "bad", state.verification?.valid ? "Verification passed." : "Verification failed.");
            return;
        }

        ensureChainConfigured();

        const labels: Record<string, string> = {
            "refresh-chain": "Reading blockchain registry status...",
            "register-org": "Registering the demo university on the V2 issuer registry...",
            anchor: "Anchoring the V2 credential with the issuer signing key...",
            revoke: "Revoking the anchored credential in the organization bitmap...",
            suspend: "Suspending the issuer organization to surface IssuerInactive status..."
        };

        setBusy(action, labels[action] ?? "Working...");

        if (action === "refresh-chain") {
            await refreshChainSnapshot();
            setNotice("ok", "Blockchain status refreshed.");
            return;
        }

        if (action === "register-org") {
            const adminClient = writeClient(DEMO_PRIVATE_KEYS.admin);
            const txHash = await adminClient.registerOrganization({
                organizationId: DEMO_ORGANIZATION.id,
                controller: keyPairFromPrivateKey(DEMO_PRIVATE_KEYS.verifier).address,
                name: DEMO_ORGANIZATION.name,
                metadataURI: DEMO_ORGANIZATION.metadataURI,
                initialSigningKey: keyPairFromPrivateKey(DEMO_PRIVATE_KEYS.issuer).address,
                initialValidFrom: state.scenario.credential.issuedAt
            });
            await refreshChainSnapshot(txHash);
            setNotice("ok", `Organization registered in ${short(txHash, 18, 12)}.`);
            return;
        }

        if (action === "anchor") {
            const issuerClient = writeClient(DEMO_PRIVATE_KEYS.issuer);
            const txHash = await issuerClient.anchorCredential({
                organizationId: state.scenario.credential.issuerOrganizationId as Hex,
                credentialId: state.scenario.credential.id as Hex,
                credentialDigest: state.scenario.credentialDigest,
                holderCommitment: state.scenario.holderCommitment,
                merkleRoot: state.scenario.credential.merkleRoot as Hex,
                issuedAt: state.scenario.credential.issuedAt,
                expiresAt: state.scenario.credential.expiresAt,
                claimCount: state.scenario.credential.claimCount
            });
            await refreshChainSnapshot(txHash);
            setNotice("ok", `Credential anchored in ${short(txHash, 18, 12)}.`);
            return;
        }

        if (action === "revoke") {
            const issuerClient = writeClient(DEMO_PRIVATE_KEYS.issuer);
            const txHash = await issuerClient.revokeCredential(
                state.scenario.credential.issuerOrganizationId as Hex,
                state.scenario.credential.issuerSigningAddress as `0x${string}`,
                state.scenario.credential.id as Hex,
                id("capstone-v2-demo-revocation") as Hex
            );
            await refreshChainSnapshot(txHash);
            setNotice("warn", `Credential revoked in ${short(txHash, 18, 12)}.`);
            return;
        }

        if (action === "suspend") {
            const adminClient = writeClient(DEMO_PRIVATE_KEYS.admin);
            const txHash = await adminClient.suspendOrganization(
                state.scenario.credential.issuerOrganizationId as Hex
            );
            await refreshChainSnapshot(txHash);
            setNotice("warn", `Issuer organization suspended in ${short(txHash, 18, 12)}.`);
            return;
        }
    } catch (error) {
        setNotice("bad", (error as Error).message);
    } finally {
        state.busyAction = undefined;
        state.busyLabel = undefined;
        render();
    }
}
