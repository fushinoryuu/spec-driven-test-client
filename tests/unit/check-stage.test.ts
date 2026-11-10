import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckStageError, checkStage, formatReport, keyVariableName, loadLibrarySpecs, redact, runCli, type CheckStageOptions } from '../../scripts/check-stage.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'specs');
const KEY = 'tests-key-0123456789';
const WIDGETS = 'https://widgets.test';
const GADGETS = 'https://gadgets.test';

// The versions the widgets fixture specs declare: v0 0.1.0, v1 0.2.0, v2 0.1.0.
const WIDGETS_VERSIONS = { v0: '0.1.0', v1: '0.2.0', v2: '0.1.0' };

interface Call {
    url: URL;
    headers: Record<string, string>;
}

type Handler = (call: Call) => Response | Promise<Response>;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A fake `fetch` that records every call. Overrides are keyed by `host + path`, and anything else gets a healthy answer. */
function fakeServices(versions: Record<string, Record<string, string>>, overrides: Record<string, Handler> = {}) {
    const calls: Call[] = [];
    const fn = (async (input: string | URL | Request, init?: RequestInit) => {
        const call: Call = { url: new URL(String(input)), headers: { ...(init?.headers as Record<string, string> | undefined) } };
        calls.push(call);
        const override = overrides[`${call.url.host}${call.url.pathname}`];
        if (override !== undefined) {
            return override(call);
        }
        if (call.url.pathname.endsWith('/v0/health')) {
            return json({ status: 'ok' });
        }
        if (call.url.pathname.endsWith('/v0/health/ready')) {
            return json({ status: 'ok' });
        }
        if (call.url.pathname.endsWith('/v0/version')) {
            return json({ buildId: 'abc1234', stage: 'dev', specVersions: versions[call.url.host] });
        }
        return json({ title: 'Not found' }, 404);
    }) as typeof fetch;
    return { fn, calls };
}

/** A clock that only moves when the code under test sleeps. */
function fakeClock() {
    let time = 0;
    const sleeps: number[] = [];
    return {
        now: () => time,
        sleep: async (ms: number) => {
            sleeps.push(ms);
            time += ms;
        },
        sleeps
    };
}

let work: string;

beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'check-stage-test-'));
});

afterEach(async () => {
    await rm(work, { recursive: true, force: true });
});

/** A folder with the three widgets fixture specs, and any extra files. */
async function specsFolder(extra: Record<string, string> = {}, fixtures = ['widgets-service-v0.yaml', 'widgets-service-v1.yaml', 'widgets-service-v2.yaml']): Promise<string> {
    const folder = path.join(work, `specs-${Math.random().toString(36).slice(2)}`);
    await mkdir(folder);
    for (const name of fixtures) {
        await cp(path.join(FIXTURES, name), path.join(folder, name));
    }
    for (const [name, content] of Object.entries(extra)) {
        await writeFile(path.join(folder, name), content);
    }
    return folder;
}

function minimalSpec(version: string, readiness = false): string {
    const paths = readiness ? '  /v0/health/ready:\n    get:\n      operationId: getReadiness\n' : '';
    return `openapi: 3.0.3\ninfo:\n  title: Test\n  version: ${version}\npaths:\n${paths === '' ? '  {}\n' : paths}`;
}

function options(specsDir: string, overrides: Partial<CheckStageOptions> = {}): CheckStageOptions {
    return { stage: 'dev', warmup: false, specsDir, baseUrls: { 'widgets-service': WIDGETS }, env: {}, ...overrides };
}

