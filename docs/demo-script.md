# Demo script: what the planned spec changes do to the clients

The backend plans a non-breaking 1.1.0 of its `v1` specs, a breaking `v2` of orders and shipping that is served beside `v1`, and eventually the retirement of a `v1`. The edits are listed in the backend's `docs/spec-change-notes.md`. This page records what each one does to the clients that `npm run generate` writes, checked with the real generator (`@hey-api/openapi-ts` 0.99.0), and it is where the Phase 5 scripted demo gets its steps.

The specs of each state are in [demo/specs/](../demo/specs/README.md), which also says how to generate a state. Every state generated and typechecked with no warning. `src/generated/` and `specs/` were not touched.

## Results

| Change                                              | Expected effect                                     | Result                                                                                      |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| v1.1.0, customers: optional `preferredLanguage`     | The customer types gain an optional property        | Held, with one extra: a new exported type `LanguageTag`                                     |
| v1.1.0, orders: `GET /v1/orders/{orderId}/timeline` | A new `getOrderTimeline` method                     | Held. It is a static method of the `Orders` class, with seven new types                     |
| v1.1.0, orders: optional `notes`                    | `CreateOrder` and `Order` gain an optional property | Held                                                                                        |
| v1.1.0, shipping: optional `carrier` filter         | `listShipments` gains an optional parameter         | Held                                                                                        |
| `v2` orders: `shippingAddressId` required           | A new folder with its own models, `v1` unchanged    | Held. A call or type moved to `v2` fails to compile until it has the field                  |
| `v2` shipping: `PICKED` renamed `PACKED`            | A new folder with its own status type               | Held. `'PICKED'` is not a `v2` status, and comparing a `v2` status with it fails to compile |
| Retire `orders-service-v1.yaml`                     | The `orders-service-v1` folder disappears           | Held. A full run removes the folder, and `orders-service-v2` stays                          |

The tests that use the clients do not exist yet (Phase 4), so "which example tests break" is not checked here. What was checked is the generated code and the compiler.

The facade names in the plan (`ordersService.v1.orders.getOrderTimeline`) arrive in Phase 3. Today a client is the folder of a spec, and an operation is a static method of a class named after its tag, for example `Orders.getOrderTimeline(...)` from `src/generated/orders-service-v1/`.

## 1. Customers: optional `preferredLanguage` (v1.1.0)

Spec edit: a new schema `LanguageTag` (a string with a pattern and a `maxLength`), and an optional `preferredLanguage` that points at it in `Customer`, `CreateCustomer` and `UpdateCustomer`. It is in no `required` list, and the examples carry `preferredLanguage: en`. `info.version` is 1.1.0.

Generated diff (`customers-service-v1/types.gen.ts`, with the matching export added to `index.ts`):

```diff
+/**
+ * A language tag such as `en` or `pt-BR`: a two or three letter language in lowercase, and optionally a two-letter region in capitals.
+ */
+export type LanguageTag = string;
+
 export type Customer = {
     phone: string | null;
+    preferredLanguage?: LanguageTag;
     status: CustomerStatus;
 ...
 export type CreateCustomer = {
     phone?: string | null;
+    preferredLanguage?: LanguageTag;
 };
 ...
 export type UpdateCustomer = {
     phone?: string | null;
+    preferredLanguage?: LanguageTag;
     status?: 'active' | 'suspended';
 };
```

- **Held.** All three types gain an optional property, so code written against 1.0.0 still compiles. Nothing else in the folder changed, and no other folder changed.
- **Different from the plan.** The property is not an inline `string`. The schema is a named type, so the folder exports a new `LanguageTag`. The pattern and the length limit are not in the type. They are only in the spec.

## 2. Orders: `GET /v1/orders/{orderId}/timeline` (v1.1.0)

Spec edit: a new route with `operationId: getOrderTimeline`, tagged `orders`, and the schemas `OrderTimeline` and `OrderTimelineEntry`. The spec goes from five to six operations.

Generated diff (`orders-service-v1/sdk.gen.ts`, shortened):

```diff
+    /**
+     * Get the status history of an order
+     *
+     * The statuses the order has been in, oldest first. The last entry is the current status.
+     */
+    public static getOrderTimeline<ThrowOnError extends boolean = false>(parameters: {
+        orderId: string;
+    }, options?: Options<never, ThrowOnError>): RequestResult<GetOrderTimelineResponses, GetOrderTimelineErrors, ThrowOnError> {
+        const params = buildClientParams([parameters], [{ args: [{ in: 'path', key: 'orderId' }] }]);
+        return (options?.client ?? client).get<GetOrderTimelineResponses, GetOrderTimelineErrors, ThrowOnError>({
+            security: [{ name: 'x-api-key', type: 'apiKey' }],
+            url: '/v1/orders/{orderId}/timeline',
```

`types.gen.ts` gains `OrderTimeline`, `OrderTimelineEntry` and `GetOrderTimelineData`, `Error`, `Errors`, `Response` and `Responses`. The `200` response is `OrderTimeline`, and the errors are `403`, `404` and `429`, each a `Problem`.

- **Held.** The new method is on the `Orders` class, next to `getOrder`, and no existing signature changed.
- **Different from the plan.** The operation is a static method (`Orders.getOrderTimeline({ orderId })`), as every operation is. The plan wrote it as an instance method of a facade.

## 3. Orders: optional `notes` (v1.1.0)

