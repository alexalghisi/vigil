import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';

import { HttpError } from './errors.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export function securityHeaders() {
    return helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'"],
                imgSrc: ["'self'"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'none'"],
                formAction: ["'self'"],
                frameAncestors: ["'none'"],
            },
        },
        referrerPolicy: { policy: 'no-referrer' },
    });
}

export function jsonOnly(req, _res, next) {
    if (WRITE_METHODS.has(req.method) && !req.is('application/json')) {
        next(new HttpError(415, 'Content-Type must be application/json'));
        return;
    }
    next();
}

export function authRateLimit(limit) {
    return rateLimit({
        windowMs: 60_000,
        limit,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (_req, _res, next) => next(new HttpError(429, 'Too many attempts, try again in a minute')),
    });
}
