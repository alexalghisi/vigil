import { Router } from 'express';

import { HttpError } from '../http/errors.js';
import { objectId, parse, route } from '../http/validate.js';
import { createMonitor, updateMonitor } from './schema.js';
import { loadStats } from './stats.js';

export const MONITOR_LIMIT = 50;

function present(monitor, stats) {
    return {
        id: monitor._id.toString(),
        name: monitor.name,
        url: monitor.url,
        intervalSeconds: monitor.intervalSeconds,
        expectedStatus: monitor.expectedStatus,
        paused: monitor.paused,
        status: monitor.status,
        lastCheckedAt: monitor.lastCheckedAt,
        lastLatencyMs: monitor.lastLatencyMs,
        ...stats,
    };
}

export function monitorRoutes({ db, guard, clock }) {
    const monitors = db.collection('monitors');
    const router = Router();

    function assertTarget(url) {
        try {
            guard.assertLiteral(new URL(url).hostname);
        } catch (error) {
            throw new HttpError(400, 'Validation failed', [{ field: 'url', message: error.message }]);
        }
    }

    async function findOwned(req, res) {
        const monitor = await monitors.findOne({ _id: objectId(req.params.id), ownerId: res.locals.user._id });
        if (!monitor) {
            throw new HttpError(404, 'Not found');
        }
        return monitor;
    }

    router.get(
        '/',
        route(async (_req, res) => {
            const owned = await monitors.find({ ownerId: res.locals.user._id }).sort({ createdAt: 1 }).toArray();
            const stats = await loadStats(db, owned.map((monitor) => monitor._id), clock());
            res.json(owned.map((monitor) => present(monitor, stats.get(monitor._id.toString()))));
        }),
    );

    router.post(
        '/',
        route(async (req, res) => {
            const input = parse(createMonitor, req.body);
            assertTarget(input.url);
            if ((await monitors.countDocuments({ ownerId: res.locals.user._id })) >= MONITOR_LIMIT) {
                throw new HttpError(409, `An account can hold at most ${MONITOR_LIMIT} monitors`);
            }
            const now = clock();
            const monitor = {
                ...input,
                ownerId: res.locals.user._id,
                paused: false,
                status: 'pending',
                consecutiveFailures: 0,
                lastCheckedAt: null,
                lastLatencyMs: null,
                nextCheckAt: now,
                createdAt: now,
            };
            const { insertedId } = await monitors.insertOne(monitor);
            res.status(201).json(present({ ...monitor, _id: insertedId }));
        }),
    );

    router.patch(
        '/:id',
        route(async (req, res) => {
            const monitor = await findOwned(req, res);
            const patch = parse(updateMonitor, req.body);
            if (patch.url) {
                assertTarget(patch.url);
            }
            if (patch.paused === false && monitor.paused) {
                patch.nextCheckAt = clock();
            }
            await monitors.updateOne({ _id: monitor._id }, { $set: patch });
            res.json(present({ ...monitor, ...patch }));
        }),
    );

    router.delete(
        '/:id',
        route(async (req, res) => {
            const monitor = await findOwned(req, res);
            await Promise.all([
                monitors.deleteOne({ _id: monitor._id }),
                db.collection('checks').deleteMany({ monitorId: monitor._id }),
                db.collection('incidents').deleteMany({ monitorId: monitor._id }),
            ]);
            res.status(204).end();
        }),
    );

    return router;
}
