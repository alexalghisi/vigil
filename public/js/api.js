export class ApiError extends Error {
    constructor(status, body) {
        const detail = body?.details?.[0];
        super(detail ? `${detail.field}: ${detail.message}` : (body?.error ?? 'Request failed'));
        this.status = status;
    }
}

async function request(method, path, body) {
    const response = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) {
        throw new ApiError(response.status, payload);
    }
    return payload;
}

export const api = {
    me: () => request('GET', '/auth/me'),
    authenticate: (action, credentials) => request('POST', `/auth/${action}`, credentials),
    signOut: () => request('POST', '/auth/logout', {}),
    monitors: () => request('GET', '/monitors'),
    addMonitor: (monitor) => request('POST', '/monitors', monitor),
    updateMonitor: (id, patch) => request('PATCH', `/monitors/${id}`, patch),
    removeMonitor: (id) => request('DELETE', `/monitors/${id}`),
    incidents: () => request('GET', '/incidents'),
    status: (slug) => request('GET', `/status/${slug}`),
};
