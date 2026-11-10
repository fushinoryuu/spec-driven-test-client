import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environments } from '../../config/environments.ts';
import { runCli as runStart } from '../../mock/start.ts';
import { defaultUrls, loadMockServices, MockError, startMocks, type MockService, type RunningMock } from '../../mock/server.ts';

const KEY = { 'x-api-key': 'any-key' };

// A small service that has what the Storefront specs have: a required query parameter, a required header and body, a 201 with a header,
// a 204, a literal route next to a templated one, a 403 with an example of its own, and the three ways to write an example.
const GADGETS_V0 = `
openapi: 3.0.3
info: { title: Gadgets operations, version: 0.1.0 }
security: [{ apiKey: [] }]
paths:
  /v0/health:
    get:
      operationId: getHealth
      security: []
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { type: object }
              example: { status: ok }
  /v0/version:
    get:
      operationId: getVersion
      security: []
      responses:
        '200':
          description: versions
          content:
            application/json:
              schema: { type: object }
              example: { buildId: 7768f92, stage: dev, specVersions: { v0: 9.9.9, v1: 9.9.9 } }
components:
  securitySchemes:
    apiKey: { type: apiKey, in: header, name: x-api-key }
`;

const GADGETS_V1 = `
openapi: 3.0.3
info: { title: Gadgets, version: 0.4.0 }
security: [{ apiKey: [] }]
paths:
  /v1/gadgets:
    get:
      operationId: listGadgets
      parameters:
        - { name: limit, in: query, required: true, schema: { type: integer } }
        - { name: cursor, in: query, required: false, schema: { type: string } }
      responses:
        '200':
          description: a page
          content:
            application/json:
              schema: { type: object }
              example: { items: [{ id: g-1 }], nextCursor: null }
        '403':
          description: forbidden
          content:
            application/json:
              schema: { type: object }
              example: { type: 'https://gadgets.example/problems/forbidden', title: Forbidden, status: 403, correlationId: c-403 }
    post:
      operationId: createGadget
      parameters:
        - { name: Idempotency-Key, in: header, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { type: object }
      responses:
        '201':
          description: created
          headers:
            Location: { schema: { type: string }, example: /v1/gadgets/g-2 }
          content:
            application/json:
              schema: { type: object }
              example: { id: g-2 }
        '409':
          description: conflict
          content:
            application/json:
              schema: { type: object }
              example: { title: Conflict, status: 409 }
        '503':
          description: unavailable
          headers:
            Retry-After: { schema: { type: integer }, example: 7 }
          content:
            application/json:
              schema: { type: object }
              example: { title: Unavailable, status: 503 }
  /v1/gadgets/featured:
    get:
      operationId: getFeaturedGadget
      responses:
        '200':
          description: the featured gadget
          content:
            application/json:
              schema: { type: object }
              example: { id: featured }
  /v1/gadgets/{gadgetId}:
    get:
      operationId: getGadget
      parameters:
        - { name: gadgetId, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: a gadget
          content:
            application/json:
              schema: { type: object }
              examples:
                first: { value: { id: from-examples } }
    delete:
      operationId: deleteGadget
      parameters:
        - { name: gadgetId, in: path, required: true, schema: { type: string } }
      responses:
        '204':
          description: deleted
  /v1/gadgets/{gadgetId}/summary:
    get:
      operationId: getSummary
      parameters:
        - { name: gadgetId, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: from the schema
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Summary' }
  /v1/gadgets/{gadgetId}/notes:
    get:
      operationId: getNotes
      parameters:
        - { name: gadgetId, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: no example anywhere
          content:
            application/json:
              schema: { type: object }
components:
  securitySchemes:
    apiKey: { type: apiKey, in: header, name: x-api-key }
  schemas:
    Summary:
      type: object
      example: { total: 3 }
`;

// Almost every test calls `respond`, which answers a request with no network. TCP connections on the development machine
// sometimes stall for 10 seconds or more when several test runs share it, so only the tests of the HTTP layer open sockets,
// and they get a long timeout.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let folder: string;
let running: RunningMock[] = [];

beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'mock-test-'));
    await writeFile(path.join(folder, 'gadgets-service-v0.yaml'), GADGETS_V0);
    await writeFile(path.join(folder, 'gadgets-service-v1.yaml'), GADGETS_V1);
});

afterEach(async () => {
    await Promise.all(running.map((mock) => mock.close()));
    running = [];
    await rm(folder, { recursive: true, force: true });
});

