import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { createProbe } from '../../src/checks/probe.js';
import { createScheduler } from '../../src/checks/scheduler.js';
import { createTargetGuard } from '../../src/checks/targetGuard.js';
import { createClient, silentLogger, startApi, startTarget } from '../support/harness.js';

let api;
let target;
let client;
let scheduler;
const targetState = { status: 200, hits: 0 };

before(async () => {
    api = await startApi({ allowPrivate: true });
    target = await startTarget((req, res) => {
        targetState.hits += 1;
        if (req.url === '/slow') {
            return;
        }
        res.writeHead(req.url === '/moved' ? 302 : targetState.status, { location: 'http://127.0.0.1:1/' }).end();
    });
    scheduler = createScheduler({
        db: api.db,
        logger: silentLogger,
        clock: () => api.time.now,
        probe: createProbe({ guard: api.guard, timeoutMs: 300 }),
    });
});

beforeEach(async () => {
    await api.reset();
    api.time.now = new Date('2026-03-10T12:30:00Z');
    targetState.status = 200;
    targetState.hits = 0;
    client = createClient(api.origin);
    await client.signUp();
});

after(async () => {
    await target.stop();
    await api.stop();
});

function advance(seconds) {
    api.time.now = new Date(api.time.now.getTime() + seconds * 1000);
}

async function addMonitor(path = '/', extra = {}) {
    const { body } = await client.post('/api/monitors', { name: 'Target', url: target.origin + path, ...extra });
    return body;
}

async function onlyMonitor() {
    const { body } = await client.get('/api/monitors');
    return body[0];
}

test('a due monitor is checked and comes up', async () => {
    await addMonitor();
    assert.equal(await scheduler.runDue(), 1);

    const monitor = await onlyMonitor();
    assert.equal(monitor.status, 'up');
    assert.equal(monitor.uptime, 100);
    assert.equal(typeof monitor.lastLatencyMs, 'number');
    assert.deepEqual(monitor.buckets.at(-1).total, 1);
});

test('a monitor is not checked again before its interval elapses', async () => {
    await addMonitor('/', { intervalSeconds: 60 });
    await scheduler.runDue();
    advance(59);
    assert.equal(await scheduler.runDue(), 0);
    advance(1);
    assert.equal(await scheduler.runDue(), 1);
    assert.equal(targetState.hits, 2);
});

test('paused monitors are skipped', async () => {
    const monitor = await addMonitor();
    await client.patch(`/api/monitors/${monitor.id}`, { paused: true });
    assert.equal(await scheduler.runDue(), 0);
    assert.equal(targetState.hits, 0);
});

test('two schedulers never check the same monitor twice', async () => {
    for (let n = 0; n < 8; n += 1) {
        await addMonitor(`/?n=${n}`);
    }
    const twin = createScheduler({
        db: api.db,
        logger: silentLogger,
        clock: () => api.time.now,
        probe: createProbe({ guard: api.guard, timeoutMs: 300 }),
    });
    const counts = await Promise.all([scheduler.runDue(), twin.runDue()]);
    assert.equal(counts[0] + counts[1], 8);
    assert.equal(targetState.hits, 8);
});

test('an outage opens one incident and recovery resolves it', async () => {
    await addMonitor();
    await scheduler.runDue();

    targetState.status = 503;
    advance(60);
    await scheduler.runDue();
    assert.equal((await onlyMonitor()).status, 'up');
    assert.deepEqual((await client.get('/api/incidents')).body, []);

    advance(60);
    await scheduler.runDue();
    advance(60);
    await scheduler.runDue();
    assert.equal((await onlyMonitor()).status, 'down');
    const open = (await client.get('/api/incidents')).body;
    assert.equal(open.length, 1);
    assert.equal(open[0].monitorName, 'Target');
    assert.equal(open[0].reason, 'Expected 200, got 503');
    assert.equal(open[0].resolvedAt, null);

    targetState.status = 200;
    advance(60);
    await scheduler.runDue();
    assert.equal((await onlyMonitor()).status, 'up');
    const resolved = (await client.get('/api/incidents')).body;
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].resolvedAt, api.time.now.toISOString());
    assert.equal((await onlyMonitor()).uptime, 40);
});

test('a target that does not answer in time counts as a failure', async () => {
    await addMonitor('/slow');
    await scheduler.runDue();
    const check = await api.db.collection('checks').findOne({});
    assert.equal(check.ok, false);
    assert.equal(check.error, 'No response within 300 ms');
});

test('redirects are reported, not followed', async () => {
    await addMonitor('/moved', { expectedStatus: 302 });
    await scheduler.runDue();
    assert.equal((await onlyMonitor()).status, 'up');
    assert.equal(targetState.hits, 1);
});

test('a connection failure is recorded with its reason', async () => {
    await client.post('/api/monitors', { name: 'Closed port', url: 'http://127.0.0.1:1/' });
    await scheduler.runDue();
    const check = await api.db.collection('checks').findOne({});
    assert.equal(check.ok, false);
    assert.match(check.error, /ECONNREFUSED/);
});

test('a hostname that resolves to a private address is never contacted', async () => {
    const probe = createProbe({
        guard: createTargetGuard({ resolve: async () => [{ address: '127.0.0.1', family: 4 }] }),
        timeoutMs: 300,
    });
    const port = new URL(target.origin).port;
    const result = await probe({ url: `http://rebind.example.com:${port}/`, expectedStatus: 200 });
    assert.equal(result.ok, false);
    assert.match(result.error, /non-public address \(127\.0\.0\.1\)/);
    assert.equal(targetState.hits, 0);
});
