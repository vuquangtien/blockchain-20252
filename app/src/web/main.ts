import "./styles.css";

import {Contract, JsonRpcProvider, Wallet, type Provider} from "ethers";
import {
    bytesToHex,
    createPresentation,
    credentialId,
    generateKeyPair,
    holderHash,
    issueCredential,
    keyPairFromPrivateKey,
    verifyPresentation,
    type Claim,
    type Credential,
    type Hex,
    type KeyPair,
    type Presentation,
    type VerificationResult,
} from "../core/index.js";
import {credentialRegistryAbi, issuerRegistryAbi, StatusEnum} from "../chain/abi.js";
import type {ChainView} from "../core/credential.js";

const ADMIN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const HUST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const sampleClaims: Array<Omit<Claim, "salt">> = [
    {key: "degree:field", value: {field: "Computer Science", level: "Bachelor", graduated: true}},
    {key: "degree:title", value: "Bachelor of Engineering - Computer Science"},
    {key: "graduation:year", value: 2026},
    {key: "course:CS101", value: {name: "Intro to CS", credits: 3, grade: "A", semester: "20241"}},
    {key: "course:MATH201", value: {name: "Calculus II", credits: 4, grade: "B+", semester: "20241"}},
    {key: "course:PH150", value: {name: "Physics I", credits: 3, grade: "A-", semester: "20242"}},
    {key: "course:EN101", value: {name: "Academic English", credits: 2, grade: "B", semester: "20242"}},
    {key: "gpa", value: {value: 3.65, scale: 4.0}},
    {key: "thesis", value: {title: "Selective Disclosure for Academic Credentials", grade: "A"}},
];

interface ChainInputs {
    rpcUrl: string;
    issuerRegistry: string;
    credentialRegistry: string;
}

interface AppState {
    issuerKey: KeyPair;
    holderKey: KeyPair;
    credential: Credential;
    presentation: Presentation;
    selectedClaims: Set<string>;
    nonce: Hex;
    offlineResult?: VerificationResult;
    chainResult?: VerificationResult;
    chainInputs: ChainInputs;
    busy?: string;
    notice?: {kind: "ok" | "warn" | "bad"; text: string};
}

const storedChain = JSON.parse(localStorage.getItem("credential-dapp-chain") ?? "{}") as Partial<ChainInputs>;
const state: AppState = {
    issuerKey: keyPairFromPrivateKey(HUST_KEY as Hex),
    holderKey: generateKeyPair(),
    selectedClaims: new Set(["degree:field", "gpa", "thesis"]),
    nonce: randomHex(32),
    chainInputs: {
        rpcUrl: storedChain.rpcUrl ?? "http://127.0.0.1:8545",
        issuerRegistry: storedChain.issuerRegistry ?? "",
        credentialRegistry: storedChain.credentialRegistry ?? "",
    },
} as AppState;

state.credential = issueSampleCredential();
state.presentation = presentSelectedClaims();

function issueSampleCredential(): Credential {
    return issueCredential({
        issuerKey: state.issuerKey,
        holder: "did:vn:hust:alice-2026",
        credentialType: "Bachelor of Engineering - Computer Science",
        schemaURI: "https://hust.edu.vn/schemas/academic-credential-v1.json",
        claims: sampleClaims,
        expiresAt: 0,
    });
}

function presentSelectedClaims(): Presentation {
    return createPresentation({
        credential: state.credential,
        disclose: [...state.selectedClaims],
        holderKey: state.holderKey,
        nonce: state.nonce,
    });
}

function randomHex(bytes: number): Hex {
    const raw = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(raw);
    return bytesToHex(raw);
}

