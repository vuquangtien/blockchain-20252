import {Contract, JsonRpcProvider, NonceManager, Wallet, type Provider} from "ethers";
import {credentialRegistryV2Abi, issuerRegistryV2Abi, StatusV2Enum} from "./abi.js";
import type {Hex} from "../../core/hash.js";
import type {
    AnchorStatusNameV2,
    AnchorV2Record,
    ChainConfigV2,
    OrganizationV2,
    SigningKeyRecord
} from "./types.js";

export interface ChainViewV2 {
    wasAuthorizedKeyAt(orgId: Hex, key: `0x${string}`, at: number): Promise<boolean>;
    isOrganizationActive(orgId: Hex): Promise<boolean>;
    credentialAnchorStatusV2(
        orgId: Hex,
        signer: `0x${string}`,
        credentialId: Hex
    ): Promise<
        | {status: Extract<AnchorStatusNameV2, "Unknown">}
        | {
            status: Extract<AnchorStatusNameV2, "Valid">;
            credentialDigest: Hex;
            merkleRoot: Hex;
            issuedAt: number;
            expiresAt: number;
        }
        | {status: Extract<AnchorStatusNameV2, "Revoked">; revocationIndex: bigint}
        | {status: Extract<AnchorStatusNameV2, "Expired">}
        | {status: Extract<AnchorStatusNameV2, "IssuerInactive">}
    >;
}

export class ChainClientV2 implements ChainViewV2 {
    readonly provider: Provider;
    readonly issuerRegistry: Contract;
    readonly credentialRegistry: Contract;

    constructor(public readonly config: ChainConfigV2, signer?: Wallet) {
        this.provider = signer?.provider ?? new JsonRpcProvider(config.rpcUrl);
        const runner = signer ? new NonceManager(signer) : this.provider;
        this.issuerRegistry = new Contract(config.issuerRegistryV2, issuerRegistryV2Abi, runner);
        this.credentialRegistry = new Contract(
            config.credentialRegistryV2,
            credentialRegistryV2Abi,
            runner
        );
    }

    static withWallet(config: ChainConfigV2, privateKey: string): ChainClientV2 {
        const provider = new JsonRpcProvider(config.rpcUrl);
        return new ChainClientV2(config, new Wallet(privateKey, provider));
    }

    async wasAuthorizedKeyAt(orgId: Hex, key: `0x${string}`, at: number): Promise<boolean> {
        return await this.issuerRegistry.wasAuthorizedKeyAt!(orgId, key, at);
    }

    async isOrganizationActive(orgId: Hex): Promise<boolean> {
        return await this.issuerRegistry.isOrganizationActive!(orgId);
    }

    async credentialAnchorStatusV2(
        orgId: Hex,
        signer: `0x${string}`,
        credentialId: Hex
    ): Promise<
        | {status: "Unknown"}
        | {status: "Valid"; credentialDigest: Hex; merkleRoot: Hex; issuedAt: number; expiresAt: number}
        | {status: "Revoked"; revocationIndex: bigint}
        | {status: "Expired"}
        | {status: "IssuerInactive"}
    > {
        const code: bigint = await this.credentialRegistry.statusOf!(orgId, signer, credentialId);
        const status = Number(code);
        if (status === StatusV2Enum.Unknown) return {status: "Unknown"};
        if (status === StatusV2Enum.Expired) return {status: "Expired"};
        if (status === StatusV2Enum.IssuerInactive) return {status: "IssuerInactive"};

        const anchor = await this.credentialRegistry.getAnchor!(orgId, signer, credentialId);
        if (status === StatusV2Enum.Revoked) {
            return {status: "Revoked", revocationIndex: anchor.revocationIndex as bigint};
        }

        return {
            status: "Valid",
            credentialDigest: anchor.credentialDigest as Hex,
            merkleRoot: anchor.merkleRoot as Hex,
            issuedAt: Number(anchor.issuedAt),
            expiresAt: Number(anchor.expiresAt)
        };
    }

    async statusOf(
        organizationId: Hex,
        issuerSigningAddress: `0x${string}`,
        credentialId: Hex
    ): Promise<AnchorStatusNameV2> {
        const code: bigint = await this.credentialRegistry.statusOf!(
            organizationId,
            issuerSigningAddress,
            credentialId
        );
        switch (Number(code)) {
            case StatusV2Enum.Unknown:
                return "Unknown";
            case StatusV2Enum.Valid:
                return "Valid";
            case StatusV2Enum.Revoked:
                return "Revoked";
            case StatusV2Enum.Expired:
                return "Expired";
            case StatusV2Enum.IssuerInactive:
                return "IssuerInactive";
            default:
                throw new Error(`Unknown V2 status code: ${code.toString()}`);
        }
    }

    async isRevoked(
        organizationId: Hex,
        issuerSigningAddress: `0x${string}`,
        credentialId: Hex
    ): Promise<boolean> {
        return await this.credentialRegistry.isRevoked!(
            organizationId,
            issuerSigningAddress,
            credentialId
        );
    }

