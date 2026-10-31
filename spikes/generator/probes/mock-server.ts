import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const API_KEY = 'test-key';

export interface SeenRequest {
    method: string;
    url: string;
    headers: IncomingMessage['headers'];
    body: string;
}

const order = {
    id: 'ord_1',
    customerId: 'cus_1',
    status: 'PAID',
    totalMinorUnits: 1250,
    note: null,
    lines: [{ sku: 'sku-1', quantity: 2 }],
    createdAt: '2026-10-30T12:00:00.000Z',
    shippedAt: null
};

const problem = (status: number, title: string) => ({ type: 'about:blank', title, status, correlationId: 'corr-1' });

/** A tiny stand-in for the Storefront API, matching tests/fixtures/specs/generator-spike.yaml. */
export async function startMockServer(): Promise<{ baseUrl: string; seen: SeenRequest[]; close: () => Promise<void> }> {
    const seen: SeenRequest[] = [];
    const server: Server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            seen.push({ method: req.method ?? '', url: url.pathname + url.search, headers: req.headers, body: Buffer.concat(chunks).toString() });

            const send = (status: number, body?: unknown, extra: Record<string, string> = {}) => {
                const headers = { 'x-correlation-id': 'corr-1', ...extra };
                if (body === undefined) {
                    res.writeHead(status, headers).end();
                } else if (typeof body === 'string') {
                    res.writeHead(status, { ...headers, 'content-type': 'text/plain' }).end(body);
                } else {
                    res.writeHead(status, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify(body));
                }
            };

            const path = url.pathname;
            if (req.method === 'GET' && path === '/version') return send(200, { buildId: 'abc123', specVersion: '0.0.1', stage: 'dev' });
            if (req.headers['x-api-key'] !== API_KEY) return send(403, problem(403, 'Forbidden'));

            if (req.method === 'GET' && path === '/orders') return send(200, { items: [order], nextCursor: null });
            if (req.method === 'POST' && path === '/orders') {
                const key = req.headers['idempotency-key'];
                if (typeof key !== 'string') return send(400, problem(400, 'Missing Idempotency-Key'));
                if (key === 'reuse') return send(409, problem(409, 'Idempotency key reused'));
                return send(201, order, { location: '/orders/ord_1' });
            }

            const match = /^\/orders\/([^/]+)(\/cancel)?$/.exec(path);
            if (match) {
                const id = match[1];
                if (id === 'missing') return send(404, problem(404, 'Not found'));
                if (id === 'gateway') return send(502, 'Bad Gateway');
                if (req.method === 'GET' && !match[2]) return send(200, { ...order, id });
                if (req.method === 'POST' && match[2]) return id === 'shipped' ? send(409, problem(409, 'Already shipped')) : send(204);
            }
            send(404, problem(404, 'No such route'));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        seen,
        close: () => new Promise<void>((resolve) => server.close(() => resolve()))
    };
}
