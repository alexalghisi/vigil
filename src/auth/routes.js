import { randomBytes } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../http/errors.js';
import { parse, route } from '../http/validate.js';
import { hashPassword, verifyPassword } from './passwords.js';

const DUPLICATE_KEY = 11000;

const credentials = z
    .object({
        email: z.string().trim().toLowerCase().email().max(254),
        password: z.string().min(10).max(200),
    })
    .strict();

function present(user) {
    return { id: user._id.toString(), email: user.email, statusSlug: user.statusSlug };
}

export function authRoutes({ db, sessions, clock }) {
    const users = db.collection('users');
    const router = Router();
    let decoyHash;

    router.post(
        '/register',
        route(async (req, res) => {
            const { email, password } = parse(credentials, req.body);
            const user = {
                email,
                passwordHash: await hashPassword(password),
                statusSlug: randomBytes(9).toString('base64url'),
                createdAt: clock(),
            };
            try {
                const { insertedId } = await users.insertOne(user);
                await sessions.open(res, insertedId);
                res.status(201).json(present({ ...user, _id: insertedId }));
            } catch (error) {
                if (error.code === DUPLICATE_KEY) {
                    throw new HttpError(409, 'An account with this email already exists');
                }
                throw error;
            }
        }),
    );

    router.post(
        '/login',
        route(async (req, res) => {
            const { email, password } = parse(credentials, req.body);
            const user = await users.findOne({ email });
            decoyHash ??= await hashPassword(randomBytes(16).toString('hex'));
            const valid = await verifyPassword(password, user?.passwordHash ?? decoyHash);
            if (!user || !valid) {
                throw new HttpError(401, 'Invalid email or password');
            }
            await sessions.open(res, user._id);
            res.json(present(user));
        }),
    );

    router.post(
        '/logout',
        route(async (req, res) => {
            await sessions.close(req, res);
            res.status(204).end();
        }),
    );

    router.get('/me', sessions.requireUser, (_req, res) => {
        res.json(present(res.locals.user));
    });

    return router;
}
