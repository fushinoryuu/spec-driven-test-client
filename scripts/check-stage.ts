// Checks that a deployed stage is ready for tests. Run it with `npm run check-stage -- dev`
// (or `prod`, and add `--warmup` to wake a paused database).
//
// For every service that has a spec in specs/, it calls the open routes `GET /v0/health` and
// `GET /v0/version`, then compares the spec versions the service reports (`specVersions`, keyed by
// version prefix) with the `info.version` of the library spec whose file suffix matches the key.
// The suffix decides, never the major of `info.version`, because the 0.x drafts serve `/v1`.
// With `--warmup` it also calls the readiness operation (`getReadiness`) of the services that
// have one, which needs the `tests` API key and wakes a paused database. Never run that on a
// schedule: a database that is queried all the time does not pause.
//
// The script uses plain `fetch`, because the generated clients arrive in Phase 2. Node runs this
// file directly, so keep to syntax it can strip.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { environments, STAGES, type Stage } from '../config/environments.ts';

/** `<service>-service-v<N>.yaml`, for example `orders-service-v1.yaml` (decision record 0001). */
const SPEC_FILE_NAME = /^([a-z0-9]+(?:-[a-z0-9]+)*-service)-(v\d+)\.yaml$/;

export const DEFAULTS = {
    /** Longest wait for the open routes, which never touch the database. */
    requestTimeoutMs: 10_000,
    /** Overall time budget for a warm-up, enough for a database that needs 30 seconds or more to resume. */
    warmupBudgetMs: 90_000,
    /** One warm-up call. API Gateway gives up at 29 seconds, so a longer wait only hides a dead connection. */
    warmupAttemptTimeoutMs: 35_000,
    /** Wait before the next warm-up call when the answer has no usable `Retry-After`. */
    warmupDefaultDelayMs: 5_000
};

export interface LibrarySpec {
    file: string;
    /** For example `orders-service`. */
    service: string;
    /** The version prefix from the file name, for example `v1`. */
    prefix: string;
    /** The `info.version` of the file. */
    version: string;
    /** The path of the `getReadiness` operation, when the spec has one. */
    readinessPath?: string;
}

export type VersionStatus = 'ok' | 'mismatch' | 'not served' | 'no library spec' | 'not checked';

export interface VersionRow {
    prefix: string;
    /** What the service reports in `specVersions`. */
    deployed?: string;
    /** The `info.version` of the library spec. */
    expected?: string;
    status: VersionStatus;
}

export interface ReadinessResult {
    ok: boolean;
    elapsedMs?: number;
    attempts?: number;
}

export interface ServiceReport {
    service: string;
    health: 'ok' | 'failed' | 'not checked';
    /** The stage the service reports in `GET /v0/version`. */
    reportedStage?: string;
    versions: VersionRow[];
    /** Present only with `--warmup`, for a service that has a readiness operation. */
    readiness?: ReadinessResult;
    problems: string[];
}

export interface StageReport {
    stage: Stage;
    warmup: boolean;
    services: ServiceReport[];
    /** Problems that belong to no one service. */
    problems: string[];
    ok: boolean;
}

export interface CheckStageOptions {
    stage: Stage;
    warmup: boolean;
    /** The folder with the library specs. */
    specsDir: string;
    /** Base URL per service name, such as `orders-service`, without the version prefix. */
    baseUrls: Record<string, string>;
    /** Where the `tests` API key is read from. */
    env: Record<string, string | undefined>;
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    requestTimeoutMs?: number;
    warmupBudgetMs?: number;
    warmupAttemptTimeoutMs?: number;
    warmupDefaultDelayMs?: number;
}

export class CheckStageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CheckStageError';
    }
}