interface Reply {
    status: number;
    headers: Record<string, string>;
    body: unknown;
}

async function gadgets(options: { stage?: string } = {}): Promise<MockService> {
    const services = await loadMockServices(folder, options);
    return services.find((service) => service.service === 'gadgets-service')!;
}

/** Sends a request to the mock without a network. Header names are lower case. */
function ask(service: MockService, method: string, url: string, headers: Record<string, string> = KEY, body = ''): Reply {
    const answer = service.respond({ method, url, headers, body });
    return { status: answer.status, headers: answer.headers, body: answer.body === undefined || answer.body === '' ? undefined : JSON.parse(answer.body) };
}

const get = (service: MockService, url: string, headers: Record<string, string> = KEY): Reply => ask(service, 'GET', url, headers);
const JSON_HEADERS = { ...KEY, 'content-type': 'application/json' };
const create = (service: MockService, headers: Record<string, string>, body = '{}'): Reply => ask(service, 'POST', '/v1/gadgets', headers, body);

describe('serving the examples of the specs', () => {
    it('answers a route of the v0 spec and a route of the v1 spec of one service', async () => {
        const service = await gadgets();
        expect(get(service, '/v0/health', {}).body).toEqual({ status: 'ok' });
        expect(get(service, '/v1/gadgets?limit=5').body).toEqual({ items: [{ id: 'g-1' }], nextCursor: null });
    });

    it('answers the lowest success status the operation defines, with the headers that have an example', async () => {
        const answer = create(await gadgets(), { ...JSON_HEADERS, 'idempotency-key': 'k-1' }, '{"name":"x"}');
        expect(answer.status).toBe(201);
        expect(answer.headers.location).toBe('/v1/gadgets/g-2');
        expect(answer.body).toEqual({ id: 'g-2' });
    });

    it('answers a 204 with no body', async () => {
        const answer = ask(await gadgets(), 'DELETE', '/v1/gadgets/g-1');
        expect(answer.status).toBe(204);
        expect(answer.body).toBeUndefined();
    });

    it('reads an example from "examples" and from the schema when the response has no "example"', async () => {
        const service = await gadgets();
        expect(get(service, '/v1/gadgets/g-1').body).toEqual({ id: 'from-examples' });
        expect(get(service, '/v1/gadgets/g-1/summary').body).toEqual({ total: 3 });
    });

    it('prefers the literal route over a templated one', async () => {
        expect(get(await gadgets(), '/v1/gadgets/featured').body).toEqual({ id: 'featured' });
    });

    it('answers with no body and a warning header when the spec has no example, and lists it as a warning', async () => {
        const service = await gadgets();
        const answer = get(service, '/v1/gadgets/g-1/notes');
        expect(answer.status).toBe(200);
        expect(answer.body).toBeUndefined();
        expect(answer.headers['x-mock-warning']).toContain('getNotes');
        expect(service.warnings).toEqual(['gadgets-service getNotes (200): the response has a body but no example.']);
    });

    it('serves what the spec says after the spec changes, with no change to the mock', async () => {
        expect(get(await gadgets(), '/v1/gadgets?limit=5').body).toEqual({ items: [{ id: 'g-1' }], nextCursor: null });
        await writeFile(path.join(folder, 'gadgets-service-v1.yaml'), GADGETS_V1.replace('{ items: [{ id: g-1 }], nextCursor: null }', '{ items: [{ id: g-1 }, { id: g-new }], nextCursor: null }'));
        expect(get(await gadgets(), '/v1/gadgets?limit=5').body).toEqual({ items: [{ id: 'g-1' }, { id: 'g-new' }], nextCursor: null });
    });
});

describe('getVersion', () => {
    it('reports the specs it serves instead of the example, so the stage readiness check can pass', async () => {
        expect(get(await gadgets({ stage: 'local' }), '/v0/version', {}).body).toEqual({ buildId: 'mock', stage: 'local', specVersions: { v0: '0.1.0', v1: '0.4.0' } });
    });

    it('reports the stage it was started with, and "local" when none is given', async () => {
        expect((get(await gadgets({ stage: 'demo' }), '/v0/version', {}).body as { stage: string }).stage).toBe('demo');
        expect((get(await gadgets(), '/v0/version', {}).body as { stage: string }).stage).toBe('local');
    });
});

