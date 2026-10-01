import { Console } from 'node:console';

import { hashPassword } from '../src/auth/passwords.js';
import { loadConfig } from '../src/config.js';
import { connect } from '../src/db.js';

const DEMO = { email: 'demo@vigil.test', password: 'vigil demo password', statusSlug: 'demo-status1' };
const MINUTE_MS = 60_000;
const WINDOW_MINUTES = 24 * 60;

const SERVICES = [
    { name: 'Marketing site', url: 'https://www.example.com/', baseLatency: 180, outages: [] },
    { name: 'Public API', url: 'https://api.example.com/health', baseLatency: 95, outages: [[425, 400]] },
    { name: 'Checkout', url: 'https://pay.example.com/ping', baseLatency: 240, outages: [[905, 880], [136, 130]] },
    { name: 'Docs', url: 'https://docs.example.com/', baseLatency: 140, outages: [] },
    { name: 'Webhooks', url: 'https://hooks.example.com/status', baseLatency: 310, outages: [[18, 0]] },
];

function isDown(outages, minutesAgo) {
    return outages.some(([from, to]) => minutesAgo <= from && minutesAgo >= to);
}

function latency(base, minutesAgo) {
    const daily = Math.sin((minutesAgo / WINDOW_MINUTES) * Math.PI * 2 + base) * base * 0.25;
    const jitter = Math.sin(minutesAgo * 1.7) * base * 0.08;
    return Math.round(base + daily + jitter);
}

const logger = new Console(process.stdout);
const { client, db } = await connect(loadConfig(process.env).mongodbUrl);
const now = new Date();
const minutesAgo = (minutes) => new Date(now.getTime() - minutes * MINUTE_MS);

const existing = await db.collection('users').findOne({ email: DEMO.email });
if (existing) {
    const owned = await db.collection('monitors').find({ ownerId: existing._id }).toArray();
    const monitorIds = owned.map((monitor) => monitor._id);
    await db.collection('checks').deleteMany({ monitorId: { $in: monitorIds } });
    await db.collection('incidents').deleteMany({ ownerId: existing._id });
    await db.collection('monitors').deleteMany({ ownerId: existing._id });
    await db.collection('sessions').deleteMany({ userId: existing._id });
    await db.collection('users').deleteOne({ _id: existing._id });
}

const { insertedId: ownerId } = await db.collection('users').insertOne({
    email: DEMO.email,
    passwordHash: await hashPassword(DEMO.password),
    statusSlug: DEMO.statusSlug,
    createdAt: minutesAgo(WINDOW_MINUTES),
});

for (const [index, service] of SERVICES.entries()) {
    const down = isDown(service.outages, 0);
    const { insertedId: monitorId } = await db.collection('monitors').insertOne({
        name: service.name,
        url: service.url,
        intervalSeconds: 60,
        expectedStatus: 200,
        ownerId,
        paused: false,
        status: down ? 'down' : 'up',
        consecutiveFailures: down ? 18 : 0,
        lastCheckedAt: now,
        lastLatencyMs: latency(service.baseLatency, 0),
        nextCheckAt: new Date(now.getTime() + MINUTE_MS),
        createdAt: minutesAgo(WINDOW_MINUTES - index),
    });

    const checks = [];
    for (let minute = WINDOW_MINUTES - 1; minute >= 0; minute -= 1) {
        const ok = !isDown(service.outages, minute);
        checks.push({
            at: minutesAgo(minute),
            monitorId,
            ok,
            statusCode: ok ? 200 : 503,
            latencyMs: latency(service.baseLatency, minute),
            error: ok ? null : 'Expected 200, got 503',
        });
    }
    await db.collection('checks').insertMany(checks);

    if (service.outages.length > 0) {
        await db.collection('incidents').insertMany(
            service.outages.map(([from, to]) => ({
                monitorId,
                ownerId,
                monitorName: service.name,
                reason: 'Expected 200, got 503',
                startedAt: minutesAgo(from),
                resolvedAt: to === 0 ? null : minutesAgo(to),
            })),
        );
    }
}

await client.close();
logger.log(`Seeded ${SERVICES.length} monitors. Sign in as ${DEMO.email} / ${DEMO.password}`);
