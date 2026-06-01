/** File I/O helpers shared by the CLIs. */
import {readFileSync, writeFileSync, existsSync, mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";

export function readJSON<T>(path: string): T {
    const abs = resolve(path);
    if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);
    return JSON.parse(readFileSync(abs, "utf8")) as T;
}

export function writeJSON(path: string, value: unknown): void {
    const abs = resolve(path);
    mkdirSync(dirname(abs), {recursive: true});
    writeFileSync(abs, JSON.stringify(value, null, 2));
}

export function envRequired(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}
