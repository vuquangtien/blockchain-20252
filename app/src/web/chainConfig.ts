import type {ChainConfigV2File} from "../util/config.js";

export interface ChainInputs {
    rpcUrl: string;
    issuerRegistryV2: string;
    credentialRegistryV2: string;
}

export type ChainConfigSource = "query" | "localStorage" | "generated" | "empty";

export interface ResolvedChainInputs {
    inputs: ChainInputs;
    source: ChainConfigSource;
}

export const DEFAULT_CHAIN_INPUTS: ChainInputs = {
    rpcUrl: "",
    issuerRegistryV2: "",
    credentialRegistryV2: ""
};

const CHAIN_FIELDS: (keyof ChainInputs)[] = [
    "rpcUrl",
    "issuerRegistryV2",
    "credentialRegistryV2"
];

const GENERATED_CHAIN_CONFIG_PATHS = ["/chain-v2.json", "/data/chain-v2.json"] as const;

function normalizeValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export function pickChainInputs(value: Partial<ChainInputs> | null | undefined): Partial<ChainInputs> {
    if (!value) return {};
    return {
        rpcUrl: normalizeValue(value.rpcUrl),
        issuerRegistryV2: normalizeValue(value.issuerRegistryV2),
        credentialRegistryV2: normalizeValue(value.credentialRegistryV2)
    };
}

function hasAnyValue(value: Partial<ChainInputs> | undefined): boolean {
    return Boolean(
        value
        && (value.rpcUrl || value.issuerRegistryV2 || value.credentialRegistryV2)
    );
}

function firstNonEmpty(...values: Array<string | undefined>): string {
    for (const value of values) {
        if (value && value.trim()) return value.trim();
    }
    return "";
}

export function resolveChainInputs(options: {
    query?: Partial<ChainInputs>;
    stored?: Partial<ChainInputs>;
    generated?: Partial<ChainInputs>;
}): ResolvedChainInputs {
    const query = pickChainInputs(options.query);
    const stored = pickChainInputs(options.stored);
    const generated = pickChainInputs(options.generated);

    const inputs: ChainInputs = {
        rpcUrl: firstNonEmpty(query.rpcUrl, stored.rpcUrl, generated.rpcUrl, DEFAULT_CHAIN_INPUTS.rpcUrl),
        issuerRegistryV2: firstNonEmpty(
            query.issuerRegistryV2,
            stored.issuerRegistryV2,
            generated.issuerRegistryV2
        ),
        credentialRegistryV2: firstNonEmpty(
            query.credentialRegistryV2,
            stored.credentialRegistryV2,
            generated.credentialRegistryV2
        )
    };

    const source: ChainConfigSource = hasAnyValue(query)
        ? "query"
        : hasAnyValue(stored)
            ? "localStorage"
            : hasAnyValue(generated)
                ? "generated"
                : "empty";

    return {inputs, source};
}

export function getProductModeLabel(inputs: ChainInputs): "Live local mode" | "Sample mode" {
    return Boolean(inputs.rpcUrl && inputs.issuerRegistryV2 && inputs.credentialRegistryV2)
        ? "Live local mode"
        : "Sample mode";
}

export function buildLiveDemoUrl(baseUrl: string, inputs: ChainInputs): string {
    const url = new URL(baseUrl);
    for (const field of CHAIN_FIELDS) {
        if (inputs[field]) url.searchParams.set(field, inputs[field]);
    }
    return url.toString();
}

export async function loadGeneratedChainInputs(): Promise<Partial<ChainInputs> | undefined> {
    for (const path of GENERATED_CHAIN_CONFIG_PATHS) {
        try {
            const response = await fetch(`${path}?t=${Date.now()}`);
            if (!response.ok) continue;
            const json = (await response.json()) as Partial<ChainConfigV2File>;
            const inputs = pickChainInputs(json);
            if (hasAnyValue(inputs)) return inputs;
        } catch {
            continue;
        }
    }

    return undefined;
}