describe('checkStage', () => {
    it('passes when every service is healthy and every version matches', async () => {
        const specsDir = await specsFolder({ 'gadgets-service-v0.yaml': minimalSpec('0.1.0'), 'gadgets-service-v1.yaml': minimalSpec('0.3.0') });
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS, 'gadgets.test': { v0: '0.1.0', v1: '0.3.0' } });

        const report = await checkStage(options(specsDir, { baseUrls: { 'widgets-service': WIDGETS, 'gadgets-service': GADGETS }, fetch: server.fn }));

        expect(report.ok).toBe(true);
        expect(report.services.map((service) => service.service)).toEqual(['gadgets-service', 'widgets-service']);
        expect(report.services.every((service) => service.health === 'ok' && service.problems.length === 0)).toBe(true);
        expect(report.services[1].versions).toEqual([
            { prefix: 'v0', deployed: '0.1.0', expected: '0.1.0', status: 'ok' },
            { prefix: 'v1', deployed: '0.2.0', expected: '0.2.0', status: 'ok' },
            { prefix: 'v2', deployed: '0.1.0', expected: '0.1.0', status: 'ok' }
        ]);
    });

    it('calls only the open routes and sends no key without --warmup', async () => {
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS });

        await checkStage(options(await specsFolder(), { env: { [keyVariableName('dev')]: KEY }, fetch: server.fn }));

        expect(server.calls.map((call) => call.url.pathname)).toEqual(['/v0/health', '/v0/version']);
        expect(server.calls.every((call) => Object.keys(call.headers).length === 0)).toBe(true);
    });

    it('fails for a service that cannot be reached and still checks the others', async () => {
        const specsDir = await specsFolder({ 'gadgets-service-v0.yaml': minimalSpec('0.1.0') });
        const refused = () => {
            throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) });
        };
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS, 'gadgets.test': { v0: '0.1.0' } }, { 'gadgets.test/v0/health': refused, 'gadgets.test/v0/version': refused });

        const report = await checkStage(options(specsDir, { baseUrls: { 'widgets-service': WIDGETS, 'gadgets-service': GADGETS }, fetch: server.fn }));

        expect(report.ok).toBe(false);
        const gadgets = report.services.find((service) => service.service === 'gadgets-service');
        expect(gadgets?.health).toBe('failed');
        expect(gadgets?.problems).toEqual(['GET /v0/health fetch failed (ECONNREFUSED).', 'GET /v0/version fetch failed (ECONNREFUSED).']);
        expect(gadgets?.versions).toEqual([{ prefix: 'v0', expected: '0.1.0', status: 'not checked' }]);
        expect(report.services.find((service) => service.service === 'widgets-service')?.problems).toEqual([]);
    });

    it('fails when a request gets no answer in time', async () => {
        const slow = () => {
            throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
        };
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS }, { 'widgets.test/v0/health': slow });

        const report = await checkStage(options(await specsFolder(), { fetch: server.fn, requestTimeoutMs: 2000 }));

        expect(report.services[0].problems).toEqual(['GET /v0/health no answer within 2.0s.']);
    });

    it('fails when the health answer is not ok', async () => {
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS }, { 'widgets.test/v0/health': () => json({ status: 'degraded' }) });

        const report = await checkStage(options(await specsFolder(), { fetch: server.fn }));

        expect(report.services[0].health).toBe('failed');
        expect(report.services[0].problems).toEqual(['GET /v0/health answered 200 without { "status": "ok" }.']);
    });

    it('fails for a service with no base URL', async () => {
        const server = fakeServices({});

        const report = await checkStage(options(await specsFolder(), { baseUrls: {}, fetch: server.fn }));

        expect(report.ok).toBe(false);
        expect(report.services[0].problems).toEqual(['no base URL in stage dev. Add "widgets-service" to config/environments.ts.']);
        expect(server.calls).toEqual([]);
    });

    it('reports a mismatch for one version while another matches', async () => {
        const server = fakeServices({ 'widgets.test': { ...WIDGETS_VERSIONS, v1: '0.1.0' } });

        const report = await checkStage(options(await specsFolder(), { fetch: server.fn }));

        expect(report.ok).toBe(false);
        expect(report.services[0].versions.map((row) => [row.prefix, row.status])).toEqual([
            ['v0', 'ok'],
            ['v1', 'mismatch'],
            ['v2', 'ok']
        ]);
        expect(report.services[0].problems).toEqual(['v1: the service serves spec 0.1.0, but the library has 0.2.0.']);
    });

    it('matches by the file suffix and not by the major of info.version', async () => {
        // v1 is at 0.2.0: a 0.x business spec that serves /v1. A major-based match would pair it with v0.
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS });

        const report = await checkStage(options(await specsFolder(), { fetch: server.fn }));

        expect(report.services[0].versions.find((row) => row.prefix === 'v1')).toEqual({ prefix: 'v1', deployed: '0.2.0', expected: '0.2.0', status: 'ok' });
    });

    it('fails when the reported stage is not the selected one', async () => {
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS }, { 'widgets.test/v0/version': () => json({ buildId: 'abc1234', stage: 'prod', specVersions: WIDGETS_VERSIONS }) });

        const report = await checkStage(options(await specsFolder(), { fetch: server.fn }));

        expect(report.ok).toBe(false);
        expect(report.services[0].reportedStage).toBe('prod');
        expect(report.services[0].problems).toEqual(['the service reports stage "prod", but the selected stage is "dev".']);
        expect(formatReport(report)).toContain('prod (expected dev)');
    });

    it('fails for a prefix that is served without a library spec, and for a library spec that is not served', async () => {
        const served = { v0: '0.1.0', v1: '0.2.0', v3: '0.1.0' };
        const server = fakeServices({ 'widgets.test': served });

        const report = await checkStage(options(await specsFolder(), { fetch: server.fn }));

        expect(report.services[0].versions.map((row) => [row.prefix, row.status])).toEqual([
            ['v0', 'ok'],
            ['v1', 'ok'],
            ['v2', 'not served'],
            ['v3', 'no library spec']
        ]);
        expect(report.services[0].problems).toEqual(['v2: the library has widgets-service-v2.yaml (0.1.0), but the service does not serve v2.', 'v3: the service serves it (spec 0.1.0), but the library has no widgets-service-v3.yaml.']);
    });

    it('fails when the version answer cannot be used', async () => {
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS }, { 'widgets.test/v0/version': () => json({ stage: 'dev' }) });

        const report = await checkStage(options(await specsFolder(), { fetch: server.fn }));

        expect(report.services[0].problems).toEqual(['GET /v0/version: the answer has no "stage" and "specVersions".']);
        expect(report.services[0].versions.every((row) => row.status === 'not checked')).toBe(true);
    });

    it('joins the route to a base URL that has a path and a trailing slash', async () => {
        const server = fakeServices({ 'api.test': WIDGETS_VERSIONS });

        await checkStage(options(await specsFolder(), { baseUrls: { 'widgets-service': 'https://api.test/dev/' }, fetch: server.fn }));

        expect(server.calls.map((call) => call.url.pathname)).toEqual(['/dev/v0/health', '/dev/v0/version']);
    });
});

