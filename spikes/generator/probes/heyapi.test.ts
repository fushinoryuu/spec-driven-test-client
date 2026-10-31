import { Orders, Version } from '../out/heyapi/index.js';
import { createClient, createConfig } from '../out/heyapi/client/index.js';
import { defineScenario, type Result } from './scenario.js';

// The normalization wrapper from decision record 0010. hey-api already returns the response without throwing, so this
// only reshapes it. The result types `response` as optional, so the wrapper has to narrow it.
const toResult = ({ data, error, response }: { data?: unknown; error?: unknown; response?: Response }): Result => {
    if (!response) throw new Error('No response');
    return { status: response.status, headers: response.headers, data: data ?? error };
};

// Generated with `paramsStructure: 'flat'`: the first argument is the request object, the second holds transport
// options such as the client. An operation with no parameters takes the options as its only argument.
defineScenario('heyapi', (baseUrl, apiKey) => {
    const client = createClient(createConfig({ baseUrl, auth: apiKey }));
    return {
        getVersion: async () => toResult(await Version.getVersion({ client })),
        listOrders: async ({ limit, status }) => toResult(await Orders.listOrders({ limit, status }, { client })),
        createOrder: async ({ idempotencyKey, customerId }) => toResult(await Orders.createOrder({ 'Idempotency-Key': idempotencyKey, createOrderRequest: { customerId, lines: [{ sku: 'sku-1', quantity: 1 }] } }, { client })),
        getOrder: async ({ orderId }) => toResult(await Orders.getOrder({ orderId }, { client })),
        cancelOrder: async ({ orderId }) => toResult(await Orders.cancelOrder({ orderId }, { client }))
    };
});
