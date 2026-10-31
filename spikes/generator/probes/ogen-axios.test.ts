import axios, { type AxiosResponse } from 'axios';
import { Configuration, OrdersApi, VersionApi } from '../out/ogen-axios/index.js';
import { defineScenario, type Result } from './scenario.js';

// The normalization wrapper from decision record 0010. For axios it is a one-line mapping plus validateStatus below.
const toResult = (response: AxiosResponse): Result => ({
    status: response.status,
    headers: new Headers(Object.entries(response.headers).map(([name, value]): [string, string] => [name, String(value)])),
    data: response.data
});

defineScenario('ogen-axios', (baseUrl, apiKey) => {
    const config = new Configuration({ apiKey });
    const instance = axios.create({ validateStatus: () => true });
    const orders = new OrdersApi(config, baseUrl, instance);
    const version = new VersionApi(config, baseUrl, instance);
    return {
        getVersion: async () => toResult(await version.getVersion()),
        listOrders: async ({ limit, status }) => toResult(await orders.listOrders({ limit, status })),
        createOrder: async ({ idempotencyKey, customerId }) => toResult(await orders.createOrder({ idempotencyKey, createOrderRequest: { customerId, lines: [{ sku: 'sku-1', quantity: 1 }] } })),
        getOrder: async ({ orderId }) => toResult(await orders.getOrder({ orderId })),
        cancelOrder: async ({ orderId }) => toResult(await orders.cancelOrder({ orderId }))
    };
});
