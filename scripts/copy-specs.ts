// Copies the OpenAPI specs of the services this library generates for from their local
// checkouts into specs/. Run it with `npm run copy-specs` (decision record 0007).
//
// Every repository listed in specs.config.json must be cloned beside this one, so a
// repository named `storefront-backend` is found at `../storefront-backend`.
//
// The script copies files and nothing else. It never edits a spec and keeps no record of
// where a spec came from. Node runs this file directly, so keep to syntax it can strip.

import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const CONFIG_FILE = 'specs.config.json';

/** `<service>-service-v<N>.yaml`, for example `orders-service-v1.yaml` (decision record 0001). */
const SPEC_FILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*-service-v\d+\.yaml$/;
const OPENAPI_VERSION = /^3\.0\.\d+$/;

export interface ServiceSource {
    /** Folder name of the service repository, found at `../<repo>` from the library root. */
    repo: string;
    /** Folder inside the repository that holds the specs. */
    specsPath: string;
    /** Spec files to copy from that folder. */
    files: string[];
}

export interface CopiedFile {
    name: string;
    version: string;
}

export interface ChangedFile extends CopiedFile {
    /** The `info.version` of the file that was replaced, when it could be read. */
    previousVersion: string | undefined;
}

export interface CopySpecsResult {
    added: CopiedFile[];
    changed: ChangedFile[];
    unchanged: CopiedFile[];
    removed: string[];
}

export class CopySpecsError extends Error {
    readonly problems: string[];
    /** True only when a failed run could not put specs/ back as it was. */
    readonly specsChanged: boolean;

    constructor(problems: string[], specsChanged = false) {
        super(problems.length === 1 ? problems[0] : `${problems.length} problems found:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
        this.name = 'CopySpecsError';
        this.problems = problems;
        this.specsChanged = specsChanged;
    }
}

interface PlannedFile {
    name: string;
    sourcePath: string;
    version: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isPlainName(value: string): boolean {
    return value !== '.' && value !== '..' && /^[^\\/:*?"<>|]+$/.test(value);
}

function isInsideFolder(value: string): boolean {
    const normalized = path.posix.normalize(value);
    return !value.includes('\\') && !value.includes(':') && !path.posix.isAbsolute(normalized) && normalized !== '..' && !normalized.startsWith('../');
}

/** Checks the shape of specs.config.json and names every field that is wrong. */
export function parseConfig(text: string): ServiceSource[] {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        throw new CopySpecsError([`${CONFIG_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]);
    }
    if (!isRecord(raw)) {
        throw new CopySpecsError([`${CONFIG_FILE} must be an object with a "services" array`]);
    }

    const problems: string[] = [];
    for (const key of Object.keys(raw)) {
        if (key !== 'services') {
            problems.push(`${CONFIG_FILE}: unknown field "${key}"`);
        }
    }
    const services = raw.services;
    if (!Array.isArray(services) || services.length === 0) {
        problems.push(`${CONFIG_FILE}: "services" must be a non-empty array`);
        throw new CopySpecsError(problems);
    }

    const parsed: ServiceSource[] = [];
    services.forEach((entry: unknown, index) => {
        const where = `services[${index}]`;
        if (!isRecord(entry)) {
            problems.push(`${CONFIG_FILE}: ${where} must be an object with "repo", "specsPath" and "files"`);
            return;
        }
        for (const key of Object.keys(entry)) {
            if (key !== 'repo' && key !== 'specsPath' && key !== 'files') {
                problems.push(`${CONFIG_FILE}: ${where} has an unknown field "${key}"`);
            }
        }
        const { repo, specsPath, files } = entry;
        let valid = true;
        if (typeof repo !== 'string' || !isPlainName(repo)) {
            problems.push(`${CONFIG_FILE}: ${where}.repo must be the name of a sibling folder, such as "storefront-backend"`);
            valid = false;
        }
        if (typeof specsPath !== 'string' || specsPath === '' || !isInsideFolder(specsPath)) {
            problems.push(`${CONFIG_FILE}: ${where}.specsPath must be a relative folder inside the repository, such as "specs"`);
            valid = false;
        }
        if (!Array.isArray(files) || files.length === 0) {
            problems.push(`${CONFIG_FILE}: ${where}.files must be a non-empty array of file names`);
            valid = false;
        } else {
            files.forEach((file: unknown, fileIndex) => {
                if (typeof file !== 'string' || !isPlainName(file)) {
                    problems.push(`${CONFIG_FILE}: ${where}.files[${fileIndex}] must be a file name without a folder`);
                    valid = false;
                }
            });
        }
        if (valid) {
            parsed.push({ repo: repo as string, specsPath: specsPath as string, files: files as string[] });
        }
    });

