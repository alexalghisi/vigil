import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { createClient, startApi } from '../support/harness.js';

let api;

before(async () => {
    api = await startApi({ env: { AUTH_RATE_LIMIT: '5' } });
});

beforeEach(() => api.reset());

after(() => api.stop());

test('responses carry a restrictive content security policy', async () => {
    const response = await fetch(`${api.origin}/`);
    const policy = response.headers.get('content-security-policy');
    assert.match(policy, /default-src 'self'/);
    assert.match(policy, /script-src 'self'/);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-powered-by'), null);
});

test('API responses are never cached', async () => {
    const response = await fetch(`${api.origin}/api/auth/me`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('form posts are refused, which rules out cross-site form submissions', async () => {
    const response = await fetch(`${api.origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'email=ada%40example.com&password=correct+horse+battery',
    });
    assert.equal(response.status, 415);
});

test('malformed JSON is answered with 400 and no stack trace', async () => {
    const response = await fetch(`${api.origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"email": ',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Malformed request body' });
});

test('oversized bodies are rejected', async () => {
    const response = await fetch(`${api.origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ada@example.com', password: 'x'.repeat(20_000) }),
    });
    assert.equal(response.status, 413);
});

test('unknown API routes answer with JSON', async () => {
    const response = await createClient(api.origin).get('/api/nope');
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Not found' });
});

test('repeated authentication attempts are throttled', async () => {
    const client = createClient(api.origin);
    const attempt = () => client.post('/api/auth/login', { email: 'ada@example.com', password: 'guess guess guess' });
    const statuses = [];
    for (let n = 0; n < 12; n += 1) {
        statuses.push((await attempt()).status);
    }
    assert.ok(statuses.includes(401));
    assert.equal(statuses.at(-1), 429);
});
