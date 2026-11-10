// A mock of each Storefront service, driven by the specs in `specs/`. It answers with the example
// responses written in the spec, so a change to a spec changes the answers with no change here.
// It has no state and does not talk to the other services. mock/README.md lists exactly what it
// does and does not check.

import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { parse } from 'yaml';
import { SPEC_FILE_NAME } from '../scripts/check-stage.ts';

type Obj = Record<string, unknown>;

/** The port of the first service (the services are sorted by name). Prism and many other mock tools use it too. */
export const DEFAULT_BASE_PORT = 4010;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_STAGE = 'local';

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;
const MAX_BODY_BYTES = 1_000_000;

export class MockError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MockError';
    }
}

export interface ServedSpec {
    file: string;
    /** For example `v1`. */
    prefix: string;
    /** The `info.version` of the file. */
    version: string;
}

interface Operation {
    method: string;
    path: string;
    operationId: string;
    segments: string[];
    parameters: Obj[];
    /** The names of the headers that can carry the API key. Empty when the operation is open. */
    keyHeaders: string[];
    requestBodyRequired: boolean;
    responses: Obj;
    doc: Obj;
}

/** A request as the mock sees it, without a socket. The body is already read. */
export interface MockRequest {
    method: string;
    /** The path and the query, for example `/v1/products?limit=5`. */
    url: string;
    /** Header names in lower case, as Node gives them. */
    headers: IncomingHttpHeaders;
    body: string;
}

export interface Answer {
    status: number;
    headers: Record<string, string>;
    body?: string;
}

export interface MockService {
    /** For example `orders-service`. */
    service: string;
    specs: ServedSpec[];
    /** The number of operations the mock answers. */
    operations: number;
    /** Responses that have a body but no example. The mock answers them with no body. */
    warnings: string[];
    /** Answers a request without any network. `handle` is this behind an HTTP server. */
    respond(request: MockRequest): Answer;
    handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

export interface LoadOptions {
    /** The stage the mock reports in `GET /v0/version`. */
    stage?: string;
}

function isRecord(value: unknown): value is Obj {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Obj {
    return isRecord(value) ? value : {};
}

/** Follows `$ref` pointers inside one document. The bundled Storefront specs have no others. */
function resolve(doc: Obj, node: unknown, file: string): unknown {
    let current = node;
    for (let depth = 0; depth < 20; depth++) {
        if (!isRecord(current) || typeof current.$ref !== 'string') {
            return current;
        }
        const ref = current.$ref;
        if (!ref.startsWith('#/')) {
            throw new MockError(`${file} points to ${ref}, which is outside the file. The mock follows only references inside one file.`);
        }
        let target: unknown = doc;
        for (const part of ref.slice(2).split('/')) {
            target = isRecord(target) ? target[decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
        }
        if (target === undefined) {
            throw new MockError(`${file} points to ${ref}, which does not exist.`);
        }
        current = target;
    }
    throw new MockError(`${file} has references that point to each other in a loop.`);
}

function keyHeadersOf(doc: Obj, security: unknown): string[] {
    if (!Array.isArray(security) || security.length === 0 || security.some((requirement) => !isRecord(requirement) || Object.keys(requirement).length === 0)) {
        return [];
    }
    const schemes = asRecord(asRecord(doc.components).securitySchemes);
    const names = new Set<string>();
    for (const requirement of security) {
        for (const schemeName of Object.keys(asRecord(requirement))) {
            const scheme = asRecord(schemes[schemeName]);
            if (scheme.type === 'apiKey' && scheme.in === 'header' && typeof scheme.name === 'string') {
                names.add(scheme.name.toLowerCase());
            }
        }
    }
    return [...names];
}

function operationsOf(doc: Obj, file: string, warnings: string[], service: string): Operation[] {
    const paths = doc.paths;
    if (!isRecord(paths)) {
        throw new MockError(`${file} has no "paths".`);
    }
    const found: Operation[] = [];
    for (const [route, rawItem] of Object.entries(paths)) {
        const item = asRecord(resolve(doc, rawItem, file));
        for (const method of METHODS) {
            if (!isRecord(item[method])) {
                continue;
            }
            const operation = item[method];
            const parameters = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])].map((parameter) => asRecord(resolve(doc, parameter, file)));
            const requestBody = asRecord(resolve(doc, operation.requestBody, file));
            const operationId = typeof operation.operationId === 'string' ? operation.operationId : `${method} ${route}`;
            const built: Operation = {
                method: method.toUpperCase(),
                path: route,
                operationId,
                segments: route.split('/').filter((part) => part !== ''),
                parameters,
                keyHeaders: keyHeadersOf(doc, operation.security ?? doc.security),
                requestBodyRequired: requestBody.required === true,
                responses: asRecord(operation.responses),
                doc
            };
            for (const status of Object.keys(built.responses)) {
                const answer = tryAnswer(built, Number(status), file, service);
                if (answer !== undefined && answer.missingExample) {
                    warnings.push(`${service} ${operationId} (${status}): the response has a body but no example.`);
                }
            }
            found.push(built);
        }
    }
    return found;
}