describe('checkStage with --warmup', () => {
    const readyPath = 'widgets.test/v0/health/ready';

    it('succeeds after a 503, honors Retry-After and reports how long it took', async () => {
        const clock = fakeClock();
        let answers = 0;
        const ready: Handler = () => {
            answers++;
            if (answers === 1) {
                return json({ title: 'Service unavailable' }, 503, { 'Retry-After': '20' });
            }
            return answers === 2 ? json({ title: 'Service unavailable' }, 503) : json({ status: 'ok' });
        };
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS }, { [readyPath]: ready });

        const report = await checkStage(options(await specsFolder(), { warmup: true, env: { [keyVariableName('dev')]: KEY }, fetch: server.fn, sleep: clock.sleep, now: clock.now }));

        expect(report.ok).toBe(true);
        expect(report.services[0].readiness).toEqual({ ok: true, elapsedMs: 25_000, attempts: 3 });
        expect(clock.sleeps).toEqual([20_000, 5_000]);
        const readyCalls = server.calls.filter((call) => call.url.pathname === '/v0/health/ready');
        expect(readyCalls).toHaveLength(3);
        expect(readyCalls.every((call) => call.headers['x-api-key'] === KEY)).toBe(true);
        expect(formatReport(report)).toContain('25.0s');
    });

    it('also retries on a 504', async () => {
        const clock = fakeClock();
        let answers = 0;
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS }, { [readyPath]: () => (++answers === 1 ? json({ message: 'Endpoint request timed out' }, 504) : json({ status: 'ok' })) });

        const report = await checkStage(options(await specsFolder(), { warmup: true, env: { [keyVariableName('dev')]: KEY }, fetch: server.fn, sleep: clock.sleep, now: clock.now }));

        expect(report.services[0].readiness).toMatchObject({ ok: true, attempts: 2 });
    });

    it('ignores a Retry-After that is not whole seconds', async () => {
        const clock = fakeClock();
        let answers = 0;
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS }, { [readyPath]: () => (++answers === 1 ? json({}, 503, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }) : json({ status: 'ok' })) });

        await checkStage(options(await specsFolder(), { warmup: true, env: { [keyVariableName('dev')]: KEY }, fetch: server.fn, sleep: clock.sleep, now: clock.now }));

        expect(clock.sleeps).toEqual([5_000]);
    });

    it('fails when the time budget runs out', async () => {
        const clock = fakeClock();
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS }, { [readyPath]: () => json({ title: 'Service unavailable' }, 503, { 'Retry-After': '30' }) });

        const report = await checkStage(options(await specsFolder(), { warmup: true, env: { [keyVariableName('dev')]: KEY }, fetch: server.fn, sleep: clock.sleep, now: clock.now, warmupBudgetMs: 90_000 }));

        expect(report.ok).toBe(false);
        expect(report.services[0].readiness).toMatchObject({ ok: false, attempts: 3 });
        expect(report.services[0].problems).toEqual(['readiness did not succeed within 90.0s (3 attempts, last answered 503).']);
        expect(clock.sleeps).toEqual([30_000, 30_000]);
    });

    it('fails at once on an answer that is not worth retrying', async () => {
        const clock = fakeClock();
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS }, { [readyPath]: () => json({ title: 'Forbidden' }, 403) });

        const report = await checkStage(options(await specsFolder(), { warmup: true, env: { [keyVariableName('dev')]: KEY }, fetch: server.fn, sleep: clock.sleep, now: clock.now }));

        expect(report.services[0].readiness).toMatchObject({ ok: false, attempts: 1 });
        expect(report.services[0].problems).toEqual(['readiness failed: answered 403. The key is missing, unknown or not allowed for this route.']);
        expect(clock.sleeps).toEqual([]);
    });

    it('does not call the readiness route when the tests key is missing', async () => {
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS });

        const report = await checkStage(options(await specsFolder(), { warmup: true, env: {}, fetch: server.fn }));

        expect(report.ok).toBe(false);
        expect(report.services[0].readiness).toEqual({ ok: false });
        expect(report.services[0].problems).toEqual(['readiness not called: APITEST_DEV_TESTS_API_KEY is not set.']);
        expect(server.calls.map((call) => call.url.pathname)).toEqual(['/v0/health', '/v0/version']);
    });

    it('reads the key variable of the selected stage', async () => {
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS });

        const report = await checkStage(options(await specsFolder(), { stage: 'prod', warmup: true, env: { [keyVariableName('dev')]: KEY }, fetch: server.fn }));

        expect(report.services[0].problems).toContain('readiness not called: APITEST_PROD_TESTS_API_KEY is not set.');
    });

    it('calls only the services whose spec has a getReadiness operation', async () => {
        const specsDir = await specsFolder({ 'gadgets-service-v0.yaml': minimalSpec('0.1.0') });
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS, 'gadgets.test': { v0: '0.1.0' } });

        const report = await checkStage(options(specsDir, { warmup: true, baseUrls: { 'widgets-service': WIDGETS, 'gadgets-service': GADGETS }, env: { [keyVariableName('dev')]: KEY }, fetch: server.fn }));

        expect(report.ok).toBe(true);
        expect(report.services.find((service) => service.service === 'gadgets-service')?.readiness).toBeUndefined();
        expect(server.calls.filter((call) => call.url.pathname === '/v0/health/ready').map((call) => call.url.host)).toEqual(['widgets.test']);
    });

    it('reports a problem when no spec has a getReadiness operation', async () => {
        const specsDir = await specsFolder({}, ['widgets-service-v1.yaml']);
        const server = fakeServices({ 'widgets.test': { v1: '0.2.0' } });

        const report = await checkStage(options(specsDir, { warmup: true, env: { [keyVariableName('dev')]: KEY }, fetch: server.fn }));

        expect(report.ok).toBe(false);
        expect(report.problems).toEqual(['--warmup was given, but no library spec has a getReadiness operation.']);
    });
});

