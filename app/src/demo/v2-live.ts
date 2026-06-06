/**
 * One-command live local product mode for CredentialTrust V2.
 *
 * The runner:
 *   1. builds the V2 contracts if the artifacts are missing,
 *   2. starts or reuses a local Anvil RPC,
 *   3. deploys and bootstraps the V2 registries,
 *   4. starts the browser app, and
 *   5. prints a product URL with query params that prefill the Registry workspace.
 *
 * Stop the command with Ctrl-C. If the runner started Anvil, it tears that node down on exit.
 */
import {spawn, type ChildProcess, type SpawnOptions} from "node:child_process";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {homedir} from "node:os";
import {createServer, type AddressInfo} from "node:net";
import {fileURLToPath} from "node:url";
import {JsonRpcProvider} from "ethers";
import {loadChainConfigV2} from "../util/config.js";
import {buildLiveDemoUrl} from "../web/chainConfig.js";

const APP_DIR = process.cwd();
const CONTRACTS_DIR = resolve(APP_DIR, "../contracts");
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ANVIL_BIN = resolveFoundryExecutable("anvil");
const FORGE_BIN = resolveFoundryExecutable("forge");

function artifactPath(name: string): string {
    return resolve(CONTRACTS_DIR, `out/${name}.sol/${name}.json`);
}

function resolveFoundryExecutable(name: "anvil" | "forge"): string {
    const candidates = [name, resolve(homedir(), ".foundry/bin", name)];
    for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
    }
    return name;
}

function contractArtifactsReady(): boolean {
    return existsSync(artifactPath("IssuerRegistryV2")) && existsSync(artifactPath("CredentialRegistryV2"));
}

function spawnProcess(command: string, args: string[], options: {cwd?: string; stdio?: SpawnOptions["stdio"]}): ChildProcess {
    return spawn(command, args, {
        cwd: options.cwd,
        stdio: options.stdio ?? "inherit"
    });
}

async function runAndWait(command: string, args: string[], options: {cwd?: string} = {}): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawnProcess(command, args, {...options, stdio: "inherit"});
        child.on("exit", (code) => {
            if (code === 0) resolvePromise();
            else rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
        });
        child.on("error", rejectPromise);
    });
}

async function waitForRpc(timeoutMs = 20_000): Promise<void> {
    const provider = new JsonRpcProvider(RPC_URL);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await provider.getBlockNumber();
            return;
        } catch {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        }
    }
    throw new Error(`RPC did not come online at ${RPC_URL} within ${timeoutMs}ms`);
}

async function isPortAvailable(port: number): Promise<boolean> {
    return await new Promise<boolean>((resolvePromise) => {
        const server = createServer();
        server.unref();
        server.once("error", () => resolvePromise(false));
        server.listen(port, () => {
            server.close(() => resolvePromise(true));
        });
    });
}

async function requestEphemeralPort(): Promise<number> {
    return await new Promise<number>((resolvePromise, rejectPromise) => {
        const server = createServer();
        server.unref();
        server.once("error", rejectPromise);
        server.listen(0, () => {
            const address = server.address();
            server.close(() => {
                if (!address || typeof address === "string") {
                    rejectPromise(new Error("Failed to read an OS-assigned port"));
                    return;
                }

                resolvePromise((address as AddressInfo).port);
            });
        });
    });
}

function parsePreferredPort(value: string | undefined): number | undefined {
    if (value === undefined || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid VITE_PORT value: ${value}`);
    }
    return parsed;
}

export async function chooseWebPort(preferredPort?: number): Promise<number> {
    if (preferredPort !== undefined) {
        if (await isPortAvailable(preferredPort)) {
            return preferredPort;
        }

        console.log(`→ VITE_PORT=${preferredPort} is busy; falling back to an OS-assigned port`);
    }

    return await requestEphemeralPort();
}

function isPortCollisionMessage(output: string): boolean {
    return /EADDRINUSE|already in use|address already in use|port .* is occupied|port .* is in use/i.test(output);
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;

    return await new Promise<boolean>((resolvePromise) => {
        const timer = setTimeout(() => {
            cleanup();
            resolvePromise(false);
        }, timeoutMs);

        const cleanup = (): void => {
            clearTimeout(timer);
            child.off("exit", onExit);
            child.off("error", onError);
        };

        const onExit = (): void => {
            cleanup();
            resolvePromise(true);
        };

        const onError = (): void => {
            cleanup();
            resolvePromise(true);
        };

        child.once("exit", onExit);
        child.once("error", onError);
    });
}

async function terminateChild(child: ChildProcess | undefined, label: string): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    const endProcess = async (signal: NodeJS.Signals): Promise<void> => {
        try {
            child.kill(signal);
        } catch (error) {
            console.warn(`Warning: failed to send ${signal} to ${label}:`, error);
        }
    };

    await endProcess("SIGTERM");
    const exited = await waitForExit(child, 2_000);
    if (!exited) {
        await endProcess("SIGKILL");
        await waitForExit(child, 1_000);
    }
}

async function waitForWebReady(web: ChildProcess, port: number, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let stdout = "";
    let stderr = "";

    web.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        process.stdout.write(chunk);
    });
    web.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        process.stderr.write(chunk);
    });

    while (Date.now() < deadline) {
        if (web.exitCode !== null || web.signalCode !== null) {
            break;
        }

        try {
            const response = await fetch(`http://127.0.0.1:${port}/`, {method: "GET"});
            if (response.ok) {
                return;
            }
        } catch {
            // Keep waiting until the dev server is reachable or the child exits.
        }

        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }

    const combinedOutput = `${stdout}\n${stderr}`.trim();
    if (web.exitCode !== null || web.signalCode !== null) {
        const retryable = isPortCollisionMessage(combinedOutput);
        throw new Error(
            retryable
                ? `Vite exited before becoming ready on port ${port} because the port was busy.\n${combinedOutput}`
                : `Web app exited before becoming ready on port ${port}.\n${combinedOutput}`
        );
    }

    throw new Error(`Web app did not become ready at http://127.0.0.1:${port}/ within ${timeoutMs}ms`);
}