/** The mock's answer for one defined response of an operation, taken from the spec. */
function tryAnswer(operation: Operation, status: number, file: string, service: string): (Answer & { missingExample: boolean }) | undefined {
    const raw = operation.responses[String(status)];
    if (raw === undefined) {
        return undefined;
    }
    const response = asRecord(resolve(operation.doc, raw, file));
    const headers: Record<string, string> = {};
    for (const [name, rawHeader] of Object.entries(asRecord(response.headers))) {
        const header = asRecord(resolve(operation.doc, rawHeader, file));
        const value = header.example ?? asRecord(resolve(operation.doc, header.schema, file)).example;
        if (value !== undefined) {
            headers[name.toLowerCase()] = String(value);
        }
    }

    const content = asRecord(response.content);
    const mediaType = Object.keys(content).find((type) => type.includes('json')) ?? Object.keys(content)[0];
    if (mediaType === undefined) {
        return { status, headers, missingExample: false };
    }
    const media = asRecord(resolve(operation.doc, content[mediaType], file));
    let example = media.example;
    if (example === undefined && isRecord(media.examples)) {
        const first = Object.values(media.examples)[0];
        example = asRecord(resolve(operation.doc, first, file)).value;
    }
    if (example === undefined) {
        example = asRecord(resolve(operation.doc, media.schema, file)).example;
    }
    if (example === undefined) {
        headers['x-mock-warning'] = `The spec has no example for ${service} ${operation.operationId} (${status}).`;
        return { status, headers, missingExample: true };
    }
    headers['content-type'] = mediaType.includes('json') ? 'application/json' : mediaType;
    return { status, headers, body: typeof example === 'string' && !mediaType.includes('json') ? example : JSON.stringify(example), missingExample: false };
}

const PROBLEM_TITLES: Record<number, string> = { 400: 'Bad request', 403: 'Forbidden', 404: 'Not found', 405: 'Method not allowed' };

/** An error the mock raises on its own, in the shape of the spec's `Problem` schema. */
function problem(status: number, detail: string, headers: Record<string, string> = {}): Answer {
    const title = PROBLEM_TITLES[status] ?? 'Error';
    const body = { type: `https://mock.invalid/problems/${title.toLowerCase().replace(/ /g, '-')}`, title, status, detail, correlationId: randomUUID() };
    return { status, headers: { 'content-type': 'application/json', 'x-mock-reason': detail, ...headers }, body: JSON.stringify(body) };
}

/** The spec's own response for this status when the operation defines one, so the contract's example is what the caller sees. */
function specOrProblem(operation: Operation, status: number, detail: string, file: string, service: string): Answer {
    const fromSpec = tryAnswer(operation, status, file, service);
    if (fromSpec === undefined) {
        return problem(status, detail);
    }
    return { status: fromSpec.status, headers: { ...fromSpec.headers, 'x-mock-reason': detail }, body: fromSpec.body };
}

function matches(operation: Operation, parts: string[]): number | undefined {
    if (operation.segments.length !== parts.length) {
        return undefined;
    }
    let literals = 0;
    for (let index = 0; index < parts.length; index++) {
        const segment = operation.segments[index];
        if (segment.startsWith('{') && segment.endsWith('}')) {
            continue;
        }
        if (segment !== parts[index]) {
            return undefined;
        }
        literals++;
    }
    return literals;
}

