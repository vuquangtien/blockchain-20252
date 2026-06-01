/**
 * Convenience runner: spawns a local Anvil node, waits for it to accept RPC, runs the
 * end-to-end demo, then shuts the node down. Useful for a one-shot grading run when the
 * user doesn't want to manage a separate terminal.
 *
 * Equivalent to running:
 *   anvil &
 *   npm run demo
 *   pkill -f anvil
 */
import {spawn, type ChildProcess} from "node:child_process";
import {JsonRpcProvider} from "ethers";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";

async function waitForRpc(timeoutMs = 15_000): Promise<void> {
    const provider = new JsonRpcProvider(RPC_URL);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await provider.getBlockNumber();
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    throw new Error(`anvil did not come online at ${RPC_URL} within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
    console.log("→ starting anvil…");
    const anvil: ChildProcess = spawn("anvil", ["--port", "8545"], {
        stdio: ["ignore", "ignore", "inherit"],
    });

    let demoExitCode = 1;
    try {
        await waitForRpc();
        console.log("→ anvil is up, running demo\n");

        const demo = spawn("tsx", ["src/demo/end-to-end.ts"], {stdio: "inherit"});
        demoExitCode = await new Promise<number>((resolve, reject) => {
            demo.on("exit", (code) => resolve(code ?? 1));
            demo.on("error", reject);
        });
    } finally {
        console.log("\n→ stopping anvil");
        anvil.kill("SIGTERM");
        await new Promise((r) => setTimeout(r, 500));
        if (!anvil.killed) anvil.kill("SIGKILL");
    }

    process.exit(demoExitCode);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
