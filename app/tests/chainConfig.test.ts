import {describe, expect, it} from "vitest";

import {
    buildLiveDemoUrl,
    getProductModeLabel,
    resolveChainInputs
} from "../src/web/chainConfig.js";
import {DEFAULT_UI_TOGGLES} from "../src/web/uiState.js";

describe("Chain config loading", () => {
    it("resolves chain inputs with query params, local storage, generated config, then defaults", () => {
        const resolved = resolveChainInputs({
            query: {
                rpcUrl: "http://127.0.0.1:9545"
            },
            stored: {
                issuerRegistryV2: "0x1111111111111111111111111111111111111111"
            },
            generated: {
                rpcUrl: "http://127.0.0.1:8545",
                issuerRegistryV2: "0x2222222222222222222222222222222222222222",
                credentialRegistryV2: "0x3333333333333333333333333333333333333333"
            }
        });

        expect(resolved.inputs).toEqual({
            rpcUrl: "http://127.0.0.1:9545",
            issuerRegistryV2: "0x1111111111111111111111111111111111111111",
            credentialRegistryV2: "0x3333333333333333333333333333333333333333"
        });
        expect(resolved.source).toBe("query");
    });

    it("builds the live product URL with encoded query params", () => {
        const url = buildLiveDemoUrl("http://localhost:5176/", {
            rpcUrl: "http://127.0.0.1:8545",
            issuerRegistryV2: "0x1111111111111111111111111111111111111111",
            credentialRegistryV2: "0x2222222222222222222222222222222222222222"
        });

        expect(url).toBe(
            "http://localhost:5176/?rpcUrl=http%3A%2F%2F127.0.0.1%3A8545&issuerRegistryV2=0x1111111111111111111111111111111111111111&credentialRegistryV2=0x2222222222222222222222222222222222222222"
        );
    });

    it("switches the dashboard between sample mode and live local mode", () => {
        expect(
            getProductModeLabel({
                rpcUrl: "",
                issuerRegistryV2: "",
                credentialRegistryV2: ""
            })
        ).toBe("Sample mode");
        expect(
            getProductModeLabel({
                rpcUrl: "http://127.0.0.1:8545",
                issuerRegistryV2: "0x1111111111111111111111111111111111111111",
                credentialRegistryV2: "0x2222222222222222222222222222222222222222"
            })
        ).toBe("Live local mode");
    });

    it("keeps advanced evidence hidden by default", () => {
        expect(DEFAULT_UI_TOGGLES.showMerkleInternals).toBe(false);
        expect(DEFAULT_UI_TOGGLES.showAdvancedChain).toBe(false);
    });
});
