/** Loads/saves the deployment ChainConfig that all CLIs share. */
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import type {ChainConfigV2} from "../chain/v2/types.js";
import type {ChainConfig} from "../core/types.js";
import {readJSON, writeJSON} from "./io.js";

const DEFAULT_PATH = resolve(process.cwd(), "data/chain.json");
const DEFAULT_V2_PATH = resolve(process.cwd(), "data/chain-v2.json");

export function chainConfigPath(): string {
    return process.env.CHAIN_CONFIG ?? DEFAULT_PATH;
}

export function loadChainConfig(): ChainConfig {
    const path = chainConfigPath();
    if (!existsSync(path)) {
        throw new Error(
            `Chain config not found at ${path}. Run \`npm run deploy:local\` first or set CHAIN_CONFIG.`,
        );
    }
    return readJSON<ChainConfig>(path);
}

export function saveChainConfig(cfg: ChainConfig): void {
    writeJSON(chainConfigPath(), cfg);
}

export interface ChainConfigV2File extends ChainConfigV2 {
    chainId: number;
    deployedAt: string;
}

export function chainConfigV2Path(): string {
    return process.env.CHAIN_CONFIG_V2 ?? DEFAULT_V2_PATH;
}

export function loadChainConfigV2(): ChainConfigV2File {
    const path = chainConfigV2Path();
    if (!existsSync(path)) {
        throw new Error(
            `V2 chain config not found at ${path}. Run \`npm run demo:v2-live\` or \`tsx src/scripts/deploy-v2-local.ts\` first.`,
        );
    }
    return readJSON<ChainConfigV2File>(path);
}

export function saveChainConfigV2(cfg: ChainConfigV2File): void {
    writeJSON(chainConfigV2Path(), cfg);
}