describe('what the mock checks', () => {
    it('answers 404 for a route no spec has, and 405 with the allowed methods for a wrong method', async () => {
        const service = await gadgets();
        expect(get(service, '/v1/nothing').status).toBe(404);
        const wrong = ask(service, 'POST', '/v1/gadgets/featured');
        expect(wrong.status).toBe(405);
        expect(wrong.headers.allow).toBe('GET, DELETE');
    });

    it('answers 403 when a route needs a key and none is sent, with the 403 example of the spec', async () => {
        const answer = get(await gadgets(), '/v1/gadgets?limit=5', {});
        expect(answer.status).toBe(403);
        expect(answer.body).toMatchObject({ correlationId: 'c-403' });
        expect(answer.headers['x-mock-reason']).toContain('x-api-key');
    });

    it('answers 403 in the Problem shape when the route needs a key and the spec defines no 403', async () => {
        const answer = get(await gadgets(), '/v1/gadgets/g-1', {});
        expect(answer.status).toBe(403);
        expect(answer.body).toMatchObject({ title: 'Forbidden', status: 403 });
    });

    it('accepts any key value, and needs no key on a route marked open', async () => {
        const service = await gadgets();
        expect(get(service, '/v1/gadgets?limit=5', { 'x-api-key': 'not-a-real-key' }).status).toBe(200);
        expect(get(service, '/v0/health', {}).status).toBe(200);
    });

    it('answers 400 when a required query parameter is missing, and accepts a missing optional one', async () => {
        const service = await gadgets();
        const missing = get(service, '/v1/gadgets');
        expect(missing.status).toBe(400);
        expect(missing.headers['x-mock-reason']).toContain('"limit"');
        expect(get(service, '/v1/gadgets?limit=5').status).toBe(200);
    });

    it('answers 400 when a required header or the required body is missing, or the body is not JSON', async () => {
        const service = await gadgets();
        expect(create(service, JSON_HEADERS).headers['x-mock-reason']).toContain('"Idempotency-Key"');
        const withKey = { ...JSON_HEADERS, 'idempotency-key': 'k' };
        expect(create(service, withKey, '').headers['x-mock-reason']).toContain('needs a JSON body');
        const notJson = create(service, withKey, '{oops');
        expect(notJson.status).toBe(400);
        expect(notJson.headers['x-mock-reason']).toContain('not valid JSON');
    });

    it('does not check the body against its schema', async () => {
        expect(create(await gadgets(), { ...JSON_HEADERS, 'idempotency-key': 'k' }, '{"anything":[1,2,3]}').status).toBe(201);
    });

    it('answers with a response the spec defines when the request asks for it with "Prefer: code=", headers included', async () => {
        const answer = create(await gadgets(), { ...JSON_HEADERS, 'idempotency-key': 'k', prefer: 'code=503' });
        expect(answer.status).toBe(503);
        expect(answer.headers['retry-after']).toBe('7');
        expect(answer.body).toEqual({ title: 'Unavailable', status: 503 });
    });

    it('answers 400 when "Prefer: code=" names a status the operation does not define', async () => {
        const answer = get(await gadgets(), '/v1/gadgets?limit=5', { ...KEY, prefer: 'code=418' });
        expect(answer.status).toBe(400);
        expect(answer.headers['x-mock-reason']).toContain('no 418 response');
    });

    it('keeps no state: the same request gets the same answer, and a created gadget is not listed', async () => {
        const service = await gadgets();
        create(service, { ...JSON_HEADERS, 'idempotency-key': 'k' }, '{"name":"new"}');
        const first = get(service, '/v1/gadgets?limit=5');
        const second = get(service, '/v1/gadgets?limit=5');
        expect(first.body).toEqual(second.body);
        expect(JSON.stringify(first.body)).not.toContain('new');
    });
});

