import { h, svg } from './dom.js';

const SPARK_WIDTH = 180;
const SPARK_HEIGHT = 40;
const SPARK_PADDING = 4;

const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function bucketState({ total, up }) {
    if (total === 0) {
        return 'idle';
    }
    if (up === total) {
        return 'up';
    }
    return up === 0 ? 'down' : 'degraded';
}

function bucketLabel(bucket) {
    const hour = time.format(new Date(bucket.hour));
    return bucket.total === 0 ? `${hour}: no checks` : `${hour}: ${bucket.up}/${bucket.total} checks passed`;
}

export function formatUptime(uptime) {
    return uptime === null ? '—' : `${uptime.toFixed(2)}%`;
}

function uptimeBars(buckets) {
    return h(
        'div',
        { class: 'bars', role: 'img', 'aria-label': 'Hourly availability over the last 24 hours' },
        ...buckets.map((bucket) => h('span', { class: `bar bar--${bucketState(bucket)}`, title: bucketLabel(bucket) })),
    );
}

function sparkline(buckets) {
    const samples = buckets
        .map((bucket, index) => ({ index, value: bucket.avgLatencyMs }))
        .filter((sample) => sample.value !== null);
    const chart = svg('svg', {
        class: 'sparkline',
        viewBox: `0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`,
        role: 'img',
        'aria-label': 'Average response time per hour',
    });
    if (samples.length < 2) {
        return chart;
    }
    const values = samples.map((sample) => sample.value);
    const min = Math.min(...values);
    const range = Math.max(...values) - min || 1;
    const points = samples.map(({ index, value }) => {
        const x = (index / (buckets.length - 1)) * SPARK_WIDTH;
        const y = SPARK_HEIGHT - SPARK_PADDING - ((value - min) / range) * (SPARK_HEIGHT - 2 * SPARK_PADDING);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    chart.append(svg('polyline', { points: points.join(' ') }));
    return chart;
}

function figure(label, value) {
    return h('div', { class: 'stat' }, h('span', { class: 'muted' }, label), h('strong', {}, value));
}

export function monitorCard(monitor, actions = []) {
    const state = monitor.paused ? 'paused' : monitor.status;
    return h(
        'li',
        { class: 'card monitor', 'data-monitor': monitor.name },
        h(
            'div',
            { class: 'monitor__head' },
            h('span', { class: `pill pill--${state}` }, state),
            h('span', { class: 'monitor__name' }, monitor.name),
            ...(monitor.url ? [h('span', { class: 'monitor__url' }, monitor.url)] : []),
            h('div', { class: 'monitor__actions' }, ...actions),
        ),
        uptimeBars(monitor.buckets),
        h(
            'div',
            { class: 'monitor__figures' },
            figure('Uptime, 24 h', formatUptime(monitor.uptime)),
            ...(monitor.lastLatencyMs === null || monitor.lastLatencyMs === undefined
                ? []
                : [figure('Last response', `${monitor.lastLatencyMs} ms`)]),
            sparkline(monitor.buckets),
        ),
    );
}

export function incidentRow(incident) {
    const resolved = incident.resolvedAt !== null;
    return h(
        'li',
        { class: 'card incident' },
        h('span', { class: `pill pill--${resolved ? 'up' : 'down'}` }, resolved ? 'resolved' : 'ongoing'),
        h('strong', {}, incident.monitorName),
        h('span', { class: 'incident__reason' }, incident.reason),
        h(
            'span',
            { class: 'muted' },
            resolved
                ? `${time.format(new Date(incident.startedAt))} – ${time.format(new Date(incident.resolvedAt))}`
                : `since ${time.format(new Date(incident.startedAt))}`,
        ),
    );
}

export function renderList(list, emptyNotice, items) {
    list.replaceChildren(...items);
    emptyNotice.hidden = items.length > 0;
}
