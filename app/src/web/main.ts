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
    DEFAULT_CHAIN_INPUTS,
    getProductModeLabel,
    loadGeneratedChainInputs,
    pickChainInputs,
    resolveChainInputs,
    type ChainInputs
} from "./chainConfig.js";
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
    DEMO_STEPS,
    type DemoStepId,
    getDemoStepIndex,
    getDemoStepStatus,
    getWorkspaceMeta
} from "./demoSteps.js";
import {getActionLabel, planAction} from "./actionFlow.js";
import {DEFAULT_UI_TOGGLES, type UiToggles} from "./uiState.js";
import {
    DEMO_STORY_CARDS,
    claimLabel,
    formatClaimReadableValue,
    formatHiddenSummary,
    formatRevealedSummary,
    groupVerificationChecks,
    requiredClaimLabels
} from "../util/webUi.js";

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

interface AppState {
    activeStep: DemoStepId;
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
const storedChain = pickChainInputs(
    JSON.parse(localStorage.getItem(CHAIN_STORAGE_KEY) ?? "{}") as Partial<ChainInputs>
);

const state: AppState = {
    activeStep: "overview",
    selectedClaims: new Set(DEMO_REQUIRED_CLAIMS),
    scenario: createDemoScenario(DEMO_REQUIRED_CLAIMS),
    verificationRan: false,
    chainInputs: {
        ...DEFAULT_CHAIN_INPUTS,
        ...storedChain
    },
    proofFocusKey: DEMO_REQUIRED_CLAIMS[0],
    toggles: {...DEFAULT_UI_TOGGLES}
};

void primeDemo();

async function primeDemo(): Promise<void> {
    const queryInputs = pickChainInputs({
        rpcUrl: new URLSearchParams(window.location.search).get("rpcUrl") ?? undefined,
        issuerRegistryV2: new URLSearchParams(window.location.search).get("issuerRegistryV2") ?? undefined,
        credentialRegistryV2: new URLSearchParams(window.location.search).get("credentialRegistryV2") ?? undefined
    });
    const generatedInputs = await loadGeneratedChainInputs();
    const resolved = resolveChainInputs({
        query: queryInputs,
        stored: storedChain,
        generated: generatedInputs
    });

    state.chainInputs = resolved.inputs;
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

function setActiveStep(step: DemoStepId): void {
    state.activeStep = step;
}

function resetDemo(): void {
    state.activeStep = "overview";
    state.selectedClaims = new Set(DEMO_REQUIRED_CLAIMS);
    state.proofFocusKey = DEMO_REQUIRED_CLAIMS[0];
    state.toggles = {...DEFAULT_UI_TOGGLES};
    state.notice = undefined;
    state.busyAction = undefined;
    state.busyLabel = undefined;
    synchronizeScenario(true);
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

function renderWorkspaceNav(): string {
    return `
        <nav class="workspace-nav" aria-label="Product areas">
            ${DEMO_STEPS.map((step) => {
                const status = getDemoStepStatus(state.activeStep, step.id);
                return `
                    <button
                        type="button"
                        class="workspace-nav-item ${status}"
                        data-step-id="${step.id}"
                        aria-current="${status === "current" ? "page" : "false"}"
                    >
                        <strong>${escapeHtml(step.label)}</strong>
                    </button>
                `;
            }).join("")}
        </nav>
    `;
}

function renderStepShell(): string {
    const activeStep = getWorkspaceMeta(state.activeStep);
    const modeLabel = getProductModeLabel(state.chainInputs);

    return `
        <header class="hero product-shell">
            <div class="hero-copy">
                <p class="eyebrow">CredentialTrust</p>
                <h1>Credential operations console</h1>
                <p class="hero-text demo-shell-text">
                    ${escapeHtml(activeStep.description)}
                </p>
                <div class="hero-actions">
                    ${state.activeStep === "overview"
                        ? `<span class="sample-badge">${escapeHtml(modeLabel)}</span>`
                        : renderButton(getActionForStep(state.activeStep), {variant: "primary"})}
                    ${state.activeStep === "overview" ? "" : `<span class="sample-badge">${escapeHtml(modeLabel)}</span>`}
                </div>
            </div>
            <aside class="hero-rail product-shell-rail">
                <div class="metric-block">
                    <span>You are</span>
                    <strong>${escapeHtml(activeStep.roleLabel)}</strong>
                    <p class="hero-note">${escapeHtml(activeStep.title)}</p>
                </div>
                <div class="metric-block metric-block-light">
                    <span>Primary action</span>
                    <strong>${escapeHtml(activeStep.actionLabel)}</strong>
                    <p class="hero-note">${escapeHtml(activeStep.resultLabel)}</p>
                </div>
                ${renderWorkspaceNav()}
            </aside>
        </header>
    `;
}

function getActionForStep(step: DemoStepId): string {
    switch (step) {
        case "overview":
            return "start-demo";
        case "issue":
            return "issue";
        case "reveal":
            return "reveal";
        case "verify":
            return "verify";
        case "blockchain":
            return isChainConfigured() ? "refresh-chain" : "set-up-chain";
        case "privacy":
            return "restart-demo";
    }
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
            <span class="button-face">${escapeHtml(loading ? `${getActionLabel(action)}...` : getActionLabel(action))}</span>
        </button>
    `;
}

function renderActionCard(
    title: string,
    description: string,
    action: string,
    options: {variant?: "primary" | "secondary" | "ghost" | "danger"; badge?: string; disabled?: boolean} = {}
): string {
    return `
        <article class="action-card">
            <div class="action-card-copy">
                ${options.badge ? `<span class="action-card-badge">${escapeHtml(options.badge)}</span>` : ""}
                <strong>${escapeHtml(title)}</strong>
                <p>${escapeHtml(description)}</p>
            </div>
            <div class="action-card-foot">
                ${renderButton(action, {variant: options.variant ?? "secondary", disabled: options.disabled})}
            </div>
        </article>
    `;
}

function renderVerificationSummary(): string {
    if (!state.scenario.presentation) {
        return `
            <div class="empty-state">
                <strong>No proof prepared yet</strong>
                <p>${escapeHtml(state.scenario.presentationError ?? "Share proof from the wallet, then verify it here.")}</p>
            </div>
        `;
    }

    if (!state.verificationRan || !state.verification) {
        return `
            <div class="empty-state">
                <strong>Ready to verify</strong>
                <p>Click Verify proof to check the submitted proof.</p>
            </div>
        `;
    }

    const verdictClass = state.verification.valid ? "good" : "bad";
    const groups = groupVerificationChecks(state.verification.checks);

    return `
        <div class="verification-board ${verdictClass}">
            <div class="verification-verdict">
                <span>Result</span>
                <strong>${state.verification.valid ? "Accepted" : "Rejected"}</strong>
                <p class="verdict-summary">
                    ${state.verification.valid
                        ? "The proof matches the request and the registry checks passed."
                        : "Open Evidence for the failing check."}
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
                ${renderToggle("showAdvancedVerification", "Evidence details")}
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
                <p>Share proof from the wallet first.</p>
            </div>
        `;
    }

    return `
        <div class="proof-shell">
            <p class="proof-intro">Each revealed fact stays linked to the full credential through a Merkle path.</p>
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
                ${renderToggle("showMerkleInternals", "Show advanced evidence")}
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
                    <p>Check the registry to read live status.</p>
                </article>
                <article class="status-card neutral">
                    <span>Credential anchored</span>
                    <strong>Unknown</strong>
                    <p>Anchor the credential on-chain to record it.</p>
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
                <p>${escapeHtml(snapshot.organizationName ?? DEMO_ORGANIZATION.name)} is ${issuerAuthorized ? "registered" : "missing"}.</p>
            </article>
            <article class="status-card ${credentialAnchored ? "good" : "neutral"}">
                <span>Credential anchored</span>
                <strong>${credentialAnchored ? "Yes" : "No"}</strong>
                <p>${credentialAnchored ? "A commitment exists on-chain." : "Not anchored yet."}</p>
            </article>
            <article class="status-card ${notRevoked ? "good" : "bad"}">
                <span>Not revoked</span>
                <strong>${notRevoked ? "Yes" : "No"}</strong>
                <p>${notRevoked ? "No revocation flag is set." : "This credential has been revoked."}</p>
            </article>
            <article class="status-card ${issuerActive ? "good" : "bad"}">
                <span>Issuer active</span>
                <strong>${issuerActive ? "Yes" : "No"}</strong>
                <p>${issuerActive ? "The issuing organization is active." : "The issuer is inactive."}</p>
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
                <strong>Advanced setup hidden</strong>
                <p>Open advanced setup to enter the RPC URL and contract addresses.</p>
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

    return "";
}

function renderChainPanel(): string {
    const chainReady = isChainConfigured();
    const snapshot = state.chainSnapshot;
    const helpPanel = renderChainHelpPanel();
    const primaryAction = chainReady ? "refresh-chain" : "set-up-chain";
    const primaryDisabled = false;
    const chainDisabled = !chainReady;

    return `
        <div class="chain-flow">
            ${chainReady ? `
                <div class="chain-help-panel">
                    <strong>Connected to local chain</strong>
                    <p>Refresh to read the latest issuer, anchor, and revocation state.</p>
                </div>
            ` : ""}
            <div class="chain-status-band">
                ${renderChainStatusCards(snapshot)}
            </div>
            <div class="chain-primary-actions">
                ${renderButton(primaryAction, {variant: "primary", disabled: primaryDisabled})}
                ${renderButton("continue-to-privacy", {variant: "ghost"})}
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
                            <input
                                data-chain-field="rpcUrl"
                                value="${escapeHtml(state.chainInputs.rpcUrl)}"
                                placeholder="http://127.0.0.1:8545"
                            />
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
                                <span>Credential status</span>
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

function renderOverviewStep(): string {
    const modeLabel = getProductModeLabel(state.chainInputs);
    const currentMeta = getWorkspaceMeta(state.activeStep);

    return `
        <section class="section demo-step">
            <div class="section-head">
                <div>
                    <p>Dashboard</p>
                    <h2>Issue, share, verify, or check registry status.</h2>
                    <p class="section-deck">Pick one workspace and move the flow forward.</p>
                </div>
                <span>${escapeHtml(modeLabel)}</span>
            </div>
            <div class="dashboard-layout">
                <div class="dashboard-summary">
                    <article class="status-card good">
                        <span>You are</span>
                        <strong>${escapeHtml(currentMeta.roleLabel)}</strong>
                        <p>${escapeHtml(currentMeta.title)}</p>
                    </article>
                    <article class="status-card good">
                        <span>Primary action</span>
                        <strong>${escapeHtml(currentMeta.actionLabel)}</strong>
                        <p>${escapeHtml(currentMeta.description)}</p>
                    </article>
                    <article class="status-card neutral">
                        <span>Result</span>
                        <strong>${escapeHtml(currentMeta.resultLabel)}</strong>
                        <p>The action updates the visible state after it runs.</p>
                    </article>
                    <article class="status-card neutral">
                        <span>Why blockchain</span>
                        <strong>Independent trust source</strong>
                        <p>Registry reads confirm issuer authority, anchoring, and revocation.</p>
                    </article>
                </div>
                <div class="story-band">
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
                </div>
                <div class="action-card-grid">
                    ${renderActionCard(
                        "Issue credential",
                        "Create the signed record.",
                        "start-demo",
                        {variant: "primary", badge: "University"}
                    )}
                    ${renderActionCard(
                        "Share proof",
                        "Reveal only the requested facts.",
                        "reveal",
                        {badge: "Wallet"}
                    )}
                    ${renderActionCard(
                        "Verify proof",
                        "Check the proof and request match.",
                        "verify",
                        {badge: "Verifier"}
                    )}
                    ${renderActionCard(
                        "Check registry",
                        "Read issuer authority and revocation.",
                        isChainConfigured() ? "refresh-chain" : "set-up-chain",
                        {badge: "Registry"}
                    )}
                </div>
            </div>
            <div class="policy-callout good overview-callout">
                <strong>Flow</strong>
                <p>University signs, the student reveals, the verifier checks, and the registry confirms trust.</p>
            </div>
        </section>
    `;
}

function renderIssueStep(): string {
    const credential = state.scenario.credential;
    const rawMetadata = {
        version: credential.version,
        credentialType: credential.credentialType,
        schemaURI: credential.schemaURI,
        issuedAt: credential.issuedAt,
        expiresAt: credential.expiresAt,
        claimCount: credential.claimCount
    };

    return `
        <section class="section demo-step">
            <div class="section-head">
                <div>
                    <p>University Issuer</p>
                    <h2>University creates and signs the credential.</h2>
                    <p class="section-deck">Issue one signed record the student can hold.</p>
                </div>
                <span>Signed by university</span>
            </div>
            <div class="issue-layout">
                <div class="ledger-panel">
                    <div class="status-cards issue-status-cards">
                        <article class="status-card good">
                            <span>Issuer profile</span>
                            <strong>Signed</strong>
                            <p>${escapeHtml(DEMO_ORGANIZATION.name)} signs the record.</p>
                        </article>
                        <article class="status-card good">
                            <span>Credential template</span>
                            <strong>V2</strong>
                            <p>V2 schema and issuer profile.</p>
                        </article>
                        <article class="status-card good">
                            <span>Transcript scope</span>
                            <strong>${credential.claimCount} facts</strong>
                            <p>The full transcript is signed once.</p>
                        </article>
                        <article class="status-card neutral">
                            <span>Private facts</span>
                            <strong>${state.scenario.policy.hiddenCount} hidden</strong>
                            <p>${formatHiddenSummary(state.scenario.policy.hiddenCount)} stay private.</p>
                        </article>
                    </div>
                    <div class="policy-callout good">
                        <strong>Signed by university</strong>
                        <p>The credential is ready for the student wallet.</p>
                    </div>
                    <div class="hero-actions">
                        ${renderButton("issue", {variant: "primary"})}
                    </div>
                    <div class="toggle-row">
                        ${renderToggle("showCredentialDetails", "Show advanced issuer details")}
                    </div>
                    ${state.toggles.showCredentialDetails ? `
                        <div class="meta-grid issue-technical-grid">
                            <article>
                                <span>Credential digest</span>
                                <code>${escapeHtml(short(state.scenario.credentialDigest, 18, 12))}</code>
                            </article>
                            <article>
                                <span>Merkle root</span>
                                <code>${escapeHtml(short(credential.merkleRoot, 18, 12))}</code>
                            </article>
                            <article>
                                <span>Issuer signature</span>
                                <code>${escapeHtml(formatSignature(credential.signature))}</code>
                            </article>
                            <article>
                                <span>Holder address</span>
                                <code>${escapeHtml(short(credential.holder, 18, 12))}</code>
                            </article>
                            <article>
                                <span>Raw credential metadata</span>
                                <code>${escapeHtml(JSON.stringify(rawMetadata))}</code>
                            </article>
                        </div>
                    ` : ""}
                </div>
                <div class="story-panel">
                    <h3>Issuer profile</h3>
                    <p>The issuer signs once. The student receives the credential in a wallet.</p>
                    <dl class="story-list">
                        <div><dt>Issuer</dt><dd>${escapeHtml(DEMO_ORGANIZATION.name)}</dd></div>
                        <div><dt>Holder</dt><dd>${escapeHtml(short(credential.holder, 18, 12))}</dd></div>
                        <div><dt>Total facts</dt><dd>${credential.claimCount}</dd></div>
                        <div><dt>Hidden facts</dt><dd>${state.scenario.policy.hiddenCount}</dd></div>
                    </dl>
                </div>
            </div>
        </section>
    `;
}

function renderRevealStep(): string {
    return `
        <section class="section demo-step">
            <div class="section-head">
                <div>
                    <p>Student Wallet</p>
                    <h2>The student chooses what to reveal.</h2>
                    <p class="section-deck">Share only the facts the verifier asked for.</p>
                </div>
                <span>Wallet privacy summary</span>
            </div>
            <div class="wallet-layout">
                <div class="ledger-panel wallet-panel">
                    <div class="wallet-card">
                        <span>Student-owned credential</span>
                        <strong>${escapeHtml(DEMO_ORGANIZATION.name)}</strong>
                        <p>The wallet keeps the credential ready for selective disclosure.</p>
                        <dl class="wallet-summary">
                            <div><dt>Revealed facts</dt><dd>${state.scenario.policy.disclosedCount}</dd></div>
                            <div><dt>Hidden facts</dt><dd>${state.scenario.policy.hiddenCount}</dd></div>
                            <div><dt>Status</dt><dd>Ready to share</dd></div>
                        </dl>
                    </div>
                    <div class="policy-callout good">
                        <strong>Share proof</strong>
                        <p>Reveal degree field, GPA, and thesis only.</p>
                    </div>
                    <div class="hero-actions">
                        ${renderButton("reveal", {variant: "primary"})}
                    </div>
                    <div class="toggle-row">
                        ${renderToggle("showRawClaims", "Show raw wallet data")}
                    </div>
                    <p class="support-text">The wallet keeps the rest hidden.</p>
                </div>
                <div class="claim-column">
                    <div class="policy-panel">
                        <div class="policy-tags">
                            ${requiredClaimLabels()
                                .map((label) => `<span>${escapeHtml(label)}</span>`)
                                .join("")}
                        </div>
                        ${renderPolicyWarnings()}
                        ${renderClaims()}
                    </div>
                </div>
            </div>
        </section>
    `;
}

function renderVerifyStep(): string {
    return `
        <section class="section demo-step">
            <div class="section-head">
                <div>
                    <p>Verifier Portal</p>
                    <h2>${state.verification?.valid ? "Proof accepted" : "Proof waiting for review"}</h2>
                    <p class="section-deck">Check the proof without exposing the transcript.</p>
                </div>
                <span>${state.verification?.valid ? "Accepted" : state.verificationRan ? "Rejected" : "Awaiting proof"}</span>
            </div>
            <div class="verification-panel">
                <div class="policy-callout good verify-summary-callout">
                    <strong>Verification request</strong>
                    <p>degree field, GPA, thesis</p>
                </div>
                <div class="hero-actions">
                    ${renderButton("verify", {variant: "primary"})}
                </div>
                <div class="toggle-row">
                    ${renderToggle("showAdvancedVerification", "Evidence details")}
                </div>
                ${renderVerificationSummary()}
            </div>
        </section>
    `;
}

function renderBlockchainStep(): string {
    return `
        <section class="section demo-step">
            <div class="section-head">
                <div>
                    <p>Blockchain Registry</p>
                    <h2>Registry confirms trust and revocation.</h2>
                    <p class="section-deck">Refresh live chain status when you want a new read.</p>
                </div>
                <span>Live registry</span>
            </div>
            ${renderChainPanel()}
        </section>
    `;
}

function renderPrivacyStep(): string {
    const snapshot = state.chainSnapshot;
    const proofClaim = state.scenario.presentation?.disclosed.find((claim) => claim.key === state.proofFocusKey)
        ?? state.scenario.presentation?.disclosed[0];

    return `
        <section class="section demo-step">
            <div class="section-head">
                <div>
                    <p>Evidence / Advanced</p>
                    <h2>Technical evidence and proof material.</h2>
                    <p class="section-deck">Hashes, proofs, signatures, and checks stay collapsed by default.</p>
                </div>
                <span>Technical evidence</span>
            </div>
            <div class="privacy-grid">
                <article class="boundary-card">
                    <span>What was revealed</span>
                    <strong>${escapeHtml(formatRevealedSummary(state.scenario.policy.selectedClaimKeys))}</strong>
                    <p>${state.scenario.policy.disclosedCount} facts were shared with the verifier.</p>
                </article>
                <article class="boundary-card">
                    <span>What stayed hidden</span>
                    <strong>${escapeHtml(formatHiddenSummary(state.scenario.policy.hiddenCount))}</strong>
                    <p>Courses, research, and transcript rows stayed hidden.</p>
                </article>
                <article class="boundary-card">
                    <span>What went on-chain</span>
                    <strong>Commitments only</strong>
                    <p>Credential anchors, registry status, and revocation signals.</p>
                </article>
                <article class="boundary-card emphasis">
                    <span>What never left the student</span>
                    <strong>Raw transcript data</strong>
                    <p>The private transcript never appears unless the holder reveals it.</p>
                </article>
            </div>
            <div class="hero-actions privacy-actions">
                ${renderButton("restart-demo", {variant: "secondary"})}
            </div>
            <div class="toggle-row">
                ${renderToggle("showMerkleInternals", "Show advanced evidence")}
            </div>
            ${state.toggles.showMerkleInternals ? `
                <div class="privacy-advanced">
                    <div class="privacy-advanced-grid">
                        <article class="boundary-card">
                            <span>Credential digest</span>
                            <strong>${escapeHtml(short(state.scenario.credentialDigest, 18, 12))}</strong>
                            <p>Digest over the signed credential metadata.</p>
                        </article>
                        <article class="boundary-card">
                            <span>Merkle root</span>
                            <strong>${escapeHtml(short(state.scenario.credential.merkleRoot, 18, 12))}</strong>
                            <p>The root anchors the revealed claims.</p>
                        </article>
                        <article class="boundary-card">
                            <span>Issuer signature</span>
                            <strong>${escapeHtml(formatSignature(state.scenario.credential.signature))}</strong>
                            <p>University signature over the credential payload.</p>
                        </article>
                        <article class="boundary-card">
                            <span>Presentation digest</span>
                            <strong>${state.scenario.presentationAuthorizationDigest ? escapeHtml(short(state.scenario.presentationAuthorizationDigest, 18, 12)) : "Unavailable"}</strong>
                            <p>Digest used to bind the holder’s presentation authorization.</p>
                        </article>
                        <article class="boundary-card">
                            <span>Request digest</span>
                            <strong>${escapeHtml(short(state.scenario.requestDigest, 18, 12))}</strong>
                            <p>Verifier request digest recorded for binding checks.</p>
                        </article>
                        <article class="boundary-card">
                            <span>Merkle proof siblings</span>
                            <strong>${proofClaim ? `${proofClaim.proof.length} siblings` : "Unavailable"}</strong>
                            <p>Each revealed fact is linked to the full credential through a Merkle path.</p>
                        </article>
                        <article class="boundary-card">
                            <span>Salts and siblings</span>
                            <strong>${proofClaim ? escapeHtml(short(proofClaim.salt, 18, 12)) : "Unavailable"}</strong>
                            <p>Proof siblings and salts stay in the advanced view only.</p>
                        </article>
                        <article class="boundary-card">
                            <span>Revocation bitmap</span>
                            <strong>${snapshot?.revocationWordValue !== undefined ? escapeHtml(formatWord(snapshot.revocationWordValue)) : "Unavailable"}</strong>
                            <p>Revocation slots are read from the local registry when blockchain status is checked.</p>
                        </article>
                        <article class="boundary-card">
                            <span>Anchor comparison</span>
                            <strong>${snapshot?.anchorComparison?.matches ? "Matched" : snapshot?.anchorComparison ? "Mismatch" : "Not checked"}</strong>
                            <p>${snapshot?.anchorComparison?.matches ? "The anchor matches the local credential." : snapshot?.anchorComparison ? "One or more anchored fields differ." : "Check blockchain status first."}</p>
                        </article>
                    </div>
                    <div class="privacy-proof-panel">
                        ${renderProofPanel()}
                    </div>
                </div>
            ` : ""}
        </section>
    `;
}

function renderActiveStepContent(): string {
    switch (state.activeStep) {
        case "overview":
            return renderOverviewStep();
        case "issue":
            return renderIssueStep();
        case "reveal":
            return renderRevealStep();
        case "verify":
            return renderVerifyStep();
        case "blockchain":
            return renderBlockchainStep();
        case "privacy":
            return renderPrivacyStep();
    }
}

async function executeActionPlan(plan: ReturnType<typeof planAction>, action: string): Promise<void> {
    if (plan.nextStep) {
        setActiveStep(plan.nextStep);
    }

    if (plan.refreshScenario) {
        synchronizeScenario(Boolean(plan.refreshTimestamps));
    }

    if (plan.resetClaimsToRequired) {
        state.selectedClaims = new Set(DEMO_REQUIRED_CLAIMS);
        synchronizeScenario();
    }

    if (plan.openAdvancedChain) {
        state.toggles.showAdvancedChain = true;
    }

    if (plan.noticeKind && plan.noticeText) {
        setNotice(plan.noticeKind, plan.noticeText);
    }

    if (plan.rerunVerification) {
        await runVerification();
    }
}

function render(): void {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) throw new Error("Missing #app");

    app.innerHTML = `
        <div class="page-shell">
            ${renderStepShell()}

            ${state.notice ? `<div class="notice ${state.notice.kind}">${escapeHtml(state.notice.text)}</div>` : ""}
            ${state.busyLabel ? `<div class="status-line"><span></span>${escapeHtml(state.busyLabel)}</div>` : ""}

            ${renderActiveStepContent()}
        </div>
    `;

    bindEvents(app);
}

function bindEvents(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>("[data-step-id]").forEach((button) => {
        button.addEventListener("click", () => {
            const stepId = button.dataset.stepId as DemoStepId | undefined;
            if (!stepId) return;
            setActiveStep(stepId);
            render();
        });
    });

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
        if (action === "verify") {
            if (!state.scenario.presentation) {
                throw new Error(state.scenario.presentationError ?? "The disclosure must exactly match the verifier policy before verification can run.");
            }

            setBusy(action, "Verifying signatures, policy match, and cryptographic proofs...");
            await runVerification();
            setActiveStep("blockchain");
            setNotice(state.verification?.valid ? "ok" : "bad", state.verification?.valid ? "Verification passed." : "Verification failed.");
            return;
        }

        const plan = planAction(action, isChainConfigured());
        if (plan.nextStep === "overview" && action === "restart-demo") {
            resetDemo();
            setNotice("ok", "Opened the dashboard.");
            render();
            return;
        }

        if (plan.chainAction) {
            if (plan.requiresChainConfiguration) {
                ensureChainConfigured();
            }

            setBusy(action, {
                "refresh-chain": "Reading blockchain registry status...",
                "check-chain": "Reading blockchain registry status...",
                "register-org": "Registering the university on the V2 issuer registry...",
                anchor: "Anchoring the V2 credential with the issuer signing key...",
                revoke: "Revoking the anchored credential in the organization bitmap...",
                suspend: "Suspending the issuer organization to surface IssuerInactive status..."
            }[action] ?? "Working...");

            if (plan.chainAction === "refresh-chain") {
                await refreshChainSnapshot();
                setActiveStep("blockchain");
                setNotice("ok", "Blockchain status refreshed.");
                return;
            }

            if (plan.chainAction === "register-org") {
                const adminClient = writeClient(DEMO_PRIVATE_KEYS.admin);
                const txHash = await adminClient.registerOrganization({
                    organizationId: DEMO_ORGANIZATION.id,
                    controller: keyPairFromPrivateKey(DEMO_PRIVATE_KEYS.verifier).address,
                    name: DEMO_ORGANIZATION.name,
                    metadataURI: DEMO_ORGANIZATION.metadataURI,
                    initialSigningKey: keyPairFromPrivateKey(DEMO_PRIVATE_KEYS.issuer).address,
                    initialValidFrom: Math.max(1, state.scenario.credential.issuedAt - 3600)
                });
                await refreshChainSnapshot(txHash);
                setActiveStep("blockchain");
                setNotice("ok", `Organization registered in ${short(txHash, 18, 12)}.`);
                return;
            }

            if (plan.chainAction === "anchor") {
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
                setActiveStep("blockchain");
                setNotice("ok", `Credential anchored in ${short(txHash, 18, 12)}.`);
                return;
            }

            if (plan.chainAction === "revoke") {
                const issuerClient = writeClient(DEMO_PRIVATE_KEYS.issuer);
                const txHash = await issuerClient.revokeCredential(
                    state.scenario.credential.issuerOrganizationId as Hex,
                    state.scenario.credential.issuerSigningAddress as `0x${string}`,
                    state.scenario.credential.id as Hex,
                    id("capstone-v2-demo-revocation") as Hex
                );
                await refreshChainSnapshot(txHash);
                setActiveStep("blockchain");
                setNotice("warn", `Credential revoked in ${short(txHash, 18, 12)}.`);
                return;
            }

            if (plan.chainAction === "suspend") {
                const adminClient = writeClient(DEMO_PRIVATE_KEYS.admin);
                const txHash = await adminClient.suspendOrganization(
                    state.scenario.credential.issuerOrganizationId as Hex
                );
                await refreshChainSnapshot(txHash);
                setActiveStep("blockchain");
                setNotice("warn", `Issuer organization suspended in ${short(txHash, 18, 12)}.`);
                return;
            }

            if (plan.chainAction) {
                throw new Error(`Unhandled chain action: ${plan.chainAction}`);
            }
            return;
        }

        if (plan.nextStep || plan.openAdvancedChain || plan.refreshScenario || plan.resetClaimsToRequired || plan.rerunVerification) {
            await executeActionPlan(plan, action);
        }
    } catch (error) {
        setNotice("bad", (error as Error).message);
    } finally {
        state.busyAction = undefined;
        state.busyLabel = undefined;
        render();
    }
}
