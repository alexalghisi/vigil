import { applyResult } from './outcome.js';

const CONCURRENCY = 10;

export function createScheduler({ db, probe, clock, logger }) {
    const monitors = db.collection('monitors');
    const checks = db.collection('checks');
    const incidents = db.collection('incidents');
    let timer = null;
    let running = null;

    function claimDue(now) {
        return monitors.findOneAndUpdate(
            { paused: false, nextCheckAt: { $lte: now } },
            [
                {
                    $set: {
                        nextCheckAt: { $dateAdd: { startDate: now, unit: 'second', amount: '$intervalSeconds' } },
                    },
                },
            ],
            { sort: { nextCheckAt: 1 } },
        );
    }

    async function record(monitor, result, now) {
        const { patch, incident } = applyResult(monitor, result, now);
        await checks.insertOne({
            at: now,
            monitorId: monitor._id,
            ok: result.ok,
            statusCode: result.statusCode,
            latencyMs: result.latencyMs,
            error: result.error,
        });
        await monitors.updateOne({ _id: monitor._id }, { $set: patch });
        if (incident === 'open') {
            await incidents.insertOne({
                monitorId: monitor._id,
                ownerId: monitor.ownerId,
                monitorName: monitor.name,
                reason: result.error,
                startedAt: now,
                resolvedAt: null,
            });
        } else if (incident === 'resolve') {
            await incidents.updateMany({ monitorId: monitor._id, resolvedAt: null }, { $set: { resolvedAt: now } });
        }
    }

    async function worker(now) {
        let checked = 0;
        for (let monitor = await claimDue(now); monitor; monitor = await claimDue(now)) {
            await record(monitor, await probe(monitor), clock());
            checked += 1;
        }
        return checked;
    }

    async function runDue() {
        const now = clock();
        const counts = await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(now)));
        return counts.reduce((sum, count) => sum + count, 0);
    }

    function tick() {
        if (running) {
            return;
        }
        running = runDue()
            .catch((error) => logger.error(error))
            .finally(() => {
                running = null;
            });
    }

    return {
        runDue,
        start(tickMs) {
            timer = setInterval(tick, tickMs);
        },
        async stop() {
            clearInterval(timer);
            await running;
        },
    };
}
