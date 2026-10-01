import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadConfig } from '../../src/config.js';

test('defaults are safe for a first local run', () => {
    assert.deepEqual(loadConfig({}), {
        port: 3000,
        mongodbUrl: 'mongodb://127.0.0.1:27017/vigil',
        secureCookies: false,
        allowPrivateTargets: false,
        trustProxy: 0,
        authRateLimit: 20,
        schedulerTickMs: 5000,
        probeTimeoutMs: 10_000,
    });
});

test('environment values override the defaults', () => {
    const config = loadConfig({ PORT: '8080', SECURE_COOKIES: 'true', ALLOW_PRIVATE_TARGETS: 'true' });
    assert.equal(config.port, 8080);
    assert.equal(config.secureCookies, true);
    assert.equal(config.allowPrivateTargets, true);
});

test('an invalid value names the offending variable', () => {
    assert.throws(() => loadConfig({ PORT: 'http' }), /^Error: PORT: /);
    assert.throws(() => loadConfig({ SECURE_COOKIES: 'yes' }), /^Error: SECURE_COOKIES: /);
});
