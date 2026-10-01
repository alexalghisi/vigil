import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../http/errors.js';
import { parse, route } from '../http/validate.js';
import { loadStats } from '../monitors/stats.js';

const INCIDENT_LIMIT = 20;
const slug = z.string().regex(/^[A-Za-z0-9_-]{12}$/);

function presentIncident(incident) {
    return {
        id: incident._id.toString(),
        monitorName: incident.monitorName,
        reason: incident.reason,
        startedAt: incident.startedAt,
        resolvedAt: incident.resolvedAt,
    };
}

function recentIncidents(db, ownerId) {
    return db
        .collection('incidents')
        .find({ ownerId })
        .sort({ startedAt: -1 })
        .limit(INCIDENT_LIMIT)
        .map(presentIncident)
        .toArray();
}

export function incidentRoutes({ db }) {
    const router = Router();
    router.get(
        '/',
        route(async (_req, res) => {
            res.json(await recentIncidents(db, res.locals.user._id));
        }),
    );
    return router;
}

export function statusRoutes({ db, clock }) {
    const router = Router();
    router.get(
        '/:slug',
        route(async (req, res) => {
            const owner = await db.collection('users').findOne({ statusSlug: parse(slug, req.params.slug) });
            if (!owner) {
                throw new HttpError(404, 'Not found');
            }
            const monitors = await db
                .collection('monitors')
                .find({ ownerId: owner._id, paused: false })
                .sort({ createdAt: 1 })
                .toArray();
            const stats = await loadStats(db, monitors.map((monitor) => monitor._id), clock());
            res.json({
                monitors: monitors.map((monitor) => ({
                    name: monitor.name,
                    status: monitor.status,
                    ...stats.get(monitor._id.toString()),
                })),
                incidents: await recentIncidents(db, owner._id),
            });
        }),
    );
    return router;
}