    if (problems.length > 0) {
        throw new CopySpecsError(problems);
    }
    return parsed;
}

/** Returns the `info.version` of a spec, or throws a short reason the file is not usable. */
function readSpecVersion(content: Buffer): string {
    let document: unknown;
    try {
        document = parse(content.toString('utf8'));
    } catch (error) {
        const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
        throw new Error(`is not valid YAML (${reason})`, { cause: error });
    }
    if (!isRecord(document) || document.openapi === undefined) {
        throw new Error('is not an OpenAPI document (no "openapi" field)');
    }
    if (typeof document.openapi !== 'string' || !OPENAPI_VERSION.test(document.openapi)) {
        throw new Error(`declares OpenAPI ${String(document.openapi)}, but only 3.0.x is supported`);
    }
    const info = document.info;
    if (!isRecord(info) || typeof info.version !== 'string' || info.version === '') {
        throw new Error('has no "info.version" (it must be a string, so quote it)');
    }
    return info.version;
}

async function readIfExists(file: string): Promise<Buffer | undefined> {
    try {
        return await readFile(file);
    } catch (error) {
        if (isNotFound(error)) {
            return undefined;
        }
        throw error;
    }
}

async function isDirectory(folder: string): Promise<boolean> {
    try {
        return (await stat(folder)).isDirectory();
    } catch (error) {
        if (isNotFound(error)) {
            return false;
        }
        throw error;
    }
}

/** Checks every listed file. Nothing is written, and every problem found is reported together. */
async function planCopy(root: string, services: ServiceSource[]): Promise<PlannedFile[]> {
    const problems: string[] = [];
    const planned = new Map<string, PlannedFile & { display: string }>();

    for (const { repo, specsPath, files } of services) {
        const repoDir = path.resolve(root, '..', repo);
        const specsDir = path.resolve(repoDir, specsPath);
        const display = (file?: string) => (file === undefined ? path.posix.join('..', repo, specsPath) : path.posix.join('..', repo, specsPath, file));

        if (!(await isDirectory(repoDir))) {
            problems.push(`The repository folder ../${repo} does not exist (looked for ${repoDir}). Clone it into the same parent folder as this repository.`);
            continue;
        }
        if (!(await isDirectory(specsDir))) {
            problems.push(`The spec folder ${display()} does not exist.`);
            continue;
        }

        for (const name of files) {
            if (!SPEC_FILE_NAME.test(name)) {
                problems.push(`${display(name)}: the name must look like <service>-service-v<N>.yaml, for example orders-service-v1.yaml.`);
                continue;
            }
            const earlier = planned.get(name);
            if (earlier !== undefined) {
                problems.push(`${display(name)}: ${name} is listed twice (first copied from ${earlier.display}).`);
                continue;
            }
            const sourcePath = path.join(specsDir, name);
            const content = await readIfExists(sourcePath).catch(() => undefined);
            if (content === undefined) {
                problems.push(`${display(name)}: the file does not exist or cannot be read.`);
                continue;
            }
            try {
                planned.set(name, { name, sourcePath, version: readSpecVersion(content), display: display(name) });
            } catch (error) {
                problems.push(`${display(name)} ${error instanceof Error ? error.message : String(error)}.`);
            }
        }
    }

    if (problems.length > 0) {
        throw new CopySpecsError(problems);
    }
    return [...planned.values()].map(({ name, sourcePath, version }) => ({ name, sourcePath, version }));
}

async function listEntries(folder: string): Promise<string[]> {
    try {
        return await readdir(folder);
    } catch (error) {
        if (isNotFound(error)) {
            return [];
        }
        throw error;
    }
}

