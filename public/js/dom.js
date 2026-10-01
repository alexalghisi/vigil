const SVG_NS = 'http://www.w3.org/2000/svg';

function build(node, attributes, children) {
    for (const [name, value] of Object.entries(attributes)) {
        if (name.startsWith('on')) {
            node.addEventListener(name.slice(2), value);
        } else {
            node.setAttribute(name, value);
        }
    }
    node.append(...children);
    return node;
}

export function h(tag, attributes = {}, ...children) {
    return build(document.createElement(tag), attributes, children);
}

export function svg(tag, attributes = {}, ...children) {
    return build(document.createElementNS(SVG_NS, tag), attributes, children);
}

export function show(node, visible) {
    node.hidden = !visible;
}

export function byId(id) {
    return document.getElementById(id);
}
