export class HttpError extends Error {
    constructor(status, message, details) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

export function notFound(_req, _res, next) {
    next(new HttpError(404, 'Not found'));
}

export function errorHandler(logger) {
    return (error, _req, res, _next) => {
        if (error instanceof HttpError) {
            res.status(error.status).json({ error: error.message, details: error.details });
            return;
        }
        if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
            res.status(error.status).json({ error: 'Malformed request body' });
            return;
        }
        logger.error(error);
        res.status(500).json({ error: 'Internal server error' });
    };
}
