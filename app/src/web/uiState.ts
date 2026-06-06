export interface UiToggles {
    showHeroTechnical: boolean;
    showCredentialDetails: boolean;
    showRawClaims: boolean;
    showAdvancedVerification: boolean;
    showMerkleInternals: boolean;
    showAdvancedChain: boolean;
}

export const DEFAULT_UI_TOGGLES: UiToggles = {
    showHeroTechnical: false,
    showCredentialDetails: false,
    showRawClaims: false,
    showAdvancedVerification: false,
    showMerkleInternals: false,
    showAdvancedChain: false
};
