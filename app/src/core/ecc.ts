/**
 * ECC signing / verification using secp256k1 (the curve Ethereum uses).
 *
 * Why secp256k1?
 *   - Ethereum natively supports it via `ecrecover`. The same private key serves both as
 *     the issuer's wallet (for sending on-chain registry transactions) and as their
 *     credential-signing key — no separate key management required.
 *   - Public keys and addresses are interchangeable on-chain, so the IssuerRegistry can
 *     identify issuers by their Ethereum address, and verifiers can recover the signer
 *     from a signature alone.
 *
 * Signing format:
 *   - Message = canonical JSON of the credential (without the `signature` field).
 *   - Digest  = keccak256(EthereumSignedMessage \n <len> ‖ keccak256(message)) — the
 *               EIP-191 "personal_sign" wrapper. We wrap the inner keccak so users can
 *               also verify with familiar wallet tools (MetaMask `personal_sign`).
 *   - Signature = 65 bytes: r (32) ‖ s (32) ‖ v (1, value 27 or 28).
 */
import {secp256k1} from "@noble/curves/secp256k1";
import {keccak_256} from "@noble/hashes/sha3";
import {bytesToHex as nobleBytesToHex, hexToBytes as nobleHexToBytes} from "@noble/hashes/utils";
import {bytesToHex, concat, hexToBytes, type Hex, utf8} from "./hash.js";

export interface KeyPair {
    privateKey: Hex;
    publicKey: Hex;     // uncompressed 65-byte
    address: `0x${string}`;
}

/** Generate a fresh secp256k1 keypair plus its Ethereum-style address. */
export function generateKeyPair(): KeyPair {
    const priv = secp256k1.utils.randomPrivateKey();
    return keyPairFromPrivateKey(`0x${nobleBytesToHex(priv)}`);
}

/** Reconstruct a KeyPair from a hex-encoded private key. */
export function keyPairFromPrivateKey(privateKey: Hex): KeyPair {
    const privBytes = hexToBytes(privateKey);
    const pubUncompressed = secp256k1.getPublicKey(privBytes, false); // 65 bytes, 0x04-prefix
    const address = pubKeyToAddress(pubUncompressed);
    return {
        privateKey,
        publicKey: bytesToHex(pubUncompressed),
        address,
    };
}

/** Derive the 20-byte Ethereum address from an uncompressed public key. */
export function pubKeyToAddress(pubUncompressed: Uint8Array): `0x${string}` {
    if (pubUncompressed.length !== 65 || pubUncompressed[0] !== 0x04) {
        throw new Error("expected uncompressed public key (65 bytes, 0x04 prefix)");
    }
    const xy = pubUncompressed.subarray(1);
    const hash = keccak_256(xy);
    return `0x${nobleBytesToHex(hash.subarray(12))}`;
}

/** Compute the EIP-191 "personal_sign" digest for an arbitrary string message. */
export function personalDigest(message: string): Uint8Array {
    const msgBytes = utf8(message);
    const prefix = utf8(`\x19Ethereum Signed Message:\n${msgBytes.length}`);
    return keccak_256(concat(prefix, msgBytes));
}

/**
 * Sign a string message with EIP-191 wrapping. Returns 65-byte r ‖ s ‖ v signature
 * where v is 27 or 28 (Ethereum convention).
 */
export function personalSign(privateKey: Hex, message: string): Hex {
    const digest = personalDigest(message);
    const sig = secp256k1.sign(digest, hexToBytes(privateKey), {lowS: true});
    const r = sig.r.toString(16).padStart(64, "0");
    const s = sig.s.toString(16).padStart(64, "0");
    const v = (sig.recovery! + 27).toString(16).padStart(2, "0");
    return `0x${r}${s}${v}` as Hex;
}

/** Recover the signer's address from an EIP-191 signature over `message`. */
export function recoverAddress(message: string, signature: Hex): `0x${string}` {
    const sigBytes = hexToBytes(signature);
    if (sigBytes.length !== 65) throw new Error("signature must be 65 bytes");
    const r = sigBytes.subarray(0, 32);
    const s = sigBytes.subarray(32, 64);
    const v = sigBytes[64]!;
    const recovery = v >= 27 ? v - 27 : v;
    if (recovery !== 0 && recovery !== 1) throw new Error(`invalid recovery byte: ${v}`);

    const sigForRecovery = new secp256k1.Signature(
        BigInt(`0x${nobleBytesToHex(r)}`),
        BigInt(`0x${nobleBytesToHex(s)}`),
    ).addRecoveryBit(recovery);

    const digest = personalDigest(message);
    const recovered = sigForRecovery.recoverPublicKey(digest);
    const pubBytes = recovered.toRawBytes(false); // uncompressed
    return pubKeyToAddress(pubBytes);
}

/** Verify an EIP-191 signature for a known signer address. */
export function verifyPersonalSig(message: string, signature: Hex, expectedSigner: `0x${string}`): boolean {
    try {
        const recovered = recoverAddress(message, signature);
        return recovered.toLowerCase() === expectedSigner.toLowerCase();
    } catch {
        return false;
    }
}

/** Sign 32 raw bytes (no EIP-191 wrap). Used for verifier challenges. */
export function signRawDigest(privateKey: Hex, digest: Uint8Array): Hex {
    if (digest.length !== 32) throw new Error("digest must be 32 bytes");
    const sig = secp256k1.sign(digest, hexToBytes(privateKey), {lowS: true});
    const r = sig.r.toString(16).padStart(64, "0");
    const s = sig.s.toString(16).padStart(64, "0");
    const v = (sig.recovery! + 27).toString(16).padStart(2, "0");
    return `0x${r}${s}${v}` as Hex;
}

/** Recover signer address from a raw 32-byte digest signature. */
export function recoverFromDigest(digest: Uint8Array, signature: Hex): `0x${string}` {
    const sigBytes = hexToBytes(signature);
    const r = sigBytes.subarray(0, 32);
    const s = sigBytes.subarray(32, 64);
    const v = sigBytes[64]!;
    const recovery = v >= 27 ? v - 27 : v;
    const sigForRecovery = new secp256k1.Signature(
        BigInt(`0x${nobleBytesToHex(r)}`),
        BigInt(`0x${nobleBytesToHex(s)}`),
    ).addRecoveryBit(recovery);
    const recovered = sigForRecovery.recoverPublicKey(digest);
    return pubKeyToAddress(recovered.toRawBytes(false));
}

// re-export for callers that want low-level access
export {nobleHexToBytes, nobleBytesToHex};