describe('loading the specs', () => {
    it('lists the specs each service serves with their versions', async () => {
        const service = await gadgets();
        expect(service.specs).toEqual([
            { file: 'gadgets-service-v0.yaml', prefix: 'v0', version: '0.1.0' },
            { file: 'gadgets-service-v1.yaml', prefix: 'v1', version: '0.4.0' }
        ]);
        expect(service.operations).toBe(9);
    });

    it('fails clearly when the folder is missing or empty, a file has no version, or two files define one route', async () => {
        await expect(loadMockServices(path.join(folder, 'missing'))).rejects.toThrow(/does not exist/);
        const empty = await mkdtemp(path.join(tmpdir(), 'mock-test-empty-'));
        try {
            await expect(loadMockServices(empty)).rejects.toThrow(/No <service>-service-v<N>.yaml files/);
        } finally {
            await rm(empty, { recursive: true, force: true });
        }
        await writeFile(path.join(folder, 'broken-service-v1.yaml'), 'openapi: 3.0.3\npaths: {}\n');
        await expect(loadMockServices(folder)).rejects.toThrow(/broken-service-v1.yaml has no "info.version"/);
        await rm(path.join(folder, 'broken-service-v1.yaml'));
        await writeFile(path.join(folder, 'gadgets-service-v2.yaml'), GADGETS_V1);
        await expect(loadMockServices(folder)).rejects.toThrow(MockError);
    });

    it('fails clearly on a reference that points outside the file', async () => {
        await writeFile(path.join(folder, 'gadgets-service-v1.yaml'), GADGETS_V1.replace("schema: { $ref: '#/components/schemas/Summary' }", "schema: { $ref: 'other.yaml#/Summary' }"));
        await expect(loadMockServices(folder)).rejects.toThrow(/outside the file/);
    });
});

describe('the default URLs', () => {
    it('are the ports the mocks use, in service order', () => {
        expect(defaultUrls(['shipping-service', 'customers-service', 'orders-service'])).toEqual(environments.local);
    });
});

describe('the HTTP servers', () => {
    it('answer over a real connection: both versions from one base URL, a header, and a 204 with no body', async () => {
        running = await startMocks({ specsDir: folder, basePort: 0 });
        const base = running[0].url;
        expect(await (await fetch(`${base}/v0/health`)).json()).toEqual({ status: 'ok' });
        const created = await fetch(`${base}/v1/gadgets`, { method: 'POST', headers: { ...JSON_HEADERS, 'idempotency-key': 'k' }, body: '{}' });
        expect(created.status).toBe(201);
        expect(created.headers.get('location')).toBe('/v1/gadgets/g-2');
        expect(created.headers.get('content-type')).toBe('application/json');
        const deleted = await fetch(`${base}/v1/gadgets/g-1`, { method: 'DELETE', headers: KEY });
        expect(deleted.status).toBe(204);
        expect(await deleted.text()).toBe('');
        expect((await fetch(`${base}/v1/gadgets`, { method: 'POST', headers: { ...JSON_HEADERS, 'idempotency-key': 'k' }, body: '{oops' })).status).toBe(400);
    });

    it('start one per service, on its own port, listening only on the loopback address', async () => {
        await writeFile(path.join(folder, 'orders-service-v0.yaml'), GADGETS_V0.replace('Gadgets', 'Orders'));
        running = await startMocks({ specsDir: folder, basePort: 0 });
        expect(running.map((mock) => mock.service)).toEqual(['gadgets-service', 'orders-service']);
        expect(new Set(running.map((mock) => mock.url)).size).toBe(2);
        expect(running.every((mock) => mock.url.startsWith('http://127.0.0.1:'))).toBe(true);
    });

    it('name the port when it is in use, and leave nothing running', async () => {
        running = await startMocks({ specsDir: folder, basePort: 0 });
        const port = Number(new URL(running[0].url).port);
        await expect(startMocks({ specsDir: folder, basePort: port })).rejects.toThrow(`Port ${port} is already in use`);
    });
});

describe('npm run mock', () => {
    async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
        const out: string[] = [];
        const err: string[] = [];
        const code = await runStart({
            root: folder,
            argv: ['--specs', '.', ...argv],
            log: (text) => out.push(text),
            error: (text) => err.push(text),
            onStarted: async (_mocks, stop) => {
                await stop();
            }
        });
        return { code, out: out.join('\n'), err: err.join('\n') };
    }

    it('prints the base URL and the versions of every service, and warns about a missing example', async () => {
        const { code, out, err } = await run(['--port', '0']);
        expect(code).toBe(0);
        expect(out).toMatch(/gadgets-service\s+http:\/\/127\.0\.0\.1:\d+\s+v0 0\.1\.0, v1 0\.4\.0/);
        expect(err).toContain('warning: gadgets-service getNotes (200)');
    });

    it('rejects a wrong option or port with the usage and exit code 2', async () => {
        for (const argv of [['--port', 'abc'], ['--port', '-1'], ['--colour'], ['extra']]) {
            const { code, err } = await run(argv);
            expect(code).toBe(2);
            expect(err).toContain('Usage: npm run mock');
        }
    });

    it('exits with 1 and says why when the mocks cannot start', async () => {
        const { code, err } = await run(['--specs', 'nowhere']);
        expect(code).toBe(1);
        expect(err).toContain('mock failed:');
    });
});