describe('loadLibrarySpecs', () => {
    it('reads the service, the prefix, the info.version and the readiness path from each spec', async () => {
        const { specs, problems } = await loadLibrarySpecs(await specsFolder());

        expect(problems).toEqual([]);
        expect(specs.map(({ file, service, prefix, version, readinessPath }) => ({ file, service, prefix, version, readinessPath }))).toEqual([
            { file: 'widgets-service-v0.yaml', service: 'widgets-service', prefix: 'v0', version: '0.1.0', readinessPath: '/v0/health/ready' },
            { file: 'widgets-service-v1.yaml', service: 'widgets-service', prefix: 'v1', version: '0.2.0', readinessPath: undefined },
            { file: 'widgets-service-v2.yaml', service: 'widgets-service', prefix: 'v2', version: '0.1.0', readinessPath: undefined }
        ]);
    });

    it('ignores files that are not named like a spec', async () => {
        const { specs } = await loadLibrarySpecs(await specsFolder({ 'notes.txt': 'x', 'widgets.yaml': 'x' }));

        expect(specs).toHaveLength(3);
    });

    it('reports a spec without an info.version and keeps the others', async () => {
        const { specs, problems } = await loadLibrarySpecs(await specsFolder({ 'gadgets-service-v1.yaml': 'openapi: 3.0.3\ninfo:\n  title: Test\npaths: {}\n' }));

        expect(specs).toHaveLength(3);
        expect(problems).toEqual(['gadgets-service-v1.yaml has no "info.version".']);
    });

    it('fails clearly when the folder is missing or has no specs', async () => {
        await expect(loadLibrarySpecs(path.join(work, 'missing'))).rejects.toThrow(/does not exist.*copy-specs/);
        const empty = path.join(work, 'empty');
        await mkdir(empty);
        await expect(loadLibrarySpecs(empty)).rejects.toBeInstanceOf(CheckStageError);
    });
});

