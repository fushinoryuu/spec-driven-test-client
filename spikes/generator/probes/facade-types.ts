// Decision record 0004 says the facade is a runtime wrapper plus mapped types over the generated classes, and that the
// spike must show the mapping works with the chosen generator's output. This file is only typechecked, never run.
// It maps each hey-api class (one per tag) to the call shape of decision record 0010: one request object in,
// `{ status, headers, data }` out.
import { Orders, Version } from '../out/heyapi/index.js';
import type { Result } from './scenario.js';

/** The request object is the first argument, unless an operation has no parameters and takes only the options (which have a `client`). */
type RequestOf<F> = F extends (...args: infer A) => unknown ? ('client' extends keyof NonNullable<A[0]> ? void : A[0]) : never;

type Facade<S> = {
    [K in keyof S as S[K] extends (...args: never[]) => unknown ? K : never]: (...request: RequestOf<S[K]> extends void ? [] : [request: RequestOf<S[K]>]) => Promise<Result>;
};

declare const apitest: { ordersService: { orders: Facade<typeof Orders>; version: Facade<typeof Version> } };

void apitest.ordersService.version.getVersion();
void apitest.ordersService.orders.getOrder({ orderId: 'ord_1' });
void apitest.ordersService.orders.listOrders({ limit: 5 });
void apitest.ordersService.orders.createOrder({ 'Idempotency-Key': 'key', createOrderRequest: { customerId: 'cus_1', lines: [] } });

// @ts-expect-error orderId is required
void apitest.ordersService.orders.getOrder({});
// @ts-expect-error the operation does not exist
void apitest.ordersService.orders.getOrders;
// @ts-expect-error the required header is missing
void apitest.ordersService.orders.createOrder({ createOrderRequest: { customerId: 'cus_1', lines: [] } });
// @ts-expect-error an operation without parameters takes no argument
void apitest.ordersService.version.getVersion({ client: undefined });
