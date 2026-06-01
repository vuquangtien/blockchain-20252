import {describe, expect, it} from "vitest";
import {MerkleClaimTree, verifyMerkleProof} from "../src/core/merkle.js";
import type {Claim} from "../src/core/types.js";

const claims: Claim[] = [
    {key: "course:CS101", value: {name: "Intro to CS", credits: 3, grade: "A"}, salt: "0x" + "11".repeat(32)},
    {key: "course:MATH201", value: {name: "Calculus II", credits: 4, grade: "B+"}, salt: "0x" + "22".repeat(32)},
    {key: "course:PH150", value: {name: "Physics I", credits: 3, grade: "A-"}, salt: "0x" + "33".repeat(32)},
    {key: "course:EN101", value: {name: "English", credits: 2, grade: "B"}, salt: "0x" + "44".repeat(32)},
    {key: "course:HIS200", value: {name: "World History", credits: 2, grade: "A"}, salt: "0x" + "55".repeat(32)},
];

describe("MerkleClaimTree", () => {
    it("produces a stable root regardless of input order", () => {
        const t1 = new MerkleClaimTree(claims).root;
        const t2 = new MerkleClaimTree([...claims].reverse()).root;
        expect(t1).toBe(t2);
    });

    it("any single-claim proof verifies against the root", () => {
        const tree = new MerkleClaimTree(claims);
        for (const c of claims) {
            const {siblings, positions} = tree.proofFor(c.key);
            expect(verifyMerkleProof(c, siblings, positions, tree.root)).toBe(true);
        }
    });

    it("rejects a proof when the leaf data has been tampered with", () => {
        const tree = new MerkleClaimTree(claims);
        const target = claims[0]!;
        const {siblings, positions} = tree.proofFor(target.key);
        const tampered: Claim = {...target, value: {...(target.value as object), grade: "A+"}};
        expect(verifyMerkleProof(tampered, siblings, positions, tree.root)).toBe(false);
    });

    it("rejects a proof with a wrong sibling", () => {
        const tree = new MerkleClaimTree(claims);
        const target = claims[1]!;
        const {siblings, positions} = tree.proofFor(target.key);
        const broken = [...siblings];
        broken[0] = ("0x" + "ff".repeat(32)) as `0x${string}`;
        expect(verifyMerkleProof(target, broken, positions, tree.root)).toBe(false);
    });

    it("rejects a proof with flipped position bit", () => {
        const tree = new MerkleClaimTree(claims);
        const target = claims[2]!;
        const {siblings, positions} = tree.proofFor(target.key);
        if (positions.length === 0) return;
        const flipped = positions.map((b, i) => (i === 0 ? !b : b));
        expect(verifyMerkleProof(target, siblings, flipped, tree.root)).toBe(false);
    });

    it("handles odd leaf counts via duplication", () => {
        const tree = new MerkleClaimTree(claims.slice(0, 3));
        for (const c of claims.slice(0, 3)) {
            const {siblings, positions} = tree.proofFor(c.key);
            expect(verifyMerkleProof(c, siblings, positions, tree.root)).toBe(true);
        }
    });

    it("rejects building with duplicate leaves", () => {
        const dup = [...claims, {...claims[0]!}];
        expect(() => new MerkleClaimTree(dup)).toThrow(/Duplicate leaf/);
    });

    it("rejects empty inputs", () => {
        expect(() => new MerkleClaimTree([])).toThrow(/at least one/);
    });

    it("produces 32-byte roots", () => {
        const root = new MerkleClaimTree(claims).root;
        expect(root).toMatch(/^0x[0-9a-f]{64}$/);
    });
});
