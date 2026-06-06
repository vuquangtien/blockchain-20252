/**
 * Deploys the V2 issuer and credential registries to a local Anvil/Hardhat node and writes
 * the resulting addresses + RPC URL into `data/chain-v2.json` so the browser app and demo
 * runner can preload the live local configuration.
 *
 * Prerequisites:
 *   - `forge build` has been run in ../contracts (so the artifacts exist)
 *   - A local node is listening on RPC_URL (default http://127.0.0.1:8545)
 *   - DEPLOYER_KEY env var is set (default: anvil's first key)
 *
 * Usage:
 *   anvil &
 *   npm run deploy:v2-local
 */
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {ContractFactory, JsonRpcProvider, Wallet, type InterfaceAbi} from "ethers";
import {createDemoScenario, DEMO_IDENTITIES, DEMO_ORGANIZATION, DEMO_REQUIRED_CLAIMS} from "../util/v2Demo.js";
import {chainConfigV2Path, saveChainConfigV2} from "../util/config.js";

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
    const nonce0 = await provider.getTransactionCount(wallet.address, "pending");
    const demoScenario = createDemoScenario(DEMO_REQUIRED_CLAIMS);
    const initialValidFrom = Math.max(1, demoScenario.credential.issuedAt - 3600);

    console.log(`Deploying V2 registries from ${wallet.address} to chainId ${network.chainId} (${rpcUrl})`);

    const issuerArtifact = loadArtifact("IssuerRegistryV2");
    const credentialArtifact = loadArtifact("CredentialRegistryV2");

    const issuerFactory = new ContractFactory(issuerArtifact.abi, issuerArtifact.bytecode.object, wallet);
    const issuerRegistry = await issuerFactory.deploy(wallet.address, {nonce: nonce0});
    await issuerRegistry.waitForDeployment();
    const issuerRegistryV2 = await issuerRegistry.getAddress();
    console.log(`✓ IssuerRegistryV2 @ ${issuerRegistryV2}`);

    const credentialFactory = new ContractFactory(
        credentialArtifact.abi,
        credentialArtifact.bytecode.object,
        wallet
    );
    const credentialRegistry = await credentialFactory.deploy(issuerRegistryV2, {
        nonce: nonce0 + 1
    });
    await credentialRegistry.waitForDeployment();
    const credentialRegistryV2 = await credentialRegistry.getAddress();
    console.log(`✓ CredentialRegistryV2 @ ${credentialRegistryV2}`);

    const registerTx = await (issuerRegistry as any).registerOrganization(
        DEMO_ORGANIZATION.id,
        DEMO_ORGANIZATION.controllerAddress,
        DEMO_ORGANIZATION.name,
        DEMO_ORGANIZATION.metadataURI,
        DEMO_IDENTITIES.issuer.address,
        initialValidFrom,
        {nonce: nonce0 + 2}
    );
    await registerTx.wait();
    console.log(`✓ Registered ${DEMO_ORGANIZATION.name} with initial signing key ${DEMO_IDENTITIES.issuer.address}`);

    saveChainConfigV2({
        rpcUrl,
        chainId: Number(network.chainId),
        issuerRegistryV2: issuerRegistryV2 as `0x${string}`,
        credentialRegistryV2: credentialRegistryV2 as `0x${string}`,
        deployedAt: new Date().toISOString()
    });
    console.log(`✓ wrote ${chainConfigV2Path()}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
