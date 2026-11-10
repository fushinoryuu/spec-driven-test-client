import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkStage, loadLibrarySpecs } from '../../scripts/check-stage.ts';
import { startMocks, type RunningMock } from '../../mock/server.ts';

// Starts the mocks from the real Storefront specs in specs/ on free ports. It needs no network beyond the loopback address.
// TCP connections on the development machine sometimes stall for 10 seconds or more when several test runs share it, so the timeouts are long.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const SPECS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'specs');
const KEY = { 'x-api-key': 'smoke-test-key' };

let mocks: RunningMock[];
const urlOf = (service: string): string => mocks.find((mock) => mock.service === service)!.url;

beforeAll(async () => {
    mocks = await startMocks({ specsDir: SPECS_DIR, basePort: 0, stage: 'local' });
});

afterAll(async () => {
    await Promise.all(mocks.map((mock) => mock.close()));
});

describe('the mocks of the Storefront specs', () => {
    it('start for all three services, and every example in the specs is there', () => {
        expect(mocks.map((mock) => mock.service)).toEqual(['customers-service', 'orders-service', 'shipping-service']);
        expect(mocks.flatMap((mock) => mock.warnings)).toEqual([]);
    });

    it.each(['customers-service', 'orders-service', 'shipping-service'])('%s answers getHealth on v0 without a key', async (service) => {
        const response = await fetch(`${urlOf(service)}/v0/health`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
    });

    it.each(['customers-service', 'orders-service', 'shipping-service'])('%s answers getVersion on v0 with the versions of its specs', async (service) => {
        const response = await fetch(`${urlOf(service)}/v0/version`);
        expect(response.status).toBe(200);
        const expected = Object.fromEntries(mocks.find((mock) => mock.service === service)!.specs.map((spec) => [spec.prefix, spec.version]));
        expect(await response.json()).toEqual({ buildId: 'mock', stage: 'local', specVersions: expected });
    });

    it('answers listProducts on v1 of the orders service with the example of the spec', async () => {
        const response = await fetch(`${urlOf('orders-service')}/v1/products`, { headers: KEY });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { items: { productId: string }[]; nextCursor: string | null };
        expect(body.items.map((item) => item.productId)).toEqual(['prd_3a7f1c', 'prd_9d2e4b']);
        expect(body.nextCursor).toBeNull();
    });

    it('answers a v1 route of every service, so both the v0 and the v1 paths are served', async () => {
        for (const [service, route] of [
            ['customers-service', '/v1/customers'],
            ['orders-service', '/v1/orders'],
            ['shipping-service', '/v1/shipments']
        ]) {
            expect((await fetch(`${urlOf(service)}${route}`, { headers: KEY })).status).toBe(200);
        }
    });

    it('answers the readiness route of the customers service, which needs a key', async () => {
        expect((await fetch(`${urlOf('customers-service')}/v0/health/ready`)).status).toBe(403);
        expect((await fetch(`${urlOf('customers-service')}/v0/health/ready`, { headers: KEY })).status).toBe(200);
        const unavailable = await fetch(`${urlOf('customers-service')}/v0/health/ready`, { headers: { ...KEY, prefer: 'code=503' } });
        expect(unavailable.status).toBe(503);
        expect(Number(unavailable.headers.get('retry-after'))).toBeGreaterThanOrEqual(0);
    });

    it('pass the stage readiness check, including the warm-up and the version of every spec', async () => {
        const baseUrls = Object.fromEntries(mocks.map((mock) => [mock.service, mock.url]));
        const report = await checkStage({ stage: 'local', warmup: true, specsDir: SPECS_DIR, baseUrls, env: { APITEST_LOCAL_TESTS_API_KEY: 'smoke-test-key' } });
        expect(report.problems).toEqual([]);
        expect(report.ok).toBe(true);
        expect((await loadLibrarySpecs(SPECS_DIR)).specs).toHaveLength(6);
    });
});