describe('formatReport', () => {
    it('has the listed columns, and a readiness column only with --warmup', async () => {
        const specsDir = await specsFolder();
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS });
        const clock = fakeClock();

        const plain = formatReport(await checkStage(options(specsDir, { fetch: server.fn })));
        const warmed = formatReport(await checkStage(options(specsDir, { warmup: true, env: { [keyVariableName('dev')]: KEY }, fetch: server.fn, sleep: clock.sleep, now: clock.now })));

        expect(plain.split('\n')[1]).toMatch(/^Service\s+Health\s+Stage\s+Version\s+Deployed\s+Expected\s+Check$/);
        expect(plain).not.toContain('Readiness');
        expect(warmed.split('\n')[1]).toMatch(/^Service\s+Health\s+Stage\s+Version\s+Deployed\s+Expected\s+Check\s+Readiness$/);
        expect(warmed).toMatch(/widgets-service\s+ok\s+dev\s+v0\s+0\.1\.0\s+0\.1\.0\s+ok\s+0\.0s/);
        expect(plain).toContain('PASS: 1 services are ready.');
    });

    it('lists the problems under the table', async () => {
        const server = fakeServices({ 'widgets.test': { ...WIDGETS_VERSIONS, v2: '0.0.9' } });

        const text = formatReport(await checkStage(options(await specsFolder(), { fetch: server.fn })));

        expect(text).toContain('MISMATCH');
        expect(text).toContain('Problems:\n  - widgets-service: v2: the service serves spec 0.0.9, but the library has 0.1.0.');
        expect(text).toContain('FAIL: 1 problem found.');
    });
});

