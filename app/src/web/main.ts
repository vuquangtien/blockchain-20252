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
    proofFocusKey: DEMO_REQUIRED_CLAIMS[0]
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
        issue: "Issue Fresh Sample",
        "match-policy": "Match Verifier Policy",
        verify: "Run Verification",
        "refresh-chain": "Refresh Chain State",
        "register-org": "Register Organization",
        anchor: "Anchor Credential",
        revoke: "Revoke Credential",
        suspend: "Suspend Issuer"
    };
    return labels[action] ?? action;
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
                <strong>Presentation blocked</strong>
                <p>${escapeHtml(state.scenario.presentationError ?? "Select the exact verifier-required claims to continue.")}</p>
            </div>
        `;
    }

    if (!state.verificationRan || !state.verification) {
        return `
            <div class="empty-state">
                <strong>Verification ready</strong>
                <p>The credential, request, and holder authorization are prepared. Run verification to inspect every cryptographic check.</p>
            </div>
        `;
    }

    const passed = state.verification.checks.filter((check) => check.passed).length;
    const verdictClass = state.verification.valid ? "good" : "bad";

    return `
        <div class="verification-board ${verdictClass}">
            <div class="verification-verdict">
                <span>Verification</span>
                <strong>${state.verification.valid ? "Accepted" : "Rejected"}</strong>
                <small>${passed}/${state.verification.checks.length} checks passed</small>
            </div>
            <div class="check-list">
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
        </div>
    `;
}

function renderProofPanel(): string {
    const focus = state.scenario.presentation?.disclosed.find((claim) => claim.key === state.proofFocusKey)
        ?? state.scenario.presentation?.disclosed[0];

    if (!state.scenario.presentation || !focus) {
        return `
            <div class="empty-state">
                <strong>No Merkle path yet</strong>
                <p>Once the selected disclosure exactly matches the verifier request, the holder presentation reveals claim salts and sibling hashes for only those leaves.</p>
            </div>
        `;
    }

    return `
        <div class="proof-shell">
            <div class="proof-tabs">
                ${state.scenario.presentation.disclosed
                    .map(
                        (claim) => `
                            <button
                                type="button"
                                class="proof-chip ${claim.key === focus.key ? "active" : ""}"
                                data-proof-key="${claim.key}"
                            >
                                ${escapeHtml(claim.key)}
                            </button>
                        `
                    )
                    .join("")}
            </div>
            <div class="proof-head">
                <div>
                    <span>Focused leaf</span>
                    <strong>${escapeHtml(focus.key)}</strong>
                </div>
                <div>
                    <span>Proof depth</span>
                    <strong>${focus.proof.length} steps</strong>
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
                    <span>Value</span>
                    <code>${escapeHtml(summarizeClaimValue(focus.value))}</code>
                </div>
            </div>
        </div>
    `;
}

function renderClaims(): string {
    return state.scenario.credential.claims
        .map((claim) => {
            const checked = state.selectedClaims.has(claim.key);
            const requested = DEMO_REQUIRED_CLAIMS.includes(claim.key as (typeof DEMO_REQUIRED_CLAIMS)[number]);
            return `
                <label class="claim-toggle ${checked ? "selected" : ""}">
                    <input type="checkbox" data-claim-key="${claim.key}" ${checked ? "checked" : ""} />
                    <div>
                        <div class="claim-head">
                            <strong>${escapeHtml(claim.key)}</strong>
                            ${requested ? '<span class="claim-badge">Required</span>' : '<span class="claim-badge muted">Hidden by default</span>'}
                        </div>
                        <p>${escapeHtml(summarizeClaimValue(claim.value))}</p>
                    </div>
                </label>
            `;
        })
        .join("");
}

function renderPolicyWarnings(): string {
    if (state.scenario.policy.exactMatch) {
        return `
            <div class="policy-callout good">
                <strong>Request matched exactly</strong>
                <p>The holder reveals only the three policy-required facts and keeps the rest of the transcript private.</p>
            </div>
        `;
    }

    return `
        <div class="policy-callout bad">
            <strong>Policy mismatch</strong>
            <p>${escapeHtml(state.scenario.presentationError ?? "The selected disclosure no longer matches the verifier request.")}</p>
        </div>
    `;
}

function renderChainPanel(): string {
    const chainReady = isChainConfigured();
    const snapshot = state.chainSnapshot;
    const chainDisabled = !chainReady;

    return `
        <div class="chain-stage">
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
                ${renderButton("refresh-chain", {variant: "primary", disabled: chainDisabled})}
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
            ${!chainReady ? `
                <div class="empty-state">
                    <strong>Registry connection not configured</strong>
                    <p>Point the demo at local V2 contract addresses from <code>DeployV2.s.sol</code> to activate live anchor and status reads.</p>
                </div>
            ` : ""}
            ${chainReady && snapshot?.error ? `
                <div class="empty-state error">
                    <strong>Registry read failed</strong>
                    <p>${escapeHtml(snapshot.error)}</p>
                </div>
            ` : ""}
            ${chainReady && !snapshot ? `
                <div class="empty-state">
                    <strong>Chain state ready</strong>
                    <p>Use Refresh Chain State to read organization status, anchor comparison, revocation bitmap details, and current V2 status precedence.</p>
                </div>
            ` : ""}
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
    `;
}

function render(): void {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) throw new Error("Missing #app");

    const disclosedCount = state.scenario.policy.disclosedCount;
    const hiddenCount = state.scenario.policy.hiddenCount;
    const verificationPassed = state.verification?.checks.filter((check) => check.passed).length ?? 0;

    app.innerHTML = `
        <div class="page-shell">
            <header class="hero">
                <div class="hero-copy">
                    <p class="eyebrow">Protocol V2 browser capstone demo</p>
                    <h1>Cryptographic control room for premium university credentials</h1>
                    <p class="hero-text">
                        Issue, disclose, verify, and reconcile a university credential against Protocol V2 commitments without exposing hidden transcript data.
                    </p>
                    <div class="hero-actions">
                        ${renderButton("issue", {variant: "primary"})}
                        ${renderButton("match-policy", {variant: "secondary"})}
                        ${renderButton("verify", {variant: "ghost", disabled: !state.scenario.presentation})}
                    </div>
                </div>
                <aside class="hero-rail">
                    <div class="metric-block">
                        <span>Issuer organization</span>
                        <strong>${escapeHtml(DEMO_ORGANIZATION.name)}</strong>
                        <code>${escapeHtml(short(state.scenario.credential.issuerOrganizationId, 18, 12))}</code>
                    </div>
                    <div class="metric-strip">
                        <article>
                            <span>Credential digest</span>
                            <strong>${escapeHtml(short(state.scenario.credentialDigest, 16, 10))}</strong>
                        </article>
                        <article>
                            <span>Merkle root</span>
                            <strong>${escapeHtml(short(state.scenario.credential.merkleRoot, 16, 10))}</strong>
                        </article>
                        <article>
                            <span>Disclosure split</span>
                            <strong>${disclosedCount} shown / ${hiddenCount} hidden</strong>
                        </article>
                    </div>
                </aside>
            </header>

            ${state.notice ? `<div class="notice ${state.notice.kind}">${escapeHtml(state.notice.text)}</div>` : ""}
            ${state.busyLabel ? `<div class="status-line"><span></span>${escapeHtml(state.busyLabel)}</div>` : ""}

            <section class="workflow-band">
                <article><span>01</span><strong>Issue Credential</strong><p>University issuer signs an eight-claim academic record.</p></article>
                <article><span>02</span><strong>Selective Disclosure</strong><p>Holder reveals only the verifier-required facts.</p></article>
                <article><span>03</span><strong>Merkle Proof</strong><p>Disclosed leaves are proven against one credential root.</p></article>
                <article><span>04</span><strong>Verification</strong><p>Verifier checks audience, policy, signatures, and binding.</p></article>
                <article><span>05</span><strong>Registry V2</strong><p>Optional anchor comparison surfaces status, revocation, or issuer inactivity.</p></article>
            </section>

            <main class="content-grid">
                <section class="section issue">
                    <div class="section-head">
                        <div>
                            <h2>University-issued sample anchored to a single Merkle root</h2>
                        </div>
                        <span>V2 credential metadata and signatures</span>
                    </div>
                    <div class="issue-layout">
                        <div class="ledger-panel">
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
                                    <span>Claim count</span>
                                    <strong>${state.scenario.credential.claimCount}</strong>
                                </article>
                                <article>
                                    <span>Issued at</span>
                                    <strong>${escapeHtml(formatTimestamp(state.scenario.credential.issuedAt))}</strong>
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
                            <p>Selective Disclosure</p>
                            <h2>Exact policy matching, no over-sharing</h2>
                        </div>
                        <span>Required claims vs hidden transcript material</span>
                    </div>
                    <div class="disclosure-layout">
                        <div class="policy-panel">
                            <div class="policy-tags">
                                ${[...DEMO_REQUIRED_CLAIMS]
                                    .map((key) => `<span>${escapeHtml(key)}</span>`)
                                    .join("")}
                            </div>
                            ${renderPolicyWarnings()}
                            <div class="policy-metrics">
                                <article>
                                    <span>Selected</span>
                                    <strong>${disclosedCount}</strong>
                                </article>
                                <article>
                                    <span>Hidden</span>
                                    <strong>${hiddenCount}</strong>
                                </article>
                                <article>
                                    <span>Policy</span>
                                    <strong>${state.scenario.policy.exactMatch ? "Exact" : "Mismatch"}</strong>
                                </article>
                            </div>
                            <p class="support-text">
                                V2 requires the disclosed set to match the verifier request exactly. Extra transcript fields are rejected, and missing required fields block presentation creation.
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
                            <h2>Merkle proof inspection</h2>
                            <p class="section-deck">Each revealed claim carries its own inclusion path back to the credential root.</p>
                        </div>
                        <span>${state.scenario.presentation?.disclosed.length ?? 0} disclosed leaves available</span>
                    </div>
                    ${renderProofPanel()}
                </section>

                <section class="section verification">
                    <div class="section-head alt-head">
                        <div>
                            <h2>Verification checks</h2>
                            <p class="section-deck">Issuer signature, holder authorization, audience binding, and policy validation stay tied to the actual cryptographic output.</p>
                        </div>
                        <span>${verificationPassed} checks currently passing</span>
                    </div>
                    <div class="verification-layout">
                        <div class="binding-panel">
                            <article>
                                <span>Requested policy</span>
                                <strong>${escapeHtml(DEMO_REQUIRED_CLAIMS.join(", "))}</strong>
                            </article>
                            <article>
                                <span>Audience</span>
                                <strong>${escapeHtml(DEMO_AUDIENCE)}</strong>
                            </article>
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
                        </div>
                        <div class="verification-panel">
                            ${renderVerificationSummary()}
                        </div>
                    </div>
                </section>

                <section class="section chain">
                    <div class="section-head">
                        <div>
                            <h2>Anchor comparison, status precedence, revocation bitmap, issuer inactivity</h2>
                        </div>
                        <span>Primary path: app/src/core/v2 + app/src/chain/v2</span>
                    </div>
                    ${renderChainPanel()}
                </section>

                <section class="section privacy">
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
}

