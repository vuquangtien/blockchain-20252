import {describe, expect, it} from "vitest";
import {
    generateKeyPair,
    keyPairFromPrivateKey,
    personalSign,
    recoverAddress,
    signRawDigest,
    recoverFromDigest,
    verifyPersonalSig,
    pubKeyToAddress,
} from "../src/core/ecc.js";
import {hexToBytes} from "../src/core/hash.js";
import {Wallet, hashMessage, recoverAddress as ethersRecover} from "ethers";

describe("ECC (secp256k1)", () => {
    it("derives consistent address from private key", () => {
        const kp = generateKeyPair();
        const kp2 = keyPairFromPrivateKey(kp.privateKey);
        expect(kp.address).toBe(kp2.address);
        expect(kp.publicKey).toBe(kp2.publicKey);
    });

    it("personalSign + recoverAddress round-trips", () => {
        const kp = generateKeyPair();
        const msg = "hello, blockchain";
        const sig = personalSign(kp.privateKey, msg);
        expect(recoverAddress(msg, sig).toLowerCase()).toBe(kp.address.toLowerCase());
        expect(verifyPersonalSig(msg, sig, kp.address)).toBe(true);
    });

    it("personalSign output is interoperable with ethers personal_sign", async () => {
        // Use a known ethers wallet and verify our recoverAddress matches ethers.
        const wallet = new Wallet("0x" + "ab".repeat(32));
        const msg = "interop check";
        const ourSig = personalSign(wallet.privateKey as `0x${string}`, msg);
        const recoveredByEthers = ethersRecover(hashMessage(msg), ourSig);
        expect(recoveredByEthers.toLowerCase()).toBe(wallet.address.toLowerCase());
    });

    it("rejects modified message", () => {
        const kp = generateKeyPair();
        const sig = personalSign(kp.privateKey, "original");
        expect(verifyPersonalSig("tampered", sig, kp.address)).toBe(false);
    });

    it("signRawDigest + recoverFromDigest round-trips", () => {
        const kp = generateKeyPair();
        const digest = hexToBytes("0x" + "ab".repeat(32));
        const sig = signRawDigest(kp.privateKey, digest);
        expect(recoverFromDigest(digest, sig).toLowerCase()).toBe(kp.address.toLowerCase());
    });

    it("pubKeyToAddress matches ethers", () => {
        const wallet = new Wallet("0x" + "cd".repeat(32));
        const kp = keyPairFromPrivateKey(wallet.privateKey as `0x${string}`);
        expect(kp.address.toLowerCase()).toBe(wallet.address.toLowerCase());
        // pubKeyToAddress sanity
        const derived = pubKeyToAddress(hexToBytes(kp.publicKey));
        expect(derived.toLowerCase()).toBe(wallet.address.toLowerCase());
    });
});
