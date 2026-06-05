/**
 * ChainClientV2 — thin ethers.js wrapper for IssuerRegistryV2 and CredentialRegistryV2.
 *
 * Design decisions:
 *   - Read-only methods accept a JsonRpcProvider; mutating methods require a Wallet.
 *   - Implements ChainViewV2, a minimal interface that can be plugged directly into
 *     on-chain-aware credential verification logic.
 *   - NonceManager wraps the signer for safe sequential mutations from the same process.
 *   - V2 uses bytes32 organization IDs everywhere instead of issuer addresses (V1).
 */

import {Contract, JsonRpcProvider, NonceManager, Wallet, type Provider} from "ethers";
import {credentialRegistryV2Abi, issuerRegistryV2Abi, StatusV2Enum, type StatusV2} from "./abi.js";
import type {Hex} from "../../core/hash.js";

// ─────────────────────────── Configuration ──────────────────────────────────

/** Chain connection config extended for V2 contract addresses. */
export interface ChainConfigV2 {
    rpcUrl: string;
    issuerRegistryV2: string; // deployed IssuerRegistryV2 address
    credentialRegistryV2: string; // deployed CredentialRegistryV2 address
}

// ─────────────────────────── Types ──────────────────────────────────────────

/** Decoded on-chain organization record. */
export interface OrganizationV2 {
    controller: string;
    pendingController: string;
    name: string;
    metadataURI: string;
    registeredAt: number;
    suspendedAt: number; // 0 if active
    currentEpoch: number;
    active: boolean;
}

/** Decoded on-chain signing-key record. */
export interface SigningKeyRecord {
    organizationId: string;
    epoch: number;
    validFrom: number;
    validUntil: number; // 0 = not individually revoked
    exists: boolean;
}

/** Decoded on-chain credential anchor (V2). */
export interface AnchorV2Record {
    orgId: string;
    signer: string;
    credentialDigest: Hex;
    holderCommitment: Hex;
    issuedAt: number;
    expiresAt: number;
    anchoredAt: number;
    revocationIndex: bigint;
    exists: boolean;
}

// ─────────────────────────── ChainViewV2 interface ───────────────────────────

/**
 * Minimal read-only interface for on-chain-aware V2 credential verification.
 * Implement this against ChainClientV2 or a mock for testing.
 */
export interface ChainViewV2 {
    /** Returns true if `key` was an authorized signer for `orgId` at timestamp `at`. */
    wasAuthorizedAt(orgId: Hex, key: Hex, at: number): Promise<boolean>;
    /** Returns true if the organization is currently active. */
    isOrganizationActive(orgId: Hex): Promise<boolean>;
    /**
     * Returns the on-chain status of a credential.
     * `Unknown` means never anchored (off-chain signature may still be valid).
     */
    credentialAnchorStatusV2(credentialId: Hex): Promise<
        | {status: "Unknown"}
        | {status: "Valid"; credentialDigest: Hex; issuedAt: number; expiresAt: number}
        | {status: "Revoked"; revocationIndex: bigint}
        | {status: "Expired"}
    >;
    /** Returns true if the revocation bit at `index` is set. */
    isRevokedByIndex(index: bigint): Promise<boolean>;
}

// ─────────────────────────── ChainClientV2 ──────────────────────────────────

export class ChainClientV2 implements ChainViewV2 {
    readonly provider: Provider;
    readonly issuerRegistry: Contract;
    readonly credentialRegistry: Contract;

    constructor(public readonly config: ChainConfigV2, signer?: Wallet) {
        this.provider = signer?.provider ?? new JsonRpcProvider(config.rpcUrl);
        const runner = signer ? new NonceManager(signer) : this.provider;
        this.issuerRegistry = new Contract(config.issuerRegistryV2, issuerRegistryV2Abi, runner);
        this.credentialRegistry = new Contract(
            config.credentialRegistryV2, credentialRegistryV2Abi, runner
        );
    }

    static withWallet(config: ChainConfigV2, privateKey: string): ChainClientV2 {
        const provider = new JsonRpcProvider(config.rpcUrl);
        const signer = new Wallet(privateKey, provider);
        return new ChainClientV2(config, signer);
    }

    // ───────── ChainViewV2 (verifier-facing reads) ────────────────────────

    async wasAuthorizedAt(orgId: Hex, key: Hex, at: number): Promise<boolean> {
        return await this.issuerRegistry.wasAuthorizedAt!(orgId, key, at);
    }

    async isOrganizationActive(orgId: Hex): Promise<boolean> {
        return await this.issuerRegistry.isOrganizationActive!(orgId);
    }