async function startWebApp(port: number): Promise<ChildProcess> {
    const child = spawnProcess("npm", ["run", "web", "--", "--port", String(port), "--strictPort"], {
        cwd: APP_DIR,
        stdio: ["ignore", "pipe", "pipe"]
    });

    try {
        await waitForWebReady(child, port);
        return child;
    } catch (error) {
        await terminateChild(child, "web app");
        throw error;
    }
}

async function launchWebApp(preferredPort?: number): Promise<{port: number; web: ChildProcess}> {
    const attempts = preferredPort === undefined ? 6 : 7;
    const attemptedPorts = new Set<number>();
    let port = await chooseWebPort(preferredPort);
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
        attemptedPorts.add(port);
        try {
            const web = await startWebApp(port);
            return {port, web};
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);

            if (!isPortCollisionMessage(message)) {
                throw error;
            }

            if (preferredPort !== undefined && port === preferredPort) {
                console.log(`→ retrying web app on a fresh OS-assigned port after ${message.split("\n")[0]}`);
            }

            do {
                port = await chooseWebPort();
            } while (attemptedPorts.has(port));
        }
    }

    throw new Error(
        `Failed to start the web app after ${attempts} attempts. Last error: ${
            lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error")
        }`
    );
}

async function main(): Promise<void> {
    let startedAnvil = false;
    let anvil: ChildProcess | undefined;
    let web: ChildProcess | undefined;
    const preferredPort = parsePreferredPort(process.env.VITE_PORT);

    const shutdown = async (): Promise<void> => {
        await terminateChild(web, "web app");
        if (startedAnvil) {
            await terminateChild(anvil, "anvil");
        }
    };

    process.once("SIGINT", () => {
        void shutdown().finally(() => process.exit(130));
    });
    process.once("SIGTERM", () => {
        void shutdown().finally(() => process.exit(143));
    });

    try {
        if (!contractArtifactsReady()) {
            console.log("→ building V2 contract artifacts…");
            await runAndWait(FORGE_BIN, ["build"], {cwd: CONTRACTS_DIR});
        }

        try {
            await waitForRpc(1500);
            console.log(`→ reusing local RPC at ${RPC_URL}`);
        } catch {
            console.log(`→ starting anvil at ${RPC_URL}…`);
            const url = new URL(RPC_URL);
            const port = url.port || "8545";
            anvil = spawnProcess(ANVIL_BIN, ["--host", "0.0.0.0", "--port", port, "--silent"], {
                stdio: ["ignore", "ignore", "inherit"]
            });
            startedAnvil = true;
            await waitForRpc();
        }

        console.log("→ deploying V2 registries…");
        await runAndWait("node", ["--import", "tsx", "src/scripts/deploy-v2-local.ts"], {
            cwd: APP_DIR
        });

        const liveConfig = loadChainConfigV2();

        console.log("→ starting web app…");
        const launched = await launchWebApp(preferredPort);
        web = launched.web;

        const webUrl = `http://localhost:${launched.port}/`;
        const productUrl = buildLiveDemoUrl(webUrl, liveConfig);
        console.log(`Product URL: ${productUrl}`);

        const exitCode = await new Promise<number>((resolvePromise, rejectPromise) => {
            if (!web) {
                rejectPromise(new Error("Web app process was not created"));
                return;
            }

            if (web.exitCode !== null) {
                resolvePromise(web.exitCode ?? 1);
                return;
            }

            if (web.signalCode !== null) {
                resolvePromise(1);
                return;
            }

            web.once("exit", (code, signal) => {
                if (signal) {
                    resolvePromise(1);
                    return;
                }
                resolvePromise(code ?? 1);
            });
            web.once("error", rejectPromise);
        });

        if (exitCode !== 0) {
            throw new Error(`Web app exited with code ${exitCode}`);
        }
    } finally {
        await shutdown();
    }
}

const isDirectExecution = process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isDirectExecution) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
