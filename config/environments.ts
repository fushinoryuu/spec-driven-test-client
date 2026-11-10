// Base URLs of the services, per stage. This is the minimal static config the stage readiness check
// reads (scripts/check-stage.ts) until the backend publishes its stage manifest (its Phase 5).
// Phase 3 extends this file with the environment flags and auth settings.
//
// The key is the service name from the spec file name without the version, so
// `orders-service-v1.yaml` is `orders-service`. The value is the base URL without the version
// prefix, because every route in a spec already starts with `/v0` or `/v1`. If the URL has a
// path of its own, such as an API Gateway stage name, keep it and leave off the trailing slash.
//
// `local` is the spec-driven mocks (`npm run mock`, see mock/README.md) on their default ports. A
// unit test keeps these URLs equal to the ports the mocks use. Run the mocks with `--port` and the
// URLs below no longer match, so pass the real ones to your code instead.
//
// No deployed stage exists yet, so `dev` and `prod` have no URLs. The `dev` stage is deployed and
// destroyed by every backend pull request run, so its URLs change each time. Take them from the
// backend's stage manifest when it exists. Never put a key here.

export const STAGES = ['dev', 'prod', 'local'] as const;

export type Stage = (typeof STAGES)[number];

export const environments: Record<Stage, Record<string, string>> = {
    dev: {},
    prod: {},
    local: {
        'customers-service': 'http://127.0.0.1:4010',
        'orders-service': 'http://127.0.0.1:4011',
        'shipping-service': 'http://127.0.0.1:4012'
    }
};