type Answer = { kind: 'response'; status: number; retryAfter: string | null; body: unknown } | { kind: 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** The name of the environment variable that holds the `tests` key of a stage (the Phase 3 naming). */
export function keyVariableName(stage: Stage): string {
    return `APITEST_${stage.toUpperCase()}_TESTS_API_KEY`;
}

function prefixNumber(prefix: string): number {
    return Number(prefix.slice(1));
}

function byPrefix(a: string, b: string): number {
    return prefixNumber(a) - prefixNumber(b);
}

function seconds(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

/** Reads every `<service>-service-v<N>.yaml` in a folder. Other files are ignored. */
export async function loadLibrarySpecs(specsDir: string): Promise<{ specs: LibrarySpec[]; problems: string[] }> {
    let names: string[];
    try {
        names = await readdir(specsDir);
    } catch (error) {
        if (isNotFound(error)) {
            throw new CheckStageError(`The spec folder ${specsDir} does not exist. Run npm run copy-specs first.`);
        }
        throw error;
    }

    const specs: LibrarySpec[] = [];
    const problems: string[] = [];
    for (const name of names.sort()) {
        const match = SPEC_FILE_NAME.exec(name);
        if (match === null) {
            continue;
        }
        let document: unknown;
        try {
            document = parse(await readFile(path.join(specsDir, name), 'utf8'));
        } catch (error) {
            problems.push(`${name} could not be read (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).`);
            continue;
        }
        const info = isRecord(document) ? document.info : undefined;
        if (!isRecord(info) || typeof info.version !== 'string' || info.version === '') {
            problems.push(`${name} has no "info.version".`);
            continue;
        }
        specs.push({ file: name, service: match[1], prefix: match[2], version: info.version, readinessPath: findReadinessPath(document) });
    }
    if (specs.length === 0 && problems.length === 0) {
        throw new CheckStageError(`No <service>-service-v<N>.yaml files found in ${specsDir}. Run npm run copy-specs first.`);
    }
    return { specs, problems };
}

/** The path of the `getReadiness` operation of a spec, if it has one. */
function findReadinessPath(document: unknown): string | undefined {
    const paths = isRecord(document) ? document.paths : undefined;
    if (!isRecord(paths)) {
        return undefined;
    }
    for (const [route, item] of Object.entries(paths)) {
        const operation = isRecord(item) ? item.get : undefined;
        if (isRecord(operation) && operation.operationId === 'getReadiness') {
            return route;
        }
    }
    return undefined;
}

function describeError(error: unknown, timeoutMs: number): string {
    if (error instanceof Error && error.name === 'TimeoutError') {
        return `no answer within ${seconds(timeoutMs)}`;
    }
    if (error instanceof Error) {
        const cause = error.cause;
        const code = isRecord(cause) && typeof cause.code === 'string' ? ` (${cause.code})` : '';
        return `${error.message}${code}`;
    }
    return String(error);
}

async function get(fetchFn: typeof fetch, url: string, headers: Record<string, string>, timeoutMs: number): Promise<Answer> {
    try {
        const response = await fetchFn(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
        const text = await response.text();
        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            body = undefined;
        }
        return { kind: 'response', status: response.status, retryAfter: response.headers.get('retry-after'), body };
    } catch (error) {
        return { kind: 'error', message: describeError(error, timeoutMs) };
    }
}

function joinUrl(baseUrl: string, route: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${route}`;
}

function describeAnswer(answer: Answer): string {
    return answer.kind === 'error' ? answer.message : `answered ${answer.status}`;
}

/** `Retry-After` in whole seconds. A date is not supported, because the Storefront sends seconds. */
function retryAfterMs(value: string | null): number | undefined {
    if (value === null || !/^\d+$/.test(value.trim())) {
        return undefined;
    }
    return Number(value.trim()) * 1000;
}

interface Context {
    options: CheckStageOptions;
    fetchFn: typeof fetch;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    requestTimeoutMs: number;
}

/** Calls the readiness route until it answers 200, retrying on 503 and 504 within the time budget. */
async function warmUp(url: string, key: string, context: Context): Promise<{ result: ReadinessResult; problem?: string }> {
    const { options, fetchFn, sleep, now } = context;
    const budgetMs = options.warmupBudgetMs ?? DEFAULTS.warmupBudgetMs;
    const attemptTimeoutMs = options.warmupAttemptTimeoutMs ?? DEFAULTS.warmupAttemptTimeoutMs;
    const defaultDelayMs = options.warmupDefaultDelayMs ?? DEFAULTS.warmupDefaultDelayMs;
    const start = now();
    const deadline = start + budgetMs;
    let attempts = 0;
    let last = 'no answer yet';

    for (;;) {
        const remaining = deadline - now();
        if (remaining <= 0) {
            break;
        }
        attempts++;
        const answer = await get(fetchFn, url, { 'x-api-key': key }, Math.min(attemptTimeoutMs, remaining));
        if (answer.kind === 'response' && answer.status === 200) {
            return { result: { ok: true, elapsedMs: now() - start, attempts } };
        }
        if (answer.kind === 'error' || (answer.status !== 503 && answer.status !== 504)) {
            const hint = answer.kind === 'response' && answer.status === 403 ? ' The key is missing, unknown or not allowed for this route.' : '';
            return { result: { ok: false, elapsedMs: now() - start, attempts }, problem: `readiness failed: ${describeAnswer(answer)}.${hint}` };
        }
        last = describeAnswer(answer);
        const delayMs = retryAfterMs(answer.retryAfter) ?? defaultDelayMs;
        if (now() + delayMs >= deadline) {
            break;
        }
        await sleep(delayMs);
    }
    return { result: { ok: false, elapsedMs: now() - start, attempts }, problem: `readiness did not succeed within ${seconds(budgetMs)} (${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}, last ${last}).` };
}

function checkVersions(specs: LibrarySpec[], served: Record<string, string> | undefined): VersionRow[] {
    const prefixes = new Set([...specs.map((spec) => spec.prefix), ...Object.keys(served ?? {})]);
    return [...prefixes].sort(byPrefix).map((prefix): VersionRow => {
        const expected = specs.find((spec) => spec.prefix === prefix)?.version;
        if (served === undefined) {
            return { prefix, expected, status: 'not checked' };
        }
        const deployed = served[prefix];
        if (expected === undefined) {
            return { prefix, deployed, status: 'no library spec' };
        }
        if (deployed === undefined) {
            return { prefix, expected, status: 'not served' };
        }
        return { prefix, deployed, expected, status: deployed === expected ? 'ok' : 'mismatch' };
    });
}

/** Reads the `specVersions` object of a version answer, or returns the reason it cannot be used. */
function readVersionBody(body: unknown): { stage: string; specVersions: Record<string, string> } | string {
    if (!isRecord(body) || typeof body.stage !== 'string' || !isRecord(body.specVersions)) {
        return 'the answer has no "stage" and "specVersions"';
    }
    const specVersions: Record<string, string> = {};
    for (const [prefix, version] of Object.entries(body.specVersions)) {
        if (typeof version !== 'string') {
            return `"specVersions.${prefix}" is not a string`;
        }
        specVersions[prefix] = version;
    }
    return { stage: body.stage, specVersions };
}

async function checkService(service: string, specs: LibrarySpec[], context: Context): Promise<ServiceReport> {
    const { options, fetchFn, requestTimeoutMs } = context;
    const report: ServiceReport = { service, health: 'not checked', versions: checkVersions(specs, undefined), problems: [] };

    const baseUrl = options.baseUrls[service];
    if (baseUrl === undefined || baseUrl === '') {
        report.problems.push(`no base URL in stage ${options.stage}. Add "${service}" to config/environments.ts.`);
        return report;
    }

    const health = await get(fetchFn, joinUrl(baseUrl, '/v0/health'), {}, requestTimeoutMs);
    if (health.kind === 'response' && health.status === 200 && isRecord(health.body) && health.body.status === 'ok') {
        report.health = 'ok';
    } else {
        report.health = 'failed';
        report.problems.push(`GET /v0/health ${health.kind === 'response' && health.status === 200 ? 'answered 200 without { "status": "ok" }' : describeAnswer(health)}.`);
    }

    const version = await get(fetchFn, joinUrl(baseUrl, '/v0/version'), {}, requestTimeoutMs);
    if (version.kind === 'error' || version.status !== 200) {
        report.problems.push(`GET /v0/version ${describeAnswer(version)}.`);
    } else {
        const read = readVersionBody(version.body);
        if (typeof read === 'string') {
            report.problems.push(`GET /v0/version: ${read}.`);
        } else {
            report.reportedStage = read.stage;
            report.versions = checkVersions(specs, read.specVersions);
            if (read.stage !== options.stage) {
                report.problems.push(`the service reports stage "${read.stage}", but the selected stage is "${options.stage}".`);
            }
            for (const row of report.versions) {
                if (row.status === 'mismatch') {
                    report.problems.push(`${row.prefix}: the service serves spec ${row.deployed}, but the library has ${row.expected}.`);
                } else if (row.status === 'no library spec') {
                    report.problems.push(`${row.prefix}: the service serves it (spec ${row.deployed}), but the library has no ${service}-${row.prefix}.yaml.`);
                } else if (row.status === 'not served') {
                    report.problems.push(`${row.prefix}: the library has ${service}-${row.prefix}.yaml (${row.expected}), but the service does not serve ${row.prefix}.`);
                }
            }
        }
    }

    if (options.warmup) {
        const readinessPath = specs.find((spec) => spec.readinessPath !== undefined)?.readinessPath;
        if (readinessPath !== undefined) {
            const variable = keyVariableName(options.stage);
            const key = options.env[variable];
            if (key === undefined || key === '') {
                report.readiness = { ok: false };
                report.problems.push(`readiness not called: ${variable} is not set.`);
            } else {
                const { result, problem } = await warmUp(joinUrl(baseUrl, readinessPath), key, context);
                report.readiness = result;
                if (problem !== undefined) {
                    report.problems.push(problem);
                }
            }
        }
    }
    return report;
}

/** Runs every check for one stage. Throws `CheckStageError` when the library specs cannot be read at all. */
export async function checkStage(options: CheckStageOptions): Promise<StageReport> {
    const context: Context = {
        options,
        fetchFn: options.fetch ?? fetch,
        sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        now: options.now ?? Date.now,
        requestTimeoutMs: options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs
    };

    const { specs, problems } = await loadLibrarySpecs(options.specsDir);
    const services = [...new Set(specs.map((spec) => spec.service))].sort();
    const reports: ServiceReport[] = [];
    for (const service of services) {
        reports.push(
            await checkService(
                service,
                specs.filter((spec) => spec.service === service),
                context
            )
        );
    }
    if (options.warmup && !specs.some((spec) => spec.readinessPath !== undefined)) {
        problems.push('--warmup was given, but no library spec has a getReadiness operation.');
    }

    const ok = problems.length === 0 && reports.every((report) => report.problems.length === 0);
    return { stage: options.stage, warmup: options.warmup, services: reports, problems, ok };
}

function renderTable(rows: string[][]): string {
    const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
    return rows
        .map((row) =>
            row
                .map((cell, column) => cell.padEnd(widths[column]))
                .join('  ')
                .trimEnd()
        )
        .join('\n');
}

/** The table and the list of problems printed after a run. */
export function formatReport(report: StageReport): string {
    const header = ['Service', 'Health', 'Stage', 'Version', 'Deployed', 'Expected', 'Check'];
    if (report.warmup) {
        header.push('Readiness');
    }
    const rows: string[][] = [header];
    const labels: Record<VersionStatus, string> = { ok: 'ok', mismatch: 'MISMATCH', 'not served': 'NOT SERVED', 'no library spec': 'NO LIBRARY SPEC', 'not checked': 'not checked' };

    for (const service of report.services) {
        const stage = service.reportedStage === undefined ? '-' : service.reportedStage === report.stage ? service.reportedStage : `${service.reportedStage} (expected ${report.stage})`;
        const readiness = service.readiness === undefined ? '-' : service.readiness.ok ? seconds(service.readiness.elapsedMs ?? 0) : 'FAILED';
        const lines = service.versions.length > 0 ? service.versions : [{ prefix: '-', status: 'not checked' as const }];
        lines.forEach((row, index) => {
            const first = index === 0;
            const cells = [first ? service.service : '', first ? (service.health === 'ok' ? 'ok' : service.health === 'failed' ? 'FAILED' : 'not checked') : '', first ? stage : '', row.prefix, row.deployed ?? '-', row.expected ?? '-', labels[row.status]];
            if (report.warmup) {
                cells.push(first ? readiness : '');
            }
            rows.push(cells);
        });
    }

    const lines = [`Stage ${report.stage}${report.warmup ? ' (with warm-up)' : ''}`, renderTable(rows)];
    const problems = [...report.problems.map((problem) => `  - ${problem}`), ...report.services.flatMap((service) => service.problems.map((problem) => `  - ${service.service}: ${problem}`))];
    if (problems.length > 0) {
        lines.push('', 'Problems:', ...problems);
    }
    lines.push('', report.ok ? `PASS: ${report.services.length} services are ready.` : `FAIL: ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} found.`);
    return lines.join('\n');
}

/** Replaces the key in a text. A key shorter than 8 characters is not a real key and is left alone. */
export function redact(text: string, key: string | undefined): string {
    return key === undefined || key.length < 8 ? text : text.replaceAll(key, '[redacted]');
}

export interface CliOptions {
    root: string;
    argv: string[];
    env?: Record<string, string | undefined>;
    /** Replaces the base URLs in config/environments.ts. */
    baseUrls?: Record<string, string>;
    specsDir?: string;
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    warmupBudgetMs?: number;
    log?: (text: string) => void;
    error?: (text: string) => void;
}

const USAGE = `Usage: npm run check-stage -- <stage> [--warmup]

  <stage>     ${STAGES.join(' or ')}
  --warmup    also call the readiness route of the services that have one, to wake a paused database.
              It needs the tests key in ${keyVariableName('dev').replace('DEV', '<STAGE>')}. Do not run it on a schedule.`;

function isStage(value: string): value is Stage {
    return (STAGES as readonly string[]).includes(value);
}

/** What `npm run check-stage` does: prints the report or the problem, and returns the exit code (0 pass, 1 check failed, 2 wrong usage). */
export async function runCli(options: CliOptions): Promise<number> {
    const log = options.log ?? ((text: string) => console.log(text));
    const error = options.error ?? ((text: string) => console.error(text));
    const env = options.env ?? process.env;

    let stage: string | undefined;
    let warmup: boolean;
    try {
        const parsed = parseArgs({ args: options.argv, allowPositionals: true, options: { warmup: { type: 'boolean' } } });
        if (parsed.positionals.length !== 1) {
            throw new Error('give exactly one stage');
        }
        stage = parsed.positionals[0];
        warmup = parsed.values.warmup === true;
    } catch (cause) {
        error(`${cause instanceof Error ? cause.message : String(cause)}\n${USAGE}`);
        return 2;
    }
    if (!isStage(stage)) {
        error(`Unknown stage "${stage}".\n${USAGE}`);
        return 2;
    }

    const key = env[keyVariableName(stage)];
    try {
        const report = await checkStage({
            stage,
            warmup,
            specsDir: options.specsDir ?? path.join(options.root, 'specs'),
            baseUrls: options.baseUrls ?? environments[stage],
            env,
            fetch: options.fetch,
            sleep: options.sleep,
            now: options.now,
            warmupBudgetMs: options.warmupBudgetMs
        });
        log(redact(formatReport(report), key));
        return report.ok ? 0 : 1;
    } catch (cause) {
        if (cause instanceof CheckStageError) {
            error(redact(`check-stage failed: ${cause.message}`, key));
            return 1;
        }
        throw cause;
    }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await runCli({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), argv: process.argv.slice(2) });
}
