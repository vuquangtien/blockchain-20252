/** Loads/saves the deployment ChainConfig that all CLIs share. */
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import type {ChainConfig} from "../core/types.js";
import {readJSON, writeJSON} from "./io.js";

const DEFAULT_PATH = resolve(process.cwd(), "data/chain.json");

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