    async revocationWord(organizationId: Hex, wordIndex: bigint): Promise<bigint> {
        return await this.credentialRegistry.revocationWord!(organizationId, wordIndex);
    }

    async nextRevocationIndex(organizationId: Hex): Promise<number> {
        const nextIndex: bigint = await this.credentialRegistry.nextRevocationIndex!(
            organizationId
        );
        return Number(nextIndex);
    }

    async registerOrganization(args: {
        organizationId: Hex;
        controller: `0x${string}`;
        name: string;
        metadataURI?: string;
        initialSigningKey: `0x${string}`;
        initialValidFrom: number;
    }): Promise<string> {
        const tx = await this.issuerRegistry.registerOrganization!(
            args.organizationId,
            args.controller,
            args.name,
            args.metadataURI ?? "",
            args.initialSigningKey,
            args.initialValidFrom
        );
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async updateOrganization(
        organizationId: Hex,
        name: string,
        metadataURI = ""
    ): Promise<string> {
        const tx = await this.issuerRegistry.updateOrganization!(organizationId, name, metadataURI);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async proposeControllerTransfer(
        organizationId: Hex,
        newController: `0x${string}`
    ): Promise<string> {
        const tx = await this.issuerRegistry.proposeControllerTransfer!(
            organizationId,
            newController
        );
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async acceptControllerTransfer(organizationId: Hex): Promise<string> {
        const tx = await this.issuerRegistry.acceptControllerTransfer!(organizationId);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async addSigningKey(
        organizationId: Hex,
        signingKey: `0x${string}`,
        validFrom: number
    ): Promise<string> {
        const tx = await this.issuerRegistry.addSigningKey!(organizationId, signingKey, validFrom);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async revokeSigningKey(organizationId: Hex, signingKey: `0x${string}`): Promise<string> {
        const tx = await this.issuerRegistry.revokeSigningKey!(organizationId, signingKey);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async suspendOrganization(organizationId: Hex): Promise<string> {
        const tx = await this.issuerRegistry.suspendOrganization!(organizationId);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async reinstateOrganization(
        organizationId: Hex,
        initialSigningKey: `0x${string}`,
        initialValidFrom: number
    ): Promise<string> {
        const tx = await this.issuerRegistry.reinstateOrganization!(
            organizationId,
            initialSigningKey,
            initialValidFrom
        );
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async anchorCredential(args: {
        organizationId: Hex;
        credentialId: Hex;
        credentialDigest: Hex;
        holderCommitment: Hex;
        merkleRoot: Hex;
        issuedAt: number;
        expiresAt: number;
        claimCount: number;
    }): Promise<string> {
        const tx = await this.credentialRegistry.anchorCredential!(
            args.organizationId,
            args.credentialId,
            args.credentialDigest,
            args.holderCommitment,
            args.merkleRoot,
            args.issuedAt,
            args.expiresAt,
            args.claimCount
        );
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async revokeCredential(
        organizationId: Hex,
        issuerSigningAddress: `0x${string}`,
        credentialId: Hex,
        reasonHash: Hex
    ): Promise<string> {
        const tx = await this.credentialRegistry.revokeCredential!(
            organizationId,
            issuerSigningAddress,
            credentialId,
            reasonHash
        );
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async getOrganization(organizationId: Hex): Promise<OrganizationV2> {
        const raw = await this.issuerRegistry.getOrganization!(organizationId);
        return {
            controller: raw.controller as string,
            pendingController: raw.pendingController as string,
            name: raw.name as string,
            metadataURI: raw.metadataURI as string,
            registeredAt: Number(raw.registeredAt),
            suspendedAt: Number(raw.suspendedAt),
            currentEpoch: Number(raw.currentEpoch),
            active: raw.active as boolean
        };
    }

    async getSigningKey(signingKey: `0x${string}`): Promise<SigningKeyRecord> {
        const raw = await this.issuerRegistry.getSigningKey!(signingKey);
        return {
            organizationId: raw.organizationId as string,
            epoch: Number(raw.epoch),
            validFrom: Number(raw.validFrom),
            validUntil: Number(raw.validUntil),
            exists: raw.exists as boolean
        };
    }

    async getAnchor(
        organizationId: Hex,
        issuerSigningAddress: `0x${string}`,
        credentialId: Hex
    ): Promise<AnchorV2Record> {
        const raw = await this.credentialRegistry.getAnchor!(
            organizationId,
            issuerSigningAddress,
            credentialId
        );
        return {
            credentialDigest: raw.credentialDigest as Hex,
            merkleRoot: raw.merkleRoot as Hex,
            holderCommitment: raw.holderCommitment as Hex,
            organizationId: raw.organizationId as Hex,
            issuerSigningAddress: raw.issuerSigningAddress as string,
            issuedAt: Number(raw.issuedAt),
            expiresAt: Number(raw.expiresAt),
            revocationIndex: raw.revocationIndex as bigint,
            claimCount: Number(raw.claimCount),
            exists: raw.exists as boolean
        };
    }
}