function short(value: string, head = 10, tail = 6): string {
    if (!value) return "";
    return value.length <= head + tail ? value : `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function hiddenClaimCount(): number {
    return state.credential.claims.length - state.presentation.disclosed.length;
}

function setBusy(label?: string): void {
    state.busy = label;
    render();
}

function setNotice(kind: "ok" | "warn" | "bad", text: string): void {
    state.notice = {kind, text};
}

function saveChainInputs(): void {
    localStorage.setItem("credential-dapp-chain", JSON.stringify(state.chainInputs));
}

function getChainContracts(runner: Provider | Wallet): {issuer: Contract; credential: Contract} {
    const issuer = new Contract(state.chainInputs.issuerRegistry, issuerRegistryAbi, runner);
    const credential = new Contract(state.chainInputs.credentialRegistry, credentialRegistryAbi, runner);
    return {issuer, credential};
}

function requireChainInputs(): void {
    if (!state.chainInputs.issuerRegistry || !state.chainInputs.credentialRegistry) {
        throw new Error("Missing registry addresses");
    }
}

function chainView(provider: Provider): ChainView {
    const {issuer, credential} = getChainContracts(provider);
    return {
        async isAuthorizedIssuer(address) {
            return await issuer.isAuthorized(address);
        },
        async credentialAnchorStatus(id) {
            const code = Number(await credential.statusOf(id));
            if (code === StatusEnum.Unknown) return {status: "Unknown"};
            if (code === StatusEnum.Revoked) {
                return {status: "Revoked", reason: await credential.revocationReason(id)};
            }
            if (code === StatusEnum.Expired) return {status: "Expired"};
            const anchor = await credential.getAnchor(id);
            return {
                status: "Valid",
                merkleRoot: anchor.merkleRoot as Hex,
                issuedAt: Number(anchor.issuedAt),
                expiresAt: Number(anchor.expiresAt),
            };
        },
    };
}

async function runOfflineVerification(): Promise<void> {
    state.offlineResult = await verifyPresentation(state.presentation, {
        requireAnchor: false,
        requireHolderProof: true,
        expectedNonce: state.nonce,
    });
}

async function runChainVerification(): Promise<void> {
    requireChainInputs();
    const provider = new JsonRpcProvider(state.chainInputs.rpcUrl);
    state.chainResult = await verifyPresentation(state.presentation, {
        chain: chainView(provider),
        requireAnchor: true,
        requireHolderProof: true,
        expectedNonce: state.nonce,
    });
}

async function registerIssuerOnChain(): Promise<void> {
    requireChainInputs();
    const provider = new JsonRpcProvider(state.chainInputs.rpcUrl);
    const admin = new Wallet(ADMIN_KEY, provider);
    const {issuer} = getChainContracts(admin);
    if (await issuer.isAuthorized(state.issuerKey.address)) {
        setNotice("ok", "HUST issuer is already authorized on-chain.");
        return;
    }
    const tx = await issuer.registerIssuer(
        state.issuerKey.address,
        "Hanoi University of Science and Technology",
        "ipfs://hust-accreditation-demo",
    );
    await tx.wait();
    setNotice("ok", `Issuer registered in tx ${short(tx.hash)}`);
}

async function anchorCredentialOnChain(): Promise<void> {
    requireChainInputs();
    const provider = new JsonRpcProvider(state.chainInputs.rpcUrl);
    const hust = new Wallet(HUST_KEY, provider);
    const {credential} = getChainContracts(hust);
    const id = credentialId(state.credential);
    const status = Number(await credential.statusOf(id));
    if (status !== StatusEnum.Unknown) {
        setNotice("warn", `Credential status is ${["Unknown", "Valid", "Revoked", "Expired"][status]}.`);
        return;
    }
    const tx = await credential.anchorCredential(
        id,
        holderHash(state.credential.holder),
        state.credential.merkleRoot,
        state.credential.issuedAt,
        state.credential.expiresAt,
    );
    await tx.wait();
    setNotice("ok", `Credential anchored in tx ${short(tx.hash)}`);
}

async function revokeCredentialOnChain(): Promise<void> {
    requireChainInputs();
    const provider = new JsonRpcProvider(state.chainInputs.rpcUrl);
    const hust = new Wallet(HUST_KEY, provider);
    const {credential} = getChainContracts(hust);
    const tx = await credential.revokeCredential(credentialId(state.credential), "demo revocation");
    await tx.wait();
    setNotice("warn", `Credential revoked in tx ${short(tx.hash)}`);
}

function resultMarkup(result?: VerificationResult): string {
    if (!result) {
        return `<div class="empty">No verification run yet.</div>`;
    }
    return `
        <div class="verdict ${result.valid ? "valid" : "invalid"}">
            <span>${result.valid ? "VALID" : "INVALID"}</span>
            <strong>${result.checks.filter((c) => c.passed).length}/${result.checks.length}</strong>
        </div>
        <div class="checks">
            ${result.checks
                .map(
                    (check) => `
                    <div class="check ${check.passed ? "pass" : "fail"}">
                        <span class="dot"></span>
                        <div>
                            <strong>${check.name}</strong>
                            ${check.detail ? `<small>${check.detail}</small>` : ""}
                        </div>
                    </div>
                `,
                )
                .join("")}
        </div>`;
}

function renderMerklePath(): string {
    const first = state.presentation.disclosed[0];
    if (!first) return `<div class="empty">Select at least one claim.</div>`;

    return `
        <div class="path-head">
            <span>${first.claim.key}</span>
            <strong>${first.proof.length} proof steps</strong>
        </div>
        <div class="path">
            ${first.proof
                .map(
                    (sibling, idx) => `
                    <div class="path-step">
                        <span>${idx + 1}</span>
                        <code>${short(sibling, 12, 8)}</code>
                        <small>${first.positions[idx] ? "current right" : "current left"}</small>
                    </div>
                `,
                )
                .join("")}
        </div>`;
}

function renderClaimPicker(): string {
    return state.credential.claims
        .map((claim) => {
            const checked = state.selectedClaims.has(claim.key) ? "checked" : "";
            return `
                <label class="claim-option">
                    <input type="checkbox" data-claim="${claim.key}" ${checked} />
                    <span>
                        <strong>${claim.key}</strong>
                        <small>${JSON.stringify(claim.value)}</small>
                    </span>
                </label>`;
        })
        .join("");
}

function render(): void {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) throw new Error("Missing #app");

    const id = credentialId(state.credential);
    app.innerHTML = `
        <header class="topbar">
            <div>
                <p>Selective Disclosure Credential DApp</p>
                <h1>Academic credential verifier</h1>
            </div>
            <div class="identity-grid">
                <div><span>Issuer</span><code>${short(state.issuerKey.address)}</code></div>
                <div><span>Holder</span><code>${short(state.holderKey.address)}</code></div>
                <div><span>Credential</span><code>${short(id)}</code></div>
            </div>
        </header>

        ${state.notice ? `<div class="notice ${state.notice.kind}">${state.notice.text}</div>` : ""}

        <section class="metrics">
            <div><span>Merkle root</span><code>${short(state.credential.merkleRoot, 14, 10)}</code></div>
            <div><span>Disclosed claims</span><strong>${state.presentation.disclosed.length}</strong></div>
            <div><span>Hidden claims</span><strong>${hiddenClaimCount()}</strong></div>
            <div><span>Nonce</span><code>${short(state.nonce, 12, 8)}</code></div>
        </section>

        <section class="workspace">
            <article class="panel">
                <div class="panel-head">
                    <h2>Holder disclosure</h2>
                    <button data-action="issue">Issue fresh sample</button>
                </div>
                <div class="claim-list">${renderClaimPicker()}</div>
                <div class="button-row">
                    <button data-action="present">Create presentation</button>
                    <button data-action="nonce">New nonce</button>
                    <button data-action="holder">Rotate holder</button>
                </div>
            </article>

            <article class="panel">
                <div class="panel-head">
                    <h2>Merkle proof</h2>
                    <span>${state.presentation.disclosed.length} leaves revealed</span>
                </div>
                ${renderMerklePath()}
                <div class="payload">
                    <h3>Presentation JSON</h3>
                    <pre>${JSON.stringify(
                        {
                            credential: {
                                id: state.presentation.credential.id,
                                issuer: state.presentation.credential.issuer,
                                holder: state.presentation.credential.holder,
                                merkleRoot: state.presentation.credential.merkleRoot,
                            },
                            disclosed: state.presentation.disclosed.map((d) => d.claim.key),
                            holderProof: Boolean(state.presentation.holderProof),
                        },
                        null,
                        2,
                    )}</pre>
                </div>
            </article>

            <article class="panel">
                <div class="panel-head">
                    <h2>Verification</h2>
                    <button data-action="verify-offline">Verify offline</button>
                </div>
                ${resultMarkup(state.offlineResult)}
                <div class="chain-box">
                    <h3>Local chain</h3>
                    <label>RPC URL<input data-chain="rpcUrl" value="${state.chainInputs.rpcUrl}" /></label>
                    <label>IssuerRegistry<input data-chain="issuerRegistry" value="${state.chainInputs.issuerRegistry}" placeholder="0x..." /></label>
                    <label>CredentialRegistry<input data-chain="credentialRegistry" value="${state.chainInputs.credentialRegistry}" placeholder="0x..." /></label>
                    <div class="button-row">
                        <button data-action="register">Register issuer</button>
                        <button data-action="anchor">Anchor</button>
                        <button data-action="verify-chain">Verify chain</button>
                        <button data-action="revoke">Revoke</button>
                    </div>
                    ${resultMarkup(state.chainResult)}
                </div>
            </article>
        </section>

        ${state.busy ? `<div class="busy"><span></span>${state.busy}</div>` : ""}
    `;

    bindEvents(app);
}

function bindEvents(root: HTMLElement): void {
    root.querySelectorAll<HTMLInputElement>("[data-claim]").forEach((input) => {
        input.addEventListener("change", () => {
            const key = input.dataset.claim!;
            if (input.checked) state.selectedClaims.add(key);
            else state.selectedClaims.delete(key);
            state.presentation = presentSelectedClaims();
            state.offlineResult = undefined;
            state.chainResult = undefined;
            render();
        });
    });

    root.querySelectorAll<HTMLInputElement>("[data-chain]").forEach((input) => {
        input.addEventListener("change", () => {
            const key = input.dataset.chain as keyof ChainInputs;
            state.chainInputs[key] = input.value.trim();
            saveChainInputs();
        });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
        button.addEventListener("click", () => void handleAction(button.dataset.action!));
    });
}

async function handleAction(action: string): Promise<void> {
    try {
        if (action === "issue") {
            state.credential = issueSampleCredential();
            state.presentation = presentSelectedClaims();
            state.offlineResult = undefined;
            state.chainResult = undefined;
            setNotice("ok", "Fresh credential issued and signed locally.");
            render();
            return;
        }
        if (action === "present") {
            state.presentation = presentSelectedClaims();
            state.offlineResult = undefined;
            state.chainResult = undefined;
            setNotice("ok", "Selective presentation regenerated.");
            render();
            return;
        }
        if (action === "nonce") {
            state.nonce = randomHex(32);
            state.presentation = presentSelectedClaims();
            state.offlineResult = undefined;
            state.chainResult = undefined;
            setNotice("ok", "Verifier challenge nonce refreshed.");
            render();
            return;
        }
        if (action === "holder") {
            state.holderKey = generateKeyPair();
            state.presentation = presentSelectedClaims();
            state.offlineResult = undefined;
            state.chainResult = undefined;
            setNotice("ok", "Holder key rotated; previous holder proof no longer applies.");
            render();
            return;
        }

        const labels: Record<string, string> = {
            "verify-offline": "Verifying off-chain checks...",
            register: "Registering issuer...",
            anchor: "Anchoring credential...",
            "verify-chain": "Verifying against chain...",
            revoke: "Revoking credential...",
        };
        setBusy(labels[action] ?? "Working...");

        if (action === "verify-offline") {
            await runOfflineVerification();
            setNotice(state.offlineResult?.valid ? "ok" : "bad", "Offline verification finished.");
        } else if (action === "register") {
            await registerIssuerOnChain();
        } else if (action === "anchor") {
            await anchorCredentialOnChain();
            await runChainVerification();
        } else if (action === "verify-chain") {
            await runChainVerification();
            setNotice(state.chainResult?.valid ? "ok" : "bad", "On-chain verification finished.");
        } else if (action === "revoke") {
            await revokeCredentialOnChain();
            await runChainVerification();
        }
    } catch (err) {
        setNotice("bad", (err as Error).message);
    } finally {
        state.busy = undefined;
        render();
    }
}

void runOfflineVerification().then(render);
