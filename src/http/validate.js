import { ObjectId } from 'mongodb';

import { HttpError } from './errors.js';

export function parse(schema, input) {
    const result = schema.safeParse(input);
    if (!result.success) {
        const details = result.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
        }));
        throw new HttpError(400, 'Validation failed', details);
    }
    return result.data;
}

export function objectId(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{24}$/.test(value)) {
        throw new HttpError(404, 'Not found');
    }
    return new ObjectId(value);
}

export function route(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res)).catch(next);
    };
}
