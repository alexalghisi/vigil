import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { createClient, startApi } from '../support/harness.js';

let api;
let client;
let account;

before(async () => {
    api = await startApi();
});

beforeEach(async () => {
    await api.reset();
    client = createClient(api.origin);
    account = await client.signUp();
});

after(() => api.stop());

test('the status page is public and lists monitors by name and state', async () => {
    await client.post('/api/monitors', { name: 'Website', url: 'https://example.com' });
    const visitor = createClient(api.origin);
    const response = await visitor.get(`/api/status/${account.statusSlug}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.incidents, []);
    assert.deepEqual(Object.keys(response.body.monitors[0]).sort(), ['buckets', 'name', 'status', 'uptime']);
});

test('the status page never reveals monitored URLs or account details', async () => {
    await client.post('/api/monitors', { name: 'Billing', url: 'https://billing.internal.example.com/health' });
    const response = await fetch(`${api.origin}/api/status/${account.statusSlug}`);
    const text = await response.text();
    assert.ok(!text.includes('billing.internal.example.com'));
    assert.ok(!text.includes('ada@example.com'));
});

test('paused monitors are left off the status page', async () => {
    const { body: monitor } = await client.post('/api/monitors', { name: 'Website', url: 'https://example.com' });
    await client.patch(`/api/monitors/${monitor.id}`, { paused: true });
    const { body } = await createClient(api.origin).get(`/api/status/${account.statusSlug}`);
    assert.deepEqual(body.monitors, []);
});

test('an unknown or malformed slug is not found', async () => {
    const visitor = createClient(api.origin);
    assert.equal((await visitor.get('/api/status/AAAAAAAAAAAA')).status, 404);
    assert.equal((await visitor.get('/api/status/short')).status, 400);
});

test('incidents belong to their owner only', async () => {
    const owner = await api.db.collection('users').findOne({});
    await api.db.collection('incidents').insertOne({
        ownerId: owner._id,
        monitorName: 'Website',
        reason: 'Expected 200, got 500',
        startedAt: api.time.now,
        resolvedAt: null,
    });
    const other = createClient(api.origin);
    await other.signUp('mallory@example.com');

    assert.equal((await client.get('/api/incidents')).body.length, 1);
    assert.deepEqual((await other.get('/api/incidents')).body, []);
});