async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = chunk as Buffer;
        size += buffer.length;
        if (size > MAX_BODY_BYTES) {
            throw new MockError('The request body is larger than 1 MB.');
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function defaultStatus(operation: Operation): number {
    const codes = Object.keys(operation.responses)
        .map(Number)
        .filter((code) => Number.isInteger(code))
        .sort((a, b) => a - b);
    return codes.find((code) => code >= 200 && code < 300) ?? codes[0] ?? 200;
}

/** `Prefer: code=409` asks for another response the operation defines. */
function preferredStatus(request: MockRequest): number | undefined {
    const prefer = request.headers.prefer;
    const match = /\bcode=(\d{3})\b/.exec(Array.isArray(prefer) ? prefer.join(',') : (prefer ?? ''));
    return match === null ? undefined : Number(match[1]);
}

function answerFor(operation: Operation, request: MockRequest, query: URLSearchParams, file: string, service: string, overlay: (operation: Operation, answer: Answer) => Answer): Answer {
    if (operation.keyHeaders.length > 0 && !operation.keyHeaders.some((name) => String(request.headers[name] ?? '') !== '')) {
        return specOrProblem(operation, 403, `This route needs an API key in the ${operation.keyHeaders.join(' or ')} header.`, file, service);
    }
    for (const parameter of operation.parameters) {
        if (parameter.required !== true || typeof parameter.name !== 'string') {
            continue;
        }
        if (parameter.in === 'query' && !query.has(parameter.name)) {
            return specOrProblem(operation, 400, `The required query parameter "${parameter.name}" is missing.`, file, service);
        }
        if (parameter.in === 'header' && String(request.headers[parameter.name.toLowerCase()] ?? '') === '') {
            return specOrProblem(operation, 400, `The required header "${parameter.name}" is missing.`, file, service);
        }
    }
    const text = request.body;
    if (operation.requestBodyRequired && text.trim() === '') {
        return specOrProblem(operation, 400, 'The request needs a JSON body.', file, service);
    }
    if (text.trim() !== '') {
        try {
            JSON.parse(text);
        } catch {
            return specOrProblem(operation, 400, 'The request body is not valid JSON.', file, service);
        }
    }

    const status = preferredStatus(request) ?? defaultStatus(operation);
    const answer = tryAnswer(operation, status, file, service);
    if (answer === undefined) {
        return problem(400, `${operation.operationId} has no ${status} response in its spec, so the mock cannot answer with it.`);
    }
    return overlay(operation, { status: answer.status, headers: answer.headers, body: answer.body });
}

/** Reads every spec of one service and builds the mock for it. */
function buildService(service: string, documents: { file: string; prefix: string; doc: Obj }[], options: LoadOptions): MockService {
    const warnings: string[] = [];
    const operations: Operation[] = [];
    const seen = new Map<string, string>();
    const files = new Map<Operation, string>();
    for (const { file, doc } of documents) {
        for (const operation of operationsOf(doc, file, warnings, service)) {
            const key = `${operation.method} ${operation.path}`;
            const other = seen.get(key);
            if (other !== undefined) {
                throw new MockError(`${other} and ${file} both define ${key}.`);
            }
            seen.set(key, file);
            files.set(operation, file);
            operations.push(operation);
        }
    }
    const specs = documents.map(({ file, prefix, doc }) => ({ file, prefix, version: String(asRecord(doc.info).version) }));
    const stage = options.stage ?? DEFAULT_STAGE;

    // The one answer that is not copied from the spec: `getVersion` reports the specs this mock serves, so the stage readiness check
    // can pass against it. The example in the spec names versions of its own, which would not match the file next to it.
    const overlay = (operation: Operation, answer: Answer): Answer => {
        if (operation.operationId !== 'getVersion' || operation.path !== '/v0/version' || answer.status !== 200 || answer.body === undefined) {
            return answer;
        }
        const body = asRecord(JSON.parse(answer.body));
        return { ...answer, body: JSON.stringify({ ...body, buildId: 'mock', stage, specVersions: Object.fromEntries(specs.map((spec) => [spec.prefix, spec.version])) }) };
    };

    const respond = (request: MockRequest): Answer => {
        try {
            const url = new URL(request.url, 'http://mock.invalid');
            const parts = url.pathname.split('/').filter((part) => part !== '');
            const candidates = operations.map((operation) => ({ operation, literals: matches(operation, parts) })).filter((candidate): candidate is { operation: Operation; literals: number } => candidate.literals !== undefined);
            const method = request.method.toUpperCase();
            const best = candidates.filter((candidate) => candidate.operation.method === method).sort((a, b) => b.literals - a.literals)[0];
            if (candidates.length === 0) {
                return problem(404, `${service} has no route ${url.pathname}.`);
            }
            if (best === undefined) {
                return problem(405, `${url.pathname} does not allow ${method}.`, { allow: [...new Set(candidates.map((candidate) => candidate.operation.method))].join(', ') });
            }
            return answerFor(best.operation, request, url.searchParams, files.get(best.operation) ?? service, service, overlay);
        } catch (error) {
            return problem(400, `The mock could not answer: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        let answer: Answer;
        try {
            answer = respond({ method: request.method ?? 'GET', url: request.url ?? '/', headers: request.headers, body: await readBody(request) });
        } catch (error) {
            answer = problem(400, error instanceof MockError ? error.message : `The mock could not read the request: ${error instanceof Error ? error.message : String(error)}`);
        }
        response.writeHead(answer.status, answer.headers);
        response.end(answer.status === 204 ? undefined : answer.body);
    };

    return { service, specs, operations: operations.length, warnings, respond, handle };
}

/** Reads the `<service>-service-v<N>.yaml` files of a folder and builds one mock per service. */
export async function loadMockServices(specsDir: string, options: LoadOptions = {}): Promise<MockService[]> {
    let names: string[];
    try {
        names = await readdir(specsDir);
    } catch {
        throw new MockError(`The spec folder ${specsDir} does not exist. Run npm run copy-specs first.`);
    }
    const byService = new Map<string, { file: string; prefix: string; doc: Obj }[]>();
    for (const file of names.sort()) {
        const match = SPEC_FILE_NAME.exec(file);
        if (match === null) {
            continue;
        }
        let doc: unknown;
        try {
            doc = parse(await readFile(path.join(specsDir, file), 'utf8'));
        } catch (error) {
            throw new MockError(`${file} could not be read (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).`);
        }
        if (!isRecord(doc) || !isRecord(doc.info) || typeof doc.info.version !== 'string') {
            throw new MockError(`${file} has no "info.version".`);
        }
        byService.set(match[1], [...(byService.get(match[1]) ?? []), { file, prefix: match[2], doc }]);
    }
    if (byService.size === 0) {
        throw new MockError(`No <service>-service-v<N>.yaml files found in ${specsDir}. Run npm run copy-specs first.`);
    }
    return [...byService.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([service, documents]) => buildService(service, documents, options));
}

export interface RunningMock {
    service: string;
    /** The base URL without a version prefix, for example `http://127.0.0.1:4011`. */
    url: string;
    specs: ServedSpec[];
    warnings: string[];
    close(): Promise<void>;
}

export interface StartOptions extends LoadOptions {
    specsDir: string;
    /** The port of the first service, then one more for each. 0 lets the system pick every port. */
    basePort?: number;
    host?: string;
    /** Called with one line for every request. */
    log?: (line: string) => void;
}

/** The base URL each service gets with the default port, in service order. Used by `config/environments.ts`. */
export function defaultUrls(services: string[]): Record<string, string> {
    return Object.fromEntries([...services].sort().map((service, index) => [service, `http://${DEFAULT_HOST}:${DEFAULT_BASE_PORT + index}`]));
}

function listen(server: Server, port: number, host: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.off('error', reject);
            resolvePromise();
        });
    });
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolvePromise) => {
        server.close(() => resolvePromise());
        server.closeAllConnections();
    });
}

/** Starts one HTTP server per service. If one cannot start, none is left running. */
export async function startMocks(options: StartOptions): Promise<RunningMock[]> {
    const services = await loadMockServices(options.specsDir, { stage: options.stage });
    const host = options.host ?? DEFAULT_HOST;
    const basePort = options.basePort ?? DEFAULT_BASE_PORT;
    const running: RunningMock[] = [];
    try {
        for (const [index, service] of services.entries()) {
            const server = createServer((request, response) => {
                response.on('finish', () => options.log?.(`${service.service} ${request.method} ${request.url} -> ${response.statusCode}`));
                void service.handle(request, response);
            });
            const port = basePort === 0 ? 0 : basePort + index;
            try {
                await listen(server, port, host);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
                    throw new MockError(`Port ${port} is already in use. Stop what is using it, or pick another start with --port.`);
                }
                throw error;
            }
            running.push({
                service: service.service,
                url: `http://${host}:${(server.address() as AddressInfo).port}`,
                specs: service.specs,
                warnings: service.warnings,
                close: () => closeServer(server)
            });
        }
    } catch (error) {
        await Promise.all(running.map((mock) => mock.close()));
        throw error;
    }
    return running;
}
