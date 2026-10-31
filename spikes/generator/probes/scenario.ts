import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_KEY, startMockServer, type SeenRequest } from './mock-server.js';

/** What the facade (decision record 0010) needs from every call, whatever the generator returns. */
export interface Result {
    status: number;
    headers: Headers;
    data: unknown;
}

/** One adapter per candidate. Each method makes the generated call with the generator's own request object. */
export interface Adapter {
    getVersion(): Promise<Result>;
    listOrders(request: { limit: number; status: 'PAID' }): Promise<Result>;
    createOrder(request: { idempotencyKey: string; customerId: string }): Promise<Result>;
    getOrder(request: { orderId: string }): Promise<Result>;
    cancelOrder(request: { orderId: string }): Promise<Result>;
}

export function defineScenario(candidate: string, makeAdapter: (baseUrl: string, apiKey: string) => Adapter) {
    describe(candidate, () => {
        let adapter: Adapter;
        let seen: SeenRequest[];
        let close: () => Promise<void>;
        const observations: Record<string, unknown> = {};

        beforeAll(async () => {
            const server = await startMockServer();
            seen = server.seen;
            close = server.close;
            adapter = makeAdapter(server.baseUrl, API_KEY);
        });

        afterAll(async () => {
            await close();
            mkdirSync('out/observations', { recursive: true });
            writeFileSync(`out/observations/${candidate}.json`, JSON.stringify(observations, null, 2));
        });

        it('returns 2xx data, and /version needs no key', async () => {
            const response = await adapter.getVersion();
            expect(response.status).toBe(200);
            expect(response.data).toMatchObject({ stage: 'dev' });
        });

        it('sends the api key and the required header, and exposes response headers', async () => {
            const response = await adapter.createOrder({ idempotencyKey: 'key-1', customerId: 'cus_1' });
            expect(response.status).toBe(201);
            expect(response.headers.get('location')).toBe('/orders/ord_1');
            const request = seen.findLast((r) => r.method === 'POST' && r.url === '/orders');
            expect(request?.headers['x-api-key']).toBe(API_KEY);
            expect(request?.headers['idempotency-key']).toBe('key-1');
            expect(JSON.parse(request?.body ?? '{}')).toMatchObject({ customerId: 'cus_1' });
        });

        it('forwards query parameters', async () => {
            const response = await adapter.listOrders({ limit: 5, status: 'PAID' });
            expect(response.status).toBe(200);
            const request = seen.findLast((r) => r.method === 'GET' && r.url.startsWith('/orders?'));
            const query = new URL(request?.url ?? '', 'http://x').searchParams;
            expect(query.get('limit')).toBe('5');
            expect(query.get('status')).toBe('PAID');
        });

        it('reports how date-time and nullable fields come back', async () => {
            const response = await adapter.getOrder({ orderId: 'ord_1' });
            expect(response.status).toBe(200);
            const data = response.data as { createdAt: unknown; note: unknown };
            observations.dateTimeAs = data.createdAt instanceof Date ? 'Date' : typeof data.createdAt;
            observations.nullablePreserved = data.note === null;
        });

        it('does not throw on 404 and keeps status, headers and the error body', async () => {
            const response = await adapter.getOrder({ orderId: 'missing' });
            expect(response.status).toBe(404);
            expect(response.headers.get('x-correlation-id')).toBe('corr-1');
            expect(response.data).toMatchObject({ title: 'Not found', correlationId: 'corr-1' });
        });

        it('does not throw on 409', async () => {
            const created = await adapter.createOrder({ idempotencyKey: 'reuse', customerId: 'cus_1' });
            expect(created.status).toBe(409);
            const cancelled = await adapter.cancelOrder({ orderId: 'shipped' });
            expect(cancelled.status).toBe(409);
        });

        it('does not throw on a non-JSON error body (a gateway-style 502)', async () => {
            const response = await adapter.getOrder({ orderId: 'gateway' });
            expect(response.status).toBe(502);
            observations.nonJsonErrorBody = typeof response.data === 'string' ? 'text' : typeof response.data;
        });

        it('handles 204 with no body', async () => {
            const response = await adapter.cancelOrder({ orderId: 'ord_1' });
            expect(response.status).toBe(204);
        });
    });
}
