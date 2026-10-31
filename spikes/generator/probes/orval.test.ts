import { cancelOrder, createOrder, getOrder, listOrders } from '../out/orval/orders/orders.js';
import { getVersion } from '../out/orval/version/version.js';
import { defineScenario, type Result } from './scenario.js';

const toResult = (response: { status: number; headers: Headers; data: unknown }): Result => response;

// The generated functions call fetch with a relative URL, so the base URL and the api key have to come from somewhere.
// Here fetch is wrapped. A real facade would use an orval mutator. Calls are positional: path parameters, then body or
// query, then request options. The required Idempotency-Key header has no slot at all and goes in the options by hand.
defineScenario('orval', (baseUrl, apiKey) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => realFetch(new URL(String(input), baseUrl), init)) as typeof fetch;
    const options = (headers: Record<string, string> = {}): RequestInit => ({ headers: { 'x-api-key': apiKey, ...headers } });
    return {
        getVersion: async () => toResult(await getVersion(options())),
        listOrders: async ({ limit, status }) => toResult(await listOrders({ limit, status }, options())),
        createOrder: async ({ idempotencyKey, customerId }) => toResult(await createOrder({ customerId, lines: [{ sku: 'sku-1', quantity: 1 }] }, options({ 'Idempotency-Key': idempotencyKey }))),
        getOrder: async ({ orderId }) => toResult(await getOrder({ orderId }, options())),
        cancelOrder: async ({ orderId }) => toResult(await cancelOrder({ orderId }, options()))
    };
});
