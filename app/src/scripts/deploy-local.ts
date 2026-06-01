/**
 * Deploys IssuerRegistry + CredentialRegistry to a local Anvil/Hardhat node and writes
 * the resulting addresses + RPC URL into `data/chain.json` so the CLIs can find them.
 *
 * Prerequisites:
 *   - `forge build` has been run in ../contracts (so the artifacts exist)
 *   - A local node is listening on RPC_URL (default http://127.0.0.1:8545)
 *   - DEPLOYER_KEY env var is set (default: anvil's first key)
 *
 * Usage:
 *   anvil &           # starts local node
 *   npm run deploy:local
 */
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {Wallet, JsonRpcProvider, ContractFactory, type InterfaceAbi} from "ethers";
import {saveChainConfig} from "../util/config.js";
import type {ChainConfig} from "../core/types.js";

const DEFAULT_DEPLOYER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil[0]
const DEFAULT_RPC = "http://127.0.0.1:8545";

interface ForgeArtifact {
    abi: InterfaceAbi;
    bytecode: {object: string};
}

function loadArtifact(name: string): ForgeArtifact {
    const path = resolve(process.cwd(), `../contracts/out/${name}.sol/${name}.json`);
    if (!existsSync(path)) {
        throw new Error(`Forge artifact not found at ${path}. Run \`forge build\` in ../contracts first.`);
    }
    return JSON.parse(readFileSync(path, "utf8"));
}

async function main(): Promise<void> {
    const rpcUrl = process.env.RPC_URL ?? DEFAULT_RPC;
    const privateKey = process.env.DEPLOYER_KEY ?? DEFAULT_DEPLOYER;

    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(privateKey, provider);
    const network = await provider.getNetwork();

    console.log(`Deploying from ${wallet.address} to chainId ${network.chainId} (${rpcUrl})`);

    const issuerArtifact = loadArtifact("IssuerRegistry");
    const credArtifact = loadArtifact("CredentialRegistry");

    const issuerFactory = new ContractFactory(issuerArtifact.abi, issuerArtifact.bytecode.object, wallet);
    const issuerRegistry = await issuerFactory.deploy(wallet.address);
    await issuerRegistry.waitForDeployment();
    const issuerAddr = await issuerRegistry.getAddress();
    console.log(`✓ IssuerRegistry @ ${issuerAddr}`);

    const credFactory = new ContractFactory(credArtifact.abi, credArtifact.bytecode.object, wallet);
    const credentialRegistry = await credFactory.deploy(issuerAddr);
    await credentialRegistry.waitForDeployment();
    const credAddr = await credentialRegistry.getAddress();
    console.log(`✓ CredentialRegistry @ ${credAddr}`);

    const cfg: ChainConfig = {
        rpcUrl,
        chainId: Number(network.chainId),
        issuerRegistry: issuerAddr as `0x${string}`,
        credentialRegistry: credAddr as `0x${string}`,
    };
    saveChainConfig(cfg);
    console.log(`✓ wrote ${process.env.CHAIN_CONFIG ?? "data/chain.json"}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
