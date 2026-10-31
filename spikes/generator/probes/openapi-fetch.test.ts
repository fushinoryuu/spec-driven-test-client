import createClient from 'openapi-fetch';
import type { paths } from '../out/openapi-fetch/schema.js';
import { defineScenario, type Result } from './scenario.js';

// openapi-fetch is keyed by HTTP method and path, not by operationId or tag. Every operation below is a hand-written
// route. A facade over this would need an operationId-to-route table that openapi-typescript does not generate.
const toResult = (result: { data?: unknown; error?: unknown; response: Response }): Result => ({
    status: result.response.status,
    headers: result.response.headers,
    data: result.data ?? result.error
});

defineScenario('openapi-fetch', (baseUrl, apiKey) => {
    const client = createClient<paths>({ baseUrl, headers: { 'x-api-key': apiKey } });
    return {
        getVersion: async () => toResult(await client.GET('/version')),
        listOrders: async ({ limit, status }) => toResult(await client.GET('/orders', { params: { query: { limit, status } } })),
        createOrder: async ({ idempotencyKey, customerId }) => toResult(await client.POST('/orders', { params: { header: { 'Idempotency-Key': idempotencyKey } }, body: { customerId, lines: [{ sku: 'sku-1', quantity: 1 }] } })),
        getOrder: async ({ orderId }) => toResult(await client.GET('/orders/{orderId}', { params: { path: { orderId } } })),
        cancelOrder: async ({ orderId }) => toResult(await client.POST('/orders/{orderId}/cancel', { params: { path: { orderId } } }))
    };
});
