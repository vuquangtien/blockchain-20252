import {EventEmitter} from "node:events";
import {describe, expect, it, vi, beforeEach} from "vitest";

const netState = vi.hoisted(() => ({
    occupiedPorts: new Set<number>(),
    nextEphemeralPort: 41000
}));

class FakeServer extends EventEmitter {
    private activePort: number | null = null;

    unref(): this {
        return this;
    }

    address(): {address: string; family: string; port: number} | null {
        if (this.activePort === null) return null;
        return {address: "127.0.0.1", family: "IPv4", port: this.activePort};
    }

    listen(portOrOptions: number | {port?: number} = 0, hostOrCallback?: string | (() => void), callback?: () => void): this {
        const port = typeof portOrOptions === "number" ? portOrOptions : portOrOptions.port ?? 0;
        const done = typeof hostOrCallback === "function" ? hostOrCallback : callback;
        const chosenPort = port === 0 ? netState.nextEphemeralPort++ : port;

        if (netState.occupiedPorts.has(chosenPort)) {
            queueMicrotask(() => this.emit("error", new Error("EADDRINUSE")));
            return this;
        }

        this.activePort = chosenPort;
        netState.occupiedPorts.add(chosenPort);
        queueMicrotask(() => done?.());
        return this;
    }

    close(callback?: () => void): this {
        if (this.activePort !== null) {
            netState.occupiedPorts.delete(this.activePort);
            this.activePort = null;
        }

        queueMicrotask(() => callback?.());
        return this;
    }
}

vi.mock("node:net", () => ({
    createServer: () => new FakeServer()
}));

const {chooseWebPort} = await import("../src/demo/v2-live.js");

beforeEach(() => {
    netState.occupiedPorts.clear();
    netState.nextEphemeralPort = 41000;
});

describe("V2 live demo port selection", () => {
    it("asks the OS for a free port when no preferred port is set", async () => {
        const port = await chooseWebPort();

        expect(port).toBe(41000);
    });

    it("falls back when the preferred port is already occupied", async () => {
        netState.occupiedPorts.add(5176);

        const port = await chooseWebPort(5176);

        expect(port).toBe(41000);
        expect(port).not.toBe(5176);
    });
});
