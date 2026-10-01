import { z } from 'zod';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z.object({
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    MONGODB_URL: z.string().url().default('mongodb://127.0.0.1:27017/vigil'),
    SECURE_COOKIES: flag.default('false'),
    ALLOW_PRIVATE_TARGETS: flag.default('false'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),
    SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(5000),
    PROBE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export function loadConfig(env) {
    const parsed = schema.safeParse(env);
    if (!parsed.success) {
        const [issue] = parsed.error.issues;
        throw new Error(`${issue.path.join('.')}: ${issue.message}`);
    }
    const value = parsed.data;
    return {
        port: value.PORT,
        mongodbUrl: value.MONGODB_URL,
        secureCookies: value.SECURE_COOKIES,
        allowPrivateTargets: value.ALLOW_PRIVATE_TARGETS,
        trustProxy: value.TRUST_PROXY,
        authRateLimit: value.AUTH_RATE_LIMIT,
        schedulerTickMs: value.SCHEDULER_TICK_MS,
        probeTimeoutMs: value.PROBE_TIMEOUT_MS,
    };
}
