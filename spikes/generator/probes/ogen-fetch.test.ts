import { Configuration, OrdersApi, ResponseError, VersionApi, type ApiResponse } from '../out/ogen-fetch/index.js';
import { defineScenario, type Result } from './scenario.js';

const parse = (text: string): unknown => {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

// The normalization wrapper from decision record 0010. Written once, it works for every operation.
async function call<T>(request: () => Promise<ApiResponse<T>>): Promise<Result> {
    try {
        const response = await request();
        return { status: response.raw.status, headers: response.raw.headers, data: await response.value() };
    } catch (error) {
        if (!(error instanceof ResponseError)) throw error;
        return { status: error.response.status, headers: error.response.headers, data: parse(await error.response.text()) };
    }
}

defineScenario('ogen-fetch', (baseUrl, apiKey) => {
    const config = new Configuration({ basePath: baseUrl, apiKey });
    const orders = new OrdersApi(config);
    const version = new VersionApi(config);
    return {
        getVersion: () => call(() => version.getVersionRaw()),
        listOrders: ({ limit, status }) => call(() => orders.listOrdersRaw({ limit, status })),
        createOrder: ({ idempotencyKey, customerId }) => call(() => orders.createOrderRaw({ idempotencyKey, createOrderRequest: { customerId, lines: [{ sku: 'sku-1', quantity: 1 }] } })),
        getOrder: ({ orderId }) => call(() => orders.getOrderRaw({ orderId })),
        cancelOrder: ({ orderId }) => call(() => orders.cancelOrderRaw({ orderId }))
    };
});