/** Compares the planned files with what is in specs/ now. */
async function compare(specsDir: string, planned: PlannedFile[]): Promise<CopySpecsResult> {
    const result: CopySpecsResult = { added: [], changed: [], unchanged: [], removed: [] };

    for (const { name, sourcePath, version } of planned) {
        const current = await readIfExists(path.join(specsDir, name));
        if (current === undefined) {
            result.added.push({ name, version });
        } else if (current.equals(await readFile(sourcePath))) {
            result.unchanged.push({ name, version });
        } else {
            let previousVersion: string | undefined;
            try {
                previousVersion = readSpecVersion(current);
            } catch {
                previousVersion = undefined;
            }
            result.changed.push({ name, version, previousVersion });
        }
    }

    const wanted = new Set(planned.map((file) => file.name));
    for (const entry of await listEntries(specsDir)) {
        if (!wanted.has(entry)) {
            result.removed.push(entry);
        }
    }
    return result;
}

/**
 * Replaces the contents of specs/ with the planned files. The files are copied into a work
 * folder first, the old files move to a backup folder, then the new files move in. If any
 * step fails, everything is put back and specs/ is left as it was.
 */
async function swapIn(root: string, specsDir: string, planned: PlannedFile[]): Promise<void> {
    const work = await mkdtemp(path.join(root, '.copy-specs-'));
    const staged = path.join(work, 'staged');
    const backup = path.join(work, 'backup');
    let keepWork = false;

    try {
        await mkdir(staged);
        await mkdir(backup);
        for (const { name, sourcePath } of planned) {
            await copyFile(sourcePath, path.join(staged, name));
        }

        const createdFolder = await mkdir(specsDir, { recursive: true });
        const movedAside: string[] = [];
        const movedIn: string[] = [];
        try {
            for (const entry of await listEntries(specsDir)) {
                await rename(path.join(specsDir, entry), path.join(backup, entry));
                movedAside.push(entry);
            }
            for (const { name } of planned) {
                await rename(path.join(staged, name), path.join(specsDir, name));
                movedIn.push(name);
            }
        } catch (error) {
            try {
                for (const name of movedIn) {
                    await rm(path.join(specsDir, name), { recursive: true, force: true });
                }
                for (const entry of movedAside) {
                    await rename(path.join(backup, entry), path.join(specsDir, entry));
                }
                if (createdFolder !== undefined) {
                    await rm(specsDir, { recursive: true, force: true });
                }
            } catch (restoreError) {
                keepWork = true;
                throw new CopySpecsError([`Copying failed and specs/ could not be fully restored. The previous files are in ${backup}.`, `Restore error: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`], true);
            }
            throw error;
        }
    } finally {
        if (!keepWork) {
            await rm(work, { recursive: true, force: true });
        }
    }
}

/** Copies the configured specs into `<root>/specs`. `root` is the library's root folder. */
export async function copySpecs(options: { root: string }): Promise<CopySpecsResult> {
    const { root } = options;
    const configPath = path.join(root, CONFIG_FILE);
    const text = await readIfExists(configPath);
    if (text === undefined) {
        throw new CopySpecsError([`${CONFIG_FILE} was not found in ${root}.`]);
    }

    const services = parseConfig(text.toString('utf8'));
    const planned = await planCopy(root, services);
    const specsDir = path.join(root, 'specs');
    const result = await compare(specsDir, planned);
    await swapIn(root, specsDir, planned);
    return result;
}

/** The text printed after a run. */
export function formatSummary(result: CopySpecsResult): string {
    const lines = [`specs/ updated: ${result.added.length} added, ${result.changed.length} changed, ${result.removed.length} removed, ${result.unchanged.length} unchanged.`];
    for (const file of result.added) {
        lines.push(`  added      ${file.name} (${file.version})`);
    }
    for (const file of result.changed) {
        const detail = file.previousVersion === undefined || file.previousVersion === file.version ? file.version : `${file.previousVersion} -> ${file.version}`;
        lines.push(`  changed    ${file.name} (${detail})`);
    }
    for (const name of result.removed) {
        lines.push(`  removed    ${name}`);
    }
    for (const file of result.unchanged) {
        lines.push(`  unchanged  ${file.name} (${file.version})`);
    }
    return lines.join('\n');
}

/** What `npm run copy-specs` does: prints the summary or the problems, and returns the exit code. */
export async function runCli(root: string): Promise<number> {
    try {
        console.log(formatSummary(await copySpecs({ root })));
        return 0;
    } catch (error) {
        if (error instanceof CopySpecsError) {
            console.error(`copy-specs failed.${error.specsChanged ? '' : ' specs/ was not changed.'}\n${error.message}`);
            return 1;
        }
        throw error;
    }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await runCli(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
}
