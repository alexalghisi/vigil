import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { MONITOR_LIMIT } from '../../src/monitors/routes.js';
import { createClient, startApi } from '../support/harness.js';

let api;
let client;

before(async () => {
    api = await startApi();
});

beforeEach(async () => {
    await api.reset();
    client = createClient(api.origin);
    await client.signUp();
});

after(() => api.stop());

const website = { name: 'Website', url: 'https://example.com/health' };

test('a new monitor starts pending with sensible defaults', async () => {
    const response = await client.post('/api/monitors', website);
    assert.equal(response.status, 201);
    assert.match(response.body.id, /^[0-9a-f]{24}$/);
    assert.deepEqual(
        { ...response.body, id: undefined },
        {
            id: undefined,
            name: 'Website',
            url: 'https://example.com/health',
            intervalSeconds: 60,
            expectedStatus: 200,
            paused: false,
            status: 'pending',
            lastCheckedAt: null,
            lastLatencyMs: null,
        },
    );
});

test('the list shows monitors in creation order with their 24 hour statistics', async () => {
    await client.post('/api/monitors', website);
    await client.post('/api/monitors', { name: 'API', url: 'https://api.example.com' });
    const { body } = await client.get('/api/monitors');
    assert.deepEqual(body.map((monitor) => monitor.name), ['Website', 'API']);
    assert.equal(body[0].uptime, null);
    assert.equal(body[0].buckets.length, 24);
});

for (const [label, url] of [
    ['a file URL', 'file:///etc/passwd'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['an FTP URL', 'ftp://example.com/file'],
    ['embedded credentials', 'https://admin:secret@example.com'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['a loopback address', 'http://127.0.0.1:27017'],
    ['an IPv6 loopback address', 'http://[::1]/'],
    ['a private network address', 'http://10.0.0.8/admin'],
    ['something that is not a URL', 'example'],
]) {
    test(`${label} cannot be monitored`, async () => {
        const response = await client.post('/api/monitors', { name: 'Probe', url });
        assert.equal(response.status, 400);
        assert.equal(response.body.details[0].field, 'url');
    });
}

test('intervals outside 30 seconds to one hour are rejected', async () => {
    for (const intervalSeconds of [5, 29, 3601, 60.5, '60']) {
        const response = await client.post('/api/monitors', { ...website, intervalSeconds });
        assert.equal(response.status, 400, String(intervalSeconds));
    }
});

test('fields that only the server may set are refused', async () => {
    const response = await client.post('/api/monitors', { ...website, status: 'up', ownerId: 'someone' });
    assert.equal(response.status, 400);
});

test('a monitor can be renamed, retargeted and paused', async () => {
    const { body: created } = await client.post('/api/monitors', website);
    const response = await client.patch(`/api/monitors/${created.id}`, {
        name: 'Marketing site',
        intervalSeconds: 300,
        paused: true,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.name, 'Marketing site');
    assert.equal(response.body.intervalSeconds, 300);
    assert.equal(response.body.paused, true);

    const { body: list } = await client.get('/api/monitors');
    assert.equal(list[0].name, 'Marketing site');
});

test('resuming a paused monitor schedules it immediately', async () => {
    const { body: created } = await client.post('/api/monitors', website);
    await client.patch(`/api/monitors/${created.id}`, { paused: true });
    await api.db.collection('monitors').updateOne({}, { $set: { nextCheckAt: new Date('2030-01-01') } });

    await client.patch(`/api/monitors/${created.id}`, { paused: false });
    const stored = await api.db.collection('monitors').findOne({});
    assert.deepEqual(stored.nextCheckAt, api.time.now);
});

test('an update is validated like a creation', async () => {
    const { body: created } = await client.post('/api/monitors', website);
    const path = `/api/monitors/${created.id}`;
    assert.equal((await client.patch(path, {})).status, 400);
    assert.equal((await client.patch(path, { url: 'http://192.168.1.1' })).status, 400);
    assert.equal((await client.patch(path, { status: 'up' })).status, 400);
    assert.equal((await client.patch(path, { name: { $set: 'x' } })).status, 400);
});

test('deleting a monitor removes its checks and incidents', async () => {
    const { body: created } = await client.post('/api/monitors', website);
    const monitor = await api.db.collection('monitors').findOne({});
    await api.db.collection('checks').insertOne({ at: api.time.now, monitorId: monitor._id, ok: true, latencyMs: 90 });
    await api.db.collection('incidents').insertOne({ monitorId: monitor._id, ownerId: monitor.ownerId });

    assert.equal((await client.delete(`/api/monitors/${created.id}`)).status, 204);
    for (const name of ['monitors', 'checks', 'incidents']) {
        assert.equal(await api.db.collection(name).countDocuments({}), 0, name);
    }
});

test("one account cannot read, change or delete another account's monitors", async () => {
    const { body: created } = await client.post('/api/monitors', website);
    const intruder = createClient(api.origin);
    await intruder.signUp('mallory@example.com');

    assert.deepEqual((await intruder.get('/api/monitors')).body, []);
    assert.equal((await intruder.patch(`/api/monitors/${created.id}`, { name: 'Owned' })).status, 404);
    assert.equal((await intruder.delete(`/api/monitors/${created.id}`)).status, 404);
    assert.equal((await client.get('/api/monitors')).body[0].name, 'Website');
});

test('a malformed identifier is a 404, not a server error', async () => {
    for (const id of ['1', 'zzzzzzzzzzzzzzzzzzzzzzzz', '%7B%22%24ne%22%3Anull%7D']) {
        assert.equal((await client.patch(`/api/monitors/${id}`, { name: 'x' })).status, 404, id);
    }
});

test('an account is capped at a fixed number of monitors', async () => {
    const owner = await api.db.collection('users').findOne({});
    await api.db.collection('monitors').insertMany(
        Array.from({ length: MONITOR_LIMIT }, (_, index) => ({ ownerId: owner._id, name: `m${index}` })),
    );
    assert.equal((await client.post('/api/monitors', website)).status, 409);
});
