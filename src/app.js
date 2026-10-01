import { fileURLToPath } from 'node:url';

import express from 'express';

import { authRoutes } from './auth/routes.js';
import { createSessions } from './auth/sessions.js';
import { errorHandler, notFound } from './http/errors.js';
import { authRateLimit, jsonOnly, securityHeaders } from './http/security.js';
import { monitorRoutes } from './monitors/routes.js';
import { incidentRoutes, statusRoutes } from './status/routes.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

export function createApp({ db, config, guard, logger, clock = () => new Date() }) {
    const sessions = createSessions({ db, clock, secureCookies: config.secureCookies });
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    app.use(securityHeaders());

    const api = express.Router();
    api.use((_req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    api.use(jsonOnly);
    api.use(express.json({ limit: '10kb' }));
    api.use('/auth', authRateLimit(config.authRateLimit), authRoutes({ db, sessions, clock }));
    api.use('/monitors', sessions.requireUser, monitorRoutes({ db, guard, clock }));
    api.use('/incidents', sessions.requireUser, incidentRoutes({ db }));
    api.use('/status', statusRoutes({ db, clock }));
    api.use(notFound);

    app.use('/api', api);
    app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));
    app.get('/status/:slug', (_req, res) => res.sendFile('status.html', { root: PUBLIC_DIR }));
    app.use(notFound);
    app.use(errorHandler(logger));
    return app;
}
