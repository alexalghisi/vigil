import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarise, WINDOW_HOURS } from '../../src/monitors/stats.js';

const now = new Date('2026-03-10T12:30:00Z');

test('an empty window has no uptime figure and a bucket for every hour', () => {
    const { uptime, buckets } = summarise([], now);
    assert.equal(uptime, null);
    assert.equal(buckets.length, WINDOW_HOURS);
    assert.equal(buckets.at(-1).hour, '2026-03-10T12:00:00.000Z');
    assert.equal(buckets[0].hour, '2026-03-09T13:00:00.000Z');
    assert.deepEqual(buckets[0], { hour: '2026-03-09T13:00:00.000Z', total: 0, up: 0, avgLatencyMs: null });
});

test('uptime is the share of successful checks across the window', () => {
    const { uptime } = summarise(
        [
            { hour: new Date('2026-03-10T11:00:00Z'), total: 60, up: 60, avgLatencyMs: 100 },
            { hour: new Date('2026-03-10T12:00:00Z'), total: 30, up: 15, avgLatencyMs: 300 },
        ],
        now,
    );
    assert.equal(uptime, 83.33);
});

test('rows land in the bucket of their hour with rounded latency', () => {
    const { buckets } = summarise(
        [{ hour: new Date('2026-03-10T11:00:00Z'), total: 4, up: 3, avgLatencyMs: 141.6 }],
        now,
    );
    assert.deepEqual(buckets.at(-2), { hour: '2026-03-10T11:00:00.000Z', total: 4, up: 3, avgLatencyMs: 142 });
});

test('rows outside the window are ignored', () => {
    const { uptime } = summarise(
        [{ hour: new Date('2026-03-08T11:00:00Z'), total: 10, up: 0, avgLatencyMs: 50 }],
        now,
    );
    assert.equal(uptime, null);
});
