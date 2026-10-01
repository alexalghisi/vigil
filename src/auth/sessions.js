import { createHash, randomBytes } from 'node:crypto';

import * as cookie from 'cookie';

import { HttpError } from '../http/errors.js';

export const SESSION_COOKIE = 'vigil_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

function readToken(req) {
    return cookie.parse(req.headers.cookie ?? '')[SESSION_COOKIE];
}

export function createSessions({ db, clock, secureCookies }) {
    const sessions = db.collection('sessions');
    const users = db.collection('users');
    const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' };

    return {
        async open(res, userId) {
            const token = randomBytes(32).toString('base64url');
            const expiresAt = new Date(clock().getTime() + SESSION_TTL_MS);
            await sessions.insertOne({ tokenHash: hashToken(token), userId, expiresAt });
            res.cookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
        },

        async close(req, res) {
            const token = readToken(req);
            if (token) {
                await sessions.deleteOne({ tokenHash: hashToken(token) });
            }
            res.clearCookie(SESSION_COOKIE, cookieOptions);
        },

        requireUser(req, res, next) {
            const token = readToken(req);
            if (!token) {
                next(new HttpError(401, 'Sign in required'));
                return;
            }
            sessions
                .findOne({ tokenHash: hashToken(token), expiresAt: { $gt: clock() } })
                .then((session) => session && users.findOne({ _id: session.userId }))
                .then((user) => {
                    if (!user) {
                        throw new HttpError(401, 'Sign in required');
                    }
                    res.locals.user = user;
                    next();
                })
                .catch(next);
        },
    };
}
