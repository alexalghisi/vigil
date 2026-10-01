import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyResult } from '../../src/checks/outcome.js';

const now = new Date('2026-03-10T12:00:00Z');
const success = { ok: true, statusCode: 200, latencyMs: 120, error: null };
const failure = { ok: false, statusCode: 503, latencyMs: 80, error: 'Expected 200, got 503' };

function monitor(status, consecutiveFailures = 0) {
    return { status, consecutiveFailures };
}

test('a first successful check brings a pending monitor up', () => {
    const { patch, incident } = applyResult(monitor('pending'), success, now);
    assert.deepEqual(patch, { status: 'up', consecutiveFailures: 0, lastCheckedAt: now, lastLatencyMs: 120 });
    assert.equal(incident, null);
});

test('a single failure does not take a monitor down', () => {
    const { patch, incident } = applyResult(monitor('up'), failure, now);
    assert.equal(patch.status, 'up');
    assert.equal(patch.consecutiveFailures, 1);
    assert.equal(incident, null);
});

test('the second consecutive failure opens an incident', () => {
    const { patch, incident } = applyResult(monitor('up', 1), failure, now);
    assert.equal(patch.status, 'down');
    assert.equal(incident, 'open');
});

test('further failures keep the monitor down without a new incident', () => {
    const { patch, incident } = applyResult(monitor('down', 2), failure, now);
    assert.equal(patch.status, 'down');
    assert.equal(patch.consecutiveFailures, 3);
    assert.equal(incident, null);
});

test('recovery resolves the incident and resets the failure count', () => {
    const { patch, incident } = applyResult(monitor('down', 5), success, now);
    assert.equal(patch.status, 'up');
    assert.equal(patch.consecutiveFailures, 0);
    assert.equal(incident, 'resolve');
});

test('a success between failures prevents an incident', () => {
    const afterFailure = applyResult(monitor('up'), failure, now).patch;
    const afterSuccess = applyResult(afterFailure, success, now).patch;
    const { patch, incident } = applyResult(afterSuccess, failure, now);
    assert.equal(patch.status, 'up');
    assert.equal(incident, null);
});

test('a monitor that never succeeded goes down after two failures', () => {
    const first = applyResult(monitor('pending'), failure, now);
    assert.equal(first.patch.status, 'pending');
    const second = applyResult(first.patch, failure, now);
    assert.equal(second.patch.status, 'down');
    assert.equal(second.incident, 'open');
});