Spec edit: an optional `notes` string (1 to 500 characters) in `CreateOrder` and `Order`, an example value in the `createOrder` request and its `201` response, and one sentence added to the idempotency paragraph of `createOrder`.

Generated diff (`orders-service-v1/types.gen.ts`, and one doc comment in `sdk.gen.ts`):

```diff
 export type Order = {
     total: number;
+    /**
+     * A note from the customer. Free text.
+     */
+    notes?: string;
     version: number;
 ...
 export type CreateOrder = {
     items: Array<CreateOrderItem>;
+    /**
+     * A note from the customer. Free text.
+     */
+    notes?: string;
 };
```

- **Held.** Both types gain an optional `notes`. The only other change is the longer doc comment on `Orders.createOrder`.
- The length limit is not in the type.

## 4. Shipping: optional `carrier` filter (v1.1.0)

Spec edit: a query parameter `carrier` after `status` in `listShipments`.

Generated diff (`shipping-service-v1/sdk.gen.ts` and `types.gen.ts`):

```diff
     public static listShipments<ThrowOnError extends boolean = false>(parameters?: {
         orderId?: string;
         status?: ShipmentStatus;
+        carrier?: string;
         cursor?: string;
         limit?: number;
     }, ...
         const params = buildClientParams([parameters], [{ args: [
                     { in: 'query', key: 'orderId' },
                     { in: 'query', key: 'status' },
+                    { in: 'query', key: 'carrier' },
                     { in: 'query', key: 'cursor' },
```

- **Held.** The parameter is optional, so a call written for 1.0.0 compiles.

**All of v1.1.0 together.** Seven generated files changed, all in `customers-service-v1`, `orders-service-v1` and `shipping-service-v1`. The three `v0` folders, the other `v1` folders and every runtime copy (`client/`, `core/`) are byte for byte the same.

## 5. Orders `v2` beside `v1`

Spec edit: a new `orders-service-v2.yaml`. It is the 1.1.0 `v1` spec with every `/v1` path and `Location` example changed to `/v2` and `info.version` 2.0.0. The `operationId` values and tags are the same. `CreateOrder` and `Order` gain `shippingAddressId` (a uuid), which is required in both. The `createOrder` description and the `UnknownCustomer` response now say that the answer is 422 when the address is not an address of the customer. The state has eight specs, and `v1` is unchanged.

Result:

- **Held.** The only change to the output is a new folder, `orders-service-v2`, with six operations. Every `v1` folder is identical to the state before.
- Between `orders-service-v1` and `orders-service-v2` the generated code differs in the `/v2` urls, `shippingAddressId: string` in `CreateOrder` and `Order`, and two doc comments. The runtime copies are identical.
- **A thing to know.** Both folders export classes named `Orders` and `Products`. Nothing collides, because each is its own module, but a file that imports from both must rename one. The Phase 3 facade is where the version segment (`ordersService.v1`, `ordersService.v2`) hides this.

Compile check, with a small scratch file that imports the generated types (not committed). Lines that compile are left out:

```
check.ts(10,14): error TS2741: Property 'shippingAddressId' is missing in type '{ customerId: string; items: ... }' but required in type 'CreateOrder'.
check.ts(16,50): error TS2741: Property 'shippingAddressId' is missing in type 'Order' (v1) but required in type 'Order' (v2).
```

The first line is a `v1` request body moved to the `v2` type. The same body still compiles against the `v1` type, and adding `shippingAddressId` makes it compile against `v2`. The second line is a `v1` order used where a `v2` order is expected.

## 6. Shipping `v2` beside `v1`

Spec edit: a new `shipping-service-v2.yaml`, built the same way. In `ShipmentStatus` the value `PICKED` is replaced by `PACKED`, and the `advanceShipment` description and example follow.

Result:

- **Held.** A new folder, `shipping-service-v2`, with three operations. `shipping-service-v1` is unchanged and still has `PICKED`.
- The generated status type differs in one line:

```diff
-export type ShipmentStatus = 'CREATED' | 'PICKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
+export type ShipmentStatus = 'CREATED' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
```

Compile check, same scratch file:

```
check.ts(21,14): error TS2820: Type '"PICKED"' is not assignable to type 'ShipmentStatus'. Did you mean '"PACKED"'?
check.ts(23,50): error TS2367: This comparison appears to be unintentional because the types 'ShipmentStatus' and '"PICKED"' have no overlap.
```

`'PICKED'` still compiles against the `v1` status, and `'PACKED'` compiles against `v2`.

## 7. Retiring `orders-service-v1`

This step is not in the backend's notes. It is the library's own scenario for the breaking case.

Spec edit: delete `orders-service-v1.yaml` from the state of section 5 and run a full `generate` into the folder that holds the previous output.

Result:

- **Held.** The run prints `removed orders-service-v1/ (no spec of that name)`, seven specs remain, and `orders-service-v2` is untouched.
- Nothing was compiled against the missing folder here. Any file that imports from `orders-service-v1/` now fails to resolve, so this is the signal that makes the change a major version (decision record [0013](decisions/0013-api-versions.md)). The example tests that would show it are Phase 4.

## What is not verified

- The effect on example tests. Those tests do not exist yet (Phase 4), so every "none" in the plan is still a claim.
- The facade names. They arrive in Phase 3.
- The backend's real bundles. The edits were applied by hand to our copies of the specs, from the backend's notes. Repeat the steps when the backend publishes its 1.1.0 and `v2` files.
- The optional `Deprecation` and `Sunset` headers on `/v1` that the notes describe. They are not in the states.
