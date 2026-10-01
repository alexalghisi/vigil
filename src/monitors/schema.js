import { z } from 'zod';

const url = z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => /^https?:\/\//i.test(value), 'Only http and https targets can be monitored')
    .refine((value) => !/^[a-z]+:\/\/[^/?#]*@/i.test(value), 'Credentials in the URL are not allowed');

const fields = {
    name: z.string().trim().min(1).max(80),
    url,
    intervalSeconds: z.number().int().min(30).max(3600),
    expectedStatus: z.number().int().min(100).max(599),
};

export const createMonitor = z
    .object({
        name: fields.name,
        url: fields.url,
        intervalSeconds: fields.intervalSeconds.default(60),
        expectedStatus: fields.expectedStatus.default(200),
    })
    .strict();

export const updateMonitor = z
    .object({ ...fields, paused: z.boolean() })
    .partial()
    .strict()
    .refine((patch) => Object.keys(patch).length > 0, 'Provide at least one field to update');