describe('redact', () => {
    it('replaces every occurrence of a key and leaves short values alone', () => {
        expect(redact(`a ${KEY} b ${KEY}`, KEY)).toBe('a [redacted] b [redacted]');
        expect(redact('ok ok', 'ok')).toBe('ok ok');
        expect(redact('text', undefined)).toBe('text');
    });
});

describe('runCli', () => {
    async function run(argv: string[], overrides: Partial<Parameters<typeof runCli>[0]> = {}) {
        const out: string[] = [];
        const err: string[] = [];
        const code = await runCli({ root: path.join(FIXTURES, '..', '..', '..'), argv, specsDir: await specsFolder(), baseUrls: { 'widgets-service': WIDGETS }, env: {}, log: (text) => out.push(text), error: (text) => err.push(text), ...overrides });
        return { code, out: out.join('\n'), err: err.join('\n') };
    }

    it('exits 0 when every check passes and prints the table', async () => {
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS });

        const { code, out, err } = await run(['dev'], { fetch: server.fn });

        expect(code).toBe(0);
        expect(err).toBe('');
        expect(out).toContain('PASS');
    });

    it('exits 1 when any check fails', async () => {
        const server = fakeServices({ 'widgets.test': { ...WIDGETS_VERSIONS, v0: '9.9.9' } });

        const { code, out } = await run(['dev'], { fetch: server.fn });

        expect(code).toBe(1);
        expect(out).toContain('FAIL');
    });

    it('exits 1 with a message when the specs folder is missing', async () => {
        const { code, err } = await run(['dev'], { specsDir: path.join(work, 'missing'), fetch: fakeServices({}).fn });

        expect(code).toBe(1);
        expect(err).toMatch(/check-stage failed: The spec folder .* does not exist/);
    });

    it('exits 2 and prints the usage for a missing stage, an unknown stage or an unknown flag', async () => {
        for (const argv of [[], ['staging'], ['dev', 'prod'], ['dev', '--retries']]) {
            const { code, err } = await run(argv);
            expect(code).toBe(2);
            expect(err).toContain('Usage: npm run check-stage');
        }
    });

    it('passes --warmup on to the check', async () => {
        const clock = fakeClock();
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS });

        const { code, out } = await run(['prod', '--warmup'], { env: { [keyVariableName('prod')]: KEY }, fetch: server.fn, sleep: clock.sleep, now: clock.now });

        // The fake services report the stage "dev", so selecting prod fails on the stage, and the warm-up still ran.
        expect(code).toBe(1);
        expect(out).toContain('Stage prod (with warm-up)');
        expect(server.calls.some((call) => call.url.pathname === '/v0/health/ready' && call.headers['x-api-key'] === KEY)).toBe(true);
    });

    it('never prints a key that is set in the environment', async () => {
        const clock = fakeClock();
        const server = fakeServices({ 'widgets.test': WIDGETS_VERSIONS });

        const passing = await run(['dev', '--warmup'], { env: { [keyVariableName('dev')]: KEY }, fetch: server.fn, sleep: clock.sleep, now: clock.now });

        expect(passing.code).toBe(0);
        expect(passing.out + passing.err).not.toContain(KEY);
    });

    it('never prints a key even when an error message repeats it', async () => {
        const echo = fakeServices(
            { 'widgets.test': WIDGETS_VERSIONS },
            {
                'widgets.test/v0/health/ready': (call) => {
                    throw new Error(`could not send header x-api-key: ${call.headers['x-api-key']}`);
                }
            }
        );

        const failing = await run(['dev', '--warmup'], { env: { [keyVariableName('dev')]: KEY }, fetch: echo.fn });

        expect(failing.code).toBe(1);
        expect(failing.out).toContain('could not send header x-api-key: [redacted]');
        expect(failing.out + failing.err).not.toContain(KEY);
    });
});
