/**
 * Thin ethers.js wrapper for talking to IssuerRegistry and CredentialRegistry.
 *
 * Read-only methods take a JsonRpcProvider; mutating methods require a Wallet.
 * The client also implements the `ChainView` interface so it can be plugged into
 * `verifyPresentation` directly.
 */

import {Contract, JsonRpcProvider, NonceManager, Wallet, type Provider} from "ethers";
import {credentialRegistryAbi, issuerRegistryAbi, StatusEnum} from "./abi.js";
import type {ChainConfig} from "../core/types.js";
import type {ChainView} from "../core/credential.js";
import type {Hex} from "../core/hash.js";

export class ChainClient implements ChainView {
    readonly provider: Provider;
    readonly issuerRegistry: Contract;
    readonly credentialRegistry: Contract;

    constructor(public readonly config: ChainConfig, signer?: Wallet) {
        this.provider = signer?.provider ?? new JsonRpcProvider(config.rpcUrl);
        // Wrap signer in NonceManager so multiple sequential mutations from the same
        // CLI invocation don't trip "nonce too low" — the wallet's internal counter
        // sometimes lags behind the chain in fast back-to-back sends.
        const runner = signer ? new NonceManager(signer) : this.provider;
        this.issuerRegistry = new Contract(config.issuerRegistry, issuerRegistryAbi, runner);
        this.credentialRegistry = new Contract(config.credentialRegistry, credentialRegistryAbi, runner);
    }

    static withWallet(config: ChainConfig, privateKey: string): ChainClient {
        const provider = new JsonRpcProvider(config.rpcUrl);
        const signer = new Wallet(privateKey, provider);
        return new ChainClient(config, signer);
    }

    // ───────── ChainView (verifier-facing reads) ─────────

    async isAuthorizedIssuer(address: `0x${string}`): Promise<boolean> {
        return await this.issuerRegistry.isAuthorized!(address);
    }

    async credentialAnchorStatus(
        credentialIdHex: Hex,
    ): Promise<
        | {status: "Unknown"}
        | {status: "Valid"; merkleRoot: Hex; issuedAt: number; expiresAt: number}
        | {status: "Revoked"; reason: string}
        | {status: "Expired"}
    > {
        const code: bigint = await this.credentialRegistry.statusOf!(credentialIdHex);
        const status = Number(code);
        if (status === StatusEnum.Unknown) return {status: "Unknown"};
        if (status === StatusEnum.Revoked) {
            const reason: string = await this.credentialRegistry.revocationReason!(credentialIdHex);
            return {status: "Revoked", reason};
        }
        if (status === StatusEnum.Expired) return {status: "Expired"};
        const anchor = await this.credentialRegistry.getAnchor!(credentialIdHex);
        return {
            status: "Valid",
            merkleRoot: anchor.merkleRoot as Hex,
            issuedAt: Number(anchor.issuedAt),
            expiresAt: Number(anchor.expiresAt),
        };
    }

    // ───────── Admin / Issuer mutating calls ─────────

    async registerIssuer(issuer: `0x${string}`, name: string, metadataURI = ""): Promise<string> {
        const tx = await this.issuerRegistry.registerIssuer!(issuer, name, metadataURI);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async revokeIssuer(issuer: `0x${string}`, reason: string): Promise<string> {
        const tx = await this.issuerRegistry.revokeIssuer!(issuer, reason);
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async anchorCredential(args: {
        credentialId: Hex;
        holderHash: Hex;
        merkleRoot: Hex;
        issuedAt: number;
        expiresAt: number;
    }): Promise<string> {
        const tx = await this.credentialRegistry.anchorCredential!(
            args.credentialId,
            args.holderHash,
            args.merkleRoot,
            args.issuedAt,
            args.expiresAt,
        );
        const receipt = await tx.wait();
        return receipt.hash;
    }

    async revokeCredential(credentialId: Hex, reason: string): Promise<string> {
        const tx = await this.credentialRegistry.revokeCredential!(credentialId, reason);
        const receipt = await tx.wait();
        return receipt.hash;
    }
}