async function handleAction(action: string): Promise<void> {
    try {
        if (action === "issue") {
            synchronizeScenario(true);
            await runVerification();
            setNotice("ok", "A fresh V2 credential was issued locally with the same academic story and new timestamps.");
            render();
            return;
        }

        if (action === "match-policy") {
            state.selectedClaims = new Set(DEMO_REQUIRED_CLAIMS);
            synchronizeScenario();
            await runVerification();
            setNotice("ok", "Disclosure reset to the exact verifier-required claim set.");
            render();
            return;
        }

        if (action === "verify") {
            if (!state.scenario.presentation) {
                throw new Error(state.scenario.presentationError ?? "The disclosure must exactly match the verifier policy before verification can run.");
            }
            setBusy(action, "Running V2 verification checks across structure, signatures, policy, and Merkle proofs...");
            await runVerification();
            setNotice(state.verification?.valid ? "ok" : "bad", "V2 verification completed.");
            return;
        }

        ensureChainConfigured();

        const labels: Record<string, string> = {
            "refresh-chain": "Reading V2 organization state, anchor status, and revocation bitmap...",
            "register-org": "Registering the demo university on the V2 issuer registry...",
            anchor: "Anchoring the V2 credential with the issuer signing key...",
            revoke: "Revoking the anchored credential in the organization bitmap...",
            suspend: "Suspending the issuer organization to surface IssuerInactive status..."
        };

        setBusy(action, labels[action] ?? "Working...");

        if (action === "refresh-chain") {
            await refreshChainSnapshot();
            setNotice("ok", "Live V2 chain state refreshed.");
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