    async credentialAnchorStatusV2(credentialId: Hex): Promise<
        | {status: "Unknown"}
        | {status: "Valid"; credentialDigest: Hex; issuedAt: number; expiresAt: number}
        | {status: "Revoked"; revocationIndex: bigint}
        | {status: "Expired"}
    > {
        const code: bigint = await this.credentialRegistry.statusOfV2!(credentialId);
        const status = Number(code);
        if (status === StatusV2Enum.Unknown) return {status: "Unknown"};
        if (status === StatusV2Enum.Revoked) {
            const anchor = await this.credentialRegistry.getAnchorV2!(credentialId);
            return {status: "Revoked", revocationIndex: anchor.revocationIndex as bigint};
        }
        if (status === StatusV2Enum.Expired) return {status: "Expired"};
        const anchor = await this.credentialRegistry.getAnchorV2!(credentialId);
        return {
            status: "Valid",
            credentialDigest: anchor.credentialDigest as Hex,
            issuedAt: Number(anchor.issuedAt),
            expiresAt: Number(anchor.expiresAt),
        };
    }

    async isRevokedByIndex(index: bigint): Promise<boolean> {
        return await this.credentialRegistry.isRevokedByIndex!(index);
    }

    // ───────── Admin (owner) mutating calls ──────────────────────────────

    async registerOrganization(args: {
        orgId: Hex;
        controller: Hex;
        initialKey: Hex;
        keyValidFrom: number;
        name: string;
        metadataURI?: string;
    }): Promise<string> {
        const tx = await this.issuerRegistry.registerOrganization!(
            args.orgId, args.controller, args.initialKey,
            args.keyValidFrom, args.name, args.metadataURI ?? ""
        );
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async suspendOrganization(orgId: Hex, reason: string): Promise<string> {
        const tx = await this.issuerRegistry.suspendOrganization!(orgId, reason);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async reinstateOrganization(orgId: Hex, initialKey: Hex, keyValidFrom: number): Promise<string> {
        const tx = await this.issuerRegistry.reinstateOrganization!(orgId, initialKey, keyValidFrom);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    // ───────── Controller mutating calls ─────────────────────────────────

    async addSigningKey(orgId: Hex, key: Hex, validFrom: number): Promise<string> {
        const tx = await this.issuerRegistry.addSigningKey!(orgId, key, validFrom);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async revokeSigningKey(orgId: Hex, key: Hex): Promise<string> {
        const tx = await this.issuerRegistry.revokeSigningKey!(orgId, key);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async proposeControllerTransfer(orgId: Hex, newController: Hex): Promise<string> {
        const tx = await this.issuerRegistry.proposeControllerTransfer!(orgId, newController);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async acceptControllerTransfer(orgId: Hex): Promise<string> {
        const tx = await this.issuerRegistry.acceptControllerTransfer!(orgId);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    // ───────── Issuer (signer) mutating calls ────────────────────────────

    async anchorCredentialV2(args: {
        credentialId: Hex;
        orgId: Hex;
        credentialDigest: Hex;
        holderCommitment: Hex;
        issuedAt: number;
        expiresAt: number;
    }): Promise<string> {
        const tx = await this.credentialRegistry.anchorCredentialV2!(
            args.credentialId, args.orgId, args.credentialDigest,
            args.holderCommitment, args.issuedAt, args.expiresAt
        );
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async revokeCredentialV2(credentialId: Hex): Promise<string> {
        const tx = await this.credentialRegistry.revokeCredentialV2!(credentialId);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    // ───────── Convenience reads ──────────────────────────────────────────

    async getOrganization(orgId: Hex): Promise<OrganizationV2> {
        const raw = await this.issuerRegistry.getOrganization!(orgId);
        return {
            controller: raw.controller as string,
            pendingController: raw.pendingController as string,
            name: raw.name as string,
            metadataURI: raw.metadataURI as string,
            registeredAt: Number(raw.registeredAt),
            suspendedAt: Number(raw.suspendedAt),
            currentEpoch: Number(raw.currentEpoch),
            active: raw.active as boolean,
        };
    }

    async getSigningKey(key: Hex): Promise<SigningKeyRecord> {
        const raw = await this.issuerRegistry.getSigningKey!(key);
        return {
            organizationId: raw.organizationId as string,
            epoch: Number(raw.epoch),
            validFrom: Number(raw.validFrom),
            validUntil: Number(raw.validUntil),
            exists: raw.exists as boolean,
        };
    }

    async getAnchorV2(credentialId: Hex): Promise<AnchorV2Record> {
        const raw = await this.credentialRegistry.getAnchorV2!(credentialId);
        return {
            orgId: raw.orgId as Hex,
            signer: raw.signer as string,
            credentialDigest: raw.credentialDigest as Hex,
            holderCommitment: raw.holderCommitment as Hex,
            issuedAt: Number(raw.issuedAt),
            expiresAt: Number(raw.expiresAt),
            anchoredAt: Number(raw.anchoredAt),
            revocationIndex: raw.revocationIndex as bigint,
            exists: raw.exists as boolean,
        };
    }
}
