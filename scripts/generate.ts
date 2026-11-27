// Generates a typed client for every spec in specs/ with hey-api `openapi-ts`. Run it with
// `npm run generate`, or `npm run generate -- --service orders-service-v1` for one spec.
//
// Each spec `specs/<name>.yaml` is generated into its own folder `src/generated/<name>/`
// (decision records 0002 and 0011), so adding a spec is dropping in the file. The steps, in
// order, stop at the first failure:
//
//   1. Check every spec: valid YAML, no duplicate `operationId`, every local `$ref` resolves.
//   2. Generate each spec into a work folder with the pinned generator.
//   3. Typecheck everything that was generated, under the repository's strict settings.
//   4. Swap: replace each spec's output folder with the new one, and remove the folders of specs
//      that no longer exist. If a step fails, src/generated/ is left as it was.
//
// There is no formatter step: generated code is excluded from lint and format (record 0003), and
// hey-api writes the "auto-generated" header itself.
//
// Node runs this file directly, so keep to syntax it can strip.

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, stripVTControlCharacters } from 'node:util';
import { createClient } from '@hey-api/openapi-ts';
import { parse } from 'yaml';

/** `orders-service-v1.yaml`, `widgets-service-v1.yaml`, or a name with no version suffix. */
const SPEC_FILE_NAME = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.yaml$/;
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export class GenerateError extends Error {
    readonly problems: string[];

    constructor(problems: string[]) {
        super(problems.length === 1 ? problems[0] : `${problems.length} problems found:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
        this.name = 'GenerateError';
        this.problems = problems;
    }
}

/** The command was used wrongly, for example with an unknown `--service`. The exit code is 2. */
export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UsageError';
    }
}

export interface GenerateOptions {
    /** The library's root folder. It holds `openapi-ts.config.mjs`, `tsconfig.json` and `node_modules`. */
    root: string;
    /** Where the specs are. Default `<root>/specs`. */
    specsDir?: string;
    /** Where the folders of generated code go. Default `<root>/src/generated`. */
    outDir?: string;
    /** Generate only this spec, named without `.yaml` (`orders-service-v1`). */
    service?: string;
    /** Throws a message when the generated code does not compile. The default runs `tsc`. */
    typecheck?: (stagedDir: string, workDir: string) => Promise<void>;
}

export interface GeneratedSpec {
    name: string;
    operations: number;
    /** The folder, relative to the root when it is inside it. */
    folder: string;
}

export interface GenerateResult {
    generated: GeneratedSpec[];
    /** Folders of specs that no longer exist, removed from the output folder. */
    removed: string[];
    generatorVersion: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function firstLine(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).split('\n')[0];
}

/** Looks up a `#/a/b` reference in the document, the way JSON pointers are written in a `$ref`. */
function resolvePointer(document: unknown, ref: string): boolean {
    let node: unknown = document;
    for (const raw of ref.slice(1).split('/').slice(1)) {
        let key: string;
        try {
            key = decodeURIComponent(raw).replaceAll('~1', '/').replaceAll('~0', '~');
        } catch {
            return false;
        }
        if (!isRecord(node) && !Array.isArray(node)) {
            return false;
        }
        if (!Object.hasOwn(node, key)) {
            return false;
        }
        node = (node as Record<string, unknown>)[key];
    }
    return true;
}

function findLocalRefs(node: unknown, where: string, found: { ref: string; where: string }[], seen: WeakSet<object>): void {
    if (typeof node !== 'object' || node === null || seen.has(node)) {
        return;
    }
    seen.add(node);
    if (Array.isArray(node)) {
        node.forEach((item, index) => findLocalRefs(item, `${where}[${index}]`, found, seen));
        return;
    }
    for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string' && value.startsWith('#')) {
            found.push({ ref: value, where });
        } else {
            findLocalRefs(value, where === '' ? key : `${where}.${key}`, found, seen);
        }
    }
}

export interface SpecCheck {
    operations: number;
    problems: string[];
}

/**
 * Checks what hey-api does not report or reports badly. A duplicate `operationId` generates with
 * no warning, and a `$ref` to a schema that does not exist fails with an unrelated message.
 */
export function checkSpec(file: string, text: string): SpecCheck {
    let document: unknown;
    try {
        document = parse(text);
    } catch (error) {
        return { operations: 0, problems: [`${file} is not valid YAML (${firstLine(error)}).`] };
    }
    if (!isRecord(document) || document.openapi === undefined || !isRecord(document.paths)) {
        return { operations: 0, problems: [`${file} is not an OpenAPI document (it needs "openapi" and "paths").`] };
    }

    const problems: string[] = [];
    const operationIds = new Map<string, string>();
    let operations = 0;
    for (const [route, item] of Object.entries(document.paths)) {
        if (!isRecord(item)) {
            continue;
        }
        for (const method of HTTP_METHODS) {
            const operation = item[method];
            if (!isRecord(operation)) {
                continue;
            }
            operations += 1;
            const label = `${method.toUpperCase()} ${route}`;
            const id = operation.operationId;
            if (typeof id !== 'string') {
                continue;
            }
            const earlier = operationIds.get(id);
            if (earlier === undefined) {
                operationIds.set(id, label);
            } else {
                problems.push(`${file}: operationId "${id}" is used by ${earlier} and by ${label}. Every operation needs its own.`);
            }
        }
    }

    const refs: { ref: string; where: string }[] = [];
    findLocalRefs(document, '', refs, new WeakSet());
    for (const { ref, where } of refs) {
        if (!resolvePointer(document, ref)) {
            problems.push(`${file}: "${ref}" does not exist (referenced at ${where}).`);
        }
    }
    return { operations, problems };
}

async function listSpecFiles(specsDir: string): Promise<string[]> {
    let entries: string[];
    try {
        entries = await readdir(specsDir);
    } catch (error) {
        if (isNotFound(error)) {
            throw new GenerateError([`The spec folder ${specsDir} does not exist.`]);
        }
        throw error;
    }
    const yaml = entries.filter((entry) => entry.endsWith('.yaml')).sort();
    const badNames = yaml.filter((entry) => !SPEC_FILE_NAME.test(entry));
    if (badNames.length > 0) {
        throw new GenerateError(badNames.map((entry) => `${entry}: the name must be lower case letters, digits and dashes, like orders-service-v1.yaml.`));
    }
    return yaml;
}

/** Runs hey-api on one spec and returns the problems it reported: a failure, or any warning or error it printed. */
async function runGenerator(root: string, input: string, output: string): Promise<string[]> {
    const printed: string[] = [];
    const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    // hey-api prints its progress and its warnings with console, and has no option to collect them.
    console.log = () => {};
    console.info = () => {};
    console.warn = console.error = (...args: unknown[]) => {
        printed.push(stripVTControlCharacters(args.map(String).join(' ')).trim());
    };
    try {
        const contexts = await createClient({
            input,
            output,
            // Not the working directory's: the shared options are the repository's, wherever this runs from.
            configFile: path.join(root, 'openapi-ts.config.mjs'),
            // `file: false` stops it from writing a crash log into the working directory.
            logs: { level: 'warn', file: false }
        } as Parameters<typeof createClient>[0]);
        if (printed.length > 0) {
            return printed.filter((line) => line !== '');
        }
        return contexts.length === 1 ? [] : ['hey-api did not generate anything.'];
    } catch (error) {
        // Its errors arrive wrapped in a "JobError" with an empty message. The real one is inside.
        const inner = isRecord(error) && isRecord(error.originalError) ? error.originalError.error : undefined;
        const reason = inner instanceof Error ? inner.message : error instanceof Error ? error.message : String(error);
        return [reason === '' ? 'hey-api failed with no message.' : reason];
    } finally {
        Object.assign(console, original);
    }
}

/** Typechecks every staged folder in one `tsc` run, with the repository's own compiler options. */
async function typecheckStaged(root: string, stagedDir: string, workDir: string): Promise<void> {
    const tsconfig = path.join(workDir, 'tsconfig.json');
    await writeFile(tsconfig, JSON.stringify({ extends: path.join(root, 'tsconfig.json'), include: [path.join(stagedDir, '**', '*.ts')] }));
    const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
    await new Promise<void>((resolve, reject) => {
        execFile(process.execPath, [tsc, '--noEmit', '--pretty', 'false', '-p', tsconfig], { cwd: root, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
            if (error === null) {
                resolve();
                return;
            }
            const lines = stdout.split('\n').filter((line) => line.trim() !== '');
            // tsc prints paths relative to the working directory. Show them relative to the output folder instead.
            const shown = lines.slice(0, 20).map((line) => line.replaceAll(path.relative(root, stagedDir) + path.sep, '').replaceAll(stagedDir + path.sep, ''));
            reject(new GenerateError([`The generated code does not compile:\n${shown.join('\n')}${lines.length > shown.length ? `\n... and ${lines.length - shown.length} more lines` : ''}`]));
        });
    });
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

/**
 * Moves the staged folders into the output folder. What was there goes to a backup folder first,
 * and if any move fails everything is put back.
 */
async function swapIn(outDir: string, stagedDir: string, backupDir: string, names: string[], removed: string[]): Promise<void> {
    await mkdir(outDir, { recursive: true });
    const movedAside: string[] = [];
    const movedIn: string[] = [];
    try {
        for (const name of [...names, ...removed]) {
            if (await isDirectory(path.join(outDir, name))) {
                await rename(path.join(outDir, name), path.join(backupDir, name));
                movedAside.push(name);
            }
        }
        for (const name of names) {
            await rename(path.join(stagedDir, name), path.join(outDir, name));
            movedIn.push(name);
        }
    } catch (error) {
        for (const name of movedIn) {
            await rm(path.join(outDir, name), { recursive: true, force: true });
        }
        for (const name of movedAside) {
            await rename(path.join(backupDir, name), path.join(outDir, name));
        }
        throw error;
    }
}

async function generatorVersion(root: string): Promise<string> {
    const text = await readFile(path.join(root, 'node_modules', '@hey-api', 'openapi-ts', 'package.json'), 'utf8');
    return (JSON.parse(text) as { version: string }).version;
}

/** Generates the clients. See the top of this file for the steps. */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
    const { root } = options;
    const specsDir = options.specsDir ?? path.join(root, 'specs');
    const outDir = options.outDir ?? path.join(root, 'src', 'generated');
    const typecheck = options.typecheck;

    const files = await listSpecFiles(specsDir);
    const available = files.map((file) => file.slice(0, -'.yaml'.length));
    if (options.service !== undefined && !available.includes(options.service)) {
        throw new UsageError(`There is no spec named "${options.service}" in ${path.relative(root, specsDir) || specsDir}. Specs: ${available.join(', ') || '(none)'}.`);
    }
    const names = options.service === undefined ? available : [options.service];
    if (names.length === 0) {
        throw new GenerateError([`There are no .yaml specs in ${specsDir}.`]);
    }

    // 1. Check every spec, and report every problem together.
    const operations = new Map<string, number>();
    const problems: string[] = [];
    for (const name of names) {
        const check = checkSpec(`${name}.yaml`, await readFile(path.join(specsDir, `${name}.yaml`), 'utf8'));
        operations.set(name, check.operations);
        problems.push(...check.problems);
    }
    if (problems.length > 0) {
        throw new GenerateError(problems);
    }

    const workDir = await mkdtemp(path.join(root, '.generate-'));
    const stagedDir = path.join(workDir, 'staged');
    const backupDir = path.join(workDir, 'backup');
    try {
        await mkdir(stagedDir);
        await mkdir(backupDir);

        // 2. Generate each spec into the work folder. The first failure stops the run.
        for (const name of names) {
            const reported = await runGenerator(root, path.join(specsDir, `${name}.yaml`), path.join(stagedDir, name));
            if (reported.length > 0) {
                throw new GenerateError(reported.map((line) => `${name}.yaml: hey-api reported: ${line}`));
            }
        }

        // 3. Typecheck what was generated, before anything is replaced.
        await (typecheck ?? ((staged, work) => typecheckStaged(root, staged, work)))(stagedDir, workDir);

        // 4. Replace the output. A full run also removes the folders of specs that are gone.
        const removed: string[] = [];
        if (options.service === undefined) {
            let existing: string[] = [];
            try {
                existing = await readdir(outDir);
            } catch (error) {
                if (!isNotFound(error)) {
                    throw error;
                }
            }
            for (const entry of existing) {
                if (!names.includes(entry) && (await isDirectory(path.join(outDir, entry)))) {
                    removed.push(entry);
                }
            }
        }
        await swapIn(outDir, stagedDir, backupDir, names, removed);

        const display = (name: string) => {
            const relative = path.relative(root, path.join(outDir, name));
            return relative.startsWith('..') ? path.join(outDir, name) : relative.split(path.sep).join('/');
        };
        return {
            generated: names.map((name) => ({ name, operations: operations.get(name) ?? 0, folder: display(name) })),
            removed,
            generatorVersion: await generatorVersion(root)
        };
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}

/** The text printed after a run. */
export function formatSummary(result: GenerateResult): string {
    const lines = [`Generated ${result.generated.length} ${result.generated.length === 1 ? 'spec' : 'specs'} with @hey-api/openapi-ts ${result.generatorVersion}.`];
    const width = Math.max(...result.generated.map((spec) => spec.name.length));
    for (const spec of result.generated) {
        lines.push(`  ${spec.name.padEnd(width)}  ${String(spec.operations).padStart(2)} ${spec.operations === 1 ? 'operation ' : 'operations'}  ${spec.folder}/`);
    }
    for (const name of result.removed) {
        lines.push(`  removed ${name}/ (no spec of that name)`);
    }
    return lines.join('\n');
}

/** What `npm run generate` does: prints the summary or the problems, and returns the exit code (0 done, 1 failed, 2 wrong usage). */
export async function runCli(options: { root: string; argv: string[]; typecheck?: GenerateOptions['typecheck'] }): Promise<number> {
    let service: string | undefined;
    try {
        const parsed = parseArgs({ args: options.argv, options: { service: { type: 'string' } } });
        service = parsed.values.service;
    } catch (error) {
        console.error(`${firstLine(error)}\nUsage: npm run generate [-- --service <spec name>]`);
        return 2;
    }
    try {
        console.log(formatSummary(await generate({ root: options.root, service, typecheck: options.typecheck })));
        return 0;
    } catch (error) {
        if (error instanceof UsageError) {
            console.error(error.message);
            return 2;
        }
        if (error instanceof GenerateError) {
            console.error(`generate failed. src/generated/ was not changed.\n${error.message}`);
            return 1;
        }
        throw error;
    }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await runCli({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), argv: process.argv.slice(2) });
}
