"use strict";
figma.showUI(__html__, { width: 420, height: 640, themeColors: true });
figma.ui.onmessage = async (message) => {
    try {
        if (message.type === 'ready') {
            post({ type: 'stored-backend-url', url: await backendUrl() });
            post({ type: 'stored-dashboard-token', token: await dashboardToken() });
        }
        else if (message.type === 'save-backend-url') {
            await figma.clientStorage.setAsync('backendUrl', message.url || 'http://localhost:10000');
            post({ type: 'status', message: `Saved backend URL: ${message.url || 'http://localhost:10000'}` });
        }
        else if (message.type === 'save-dashboard-token') {
            await figma.clientStorage.setAsync('dashboardToken', message.token);
            post({ type: 'status', message: message.token ? 'Saved dashboard token for protected bridge calls.' : 'Cleared dashboard token.' });
        }
        else if (message.type === 'create-frame') {
            await createTrmnlFrame();
        }
        else if (message.type === 'insert-text') {
            await insertText(message.entity);
        }
        else if (message.type === 'insert-card') {
            await insertCard(message.entity);
        }
        else if (message.type === 'refresh-selected') {
            await refreshSelected(message.entities);
        }
        else if (message.type === 'export-selected') {
            exportSelectedFrame();
        }
    }
    catch (error) {
        post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
};
async function backendUrl() {
    const value = await figma.clientStorage.getAsync('backendUrl');
    return typeof value === 'string' && value.length > 0 ? value : 'http://localhost:10000';
}
async function dashboardToken() {
    const value = await figma.clientStorage.getAsync('dashboardToken');
    return typeof value === 'string' ? value : '';
}
function post(message) {
    figma.ui.postMessage(message);
}
async function createTrmnlFrame() {
    const frame = figma.createFrame();
    frame.name = 'TRMNL 800x480';
    frame.resize(800, 480);
    frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    frame.strokes = [{ type: 'SOLID', color: { r: 0.05, g: 0.05, b: 0.05 } }];
    frame.strokeWeight = 1;
    frame.clipsContent = true;
    frame.setPluginData('trmnl_frame', '800x480');
    await loadInter('Regular');
    const label = figma.createText();
    label.name = 'TRMNL guide label';
    label.setPluginData('trmnl_non_exportable', 'true');
    label.fontName = { family: 'Inter', style: 'Regular' };
    label.characters = 'TRMNL 800x480 e-ink frame';
    label.fontSize = 12;
    label.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }];
    label.x = 12;
    label.y = 8;
    frame.appendChild(label);
    figma.currentPage.appendChild(frame);
    figma.viewport.scrollAndZoomIntoView([frame]);
    figma.currentPage.selection = [frame];
    post({ type: 'status', message: 'Created TRMNL 800x480 frame.' });
}
async function insertText(entity) {
    const parent = selectedFrameOrPage();
    await loadInter('Regular');
    const node = figma.createText();
    node.name = `ha:${entity.entity_id}`;
    node.fontName = { family: 'Inter', style: 'Regular' };
    node.characters = entityLine(entity);
    node.fontSize = 24;
    node.fills = blackFill();
    node.x = 32;
    node.y = 32;
    node.resize(360, 32);
    setBinding(node, entity, 'text');
    setBoundTextMetadata(node, entity.name || entity.entity_id, entityValue(entity));
    parent.appendChild(node);
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    post({ type: 'status', message: `Inserted text for ${entity.entity_id}.` });
}
async function insertCard(entity) {
    const parent = selectedFrameOrPage();
    await Promise.all([loadInter('Regular'), loadInter('Bold')]);
    const card = figma.createFrame();
    card.name = `ha-card:${entity.entity_id}`;
    card.resize(220, 92);
    card.x = 32;
    card.y = 80;
    card.fills = [{ type: 'SOLID', color: { r: 0.97, g: 0.97, b: 0.97 } }];
    card.strokes = blackFill();
    card.strokeWeight = 1;
    card.cornerRadius = 10;
    card.clipsContent = true;
    setBinding(card, entity, 'metric_card');
    const label = figma.createText();
    label.name = `ha-label:${entity.entity_id}`;
    label.fontName = { family: 'Inter', style: 'Regular' };
    label.characters = entity.name || entity.entity_id;
    label.fontSize = 16;
    label.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.3, b: 0.3 } }];
    label.x = 14;
    label.y = 12;
    label.resize(192, 22);
    setBinding(label, entity, 'metric_label');
    const value = figma.createText();
    value.name = `ha-value:${entity.entity_id}`;
    value.fontName = { family: 'Inter', style: 'Bold' };
    value.characters = entityValue(entity);
    value.fontSize = 34;
    value.fills = blackFill();
    value.x = 14;
    value.y = 42;
    value.resize(192, 42);
    setBinding(value, entity, 'metric_value');
    card.appendChild(label);
    card.appendChild(value);
    parent.appendChild(card);
    figma.currentPage.selection = [card];
    figma.viewport.scrollAndZoomIntoView([card]);
    post({ type: 'status', message: `Inserted card for ${entity.entity_id}.` });
}
async function refreshSelected(entities) {
    const byId = new Map(entities.map(entity => [entity.entity_id, entity]));
    await Promise.all([loadInter('Regular'), loadInter('Bold')]);
    let updated = 0;
    for (const node of figma.currentPage.selection) {
        for (const bound of boundNodes(node)) {
            const binding = readBinding(bound);
            if (!binding)
                continue;
            const entity = byId.get(binding.entity_id);
            if (!entity)
                continue;
            if (bound.type === 'TEXT') {
                bound.setPluginData('unit', entity.unit ?? '');
                if (binding.binding_type === 'metric_value')
                    bound.characters = entityValue(entity);
                else if (binding.binding_type === 'metric_label')
                    continue;
                else if (binding.binding_type === 'text') {
                    const value = entityValue(entity);
                    const label = boundTextLabel(bound, entity.entity_id, value);
                    bound.characters = `${label}: ${value}`;
                    setBoundTextMetadata(bound, label, value);
                }
                else
                    bound.characters = entityValue(entity);
                updated++;
            }
        }
    }
    post({ type: 'status', message: updated ? `Refreshed ${updated} bound text node(s).` : 'No selected bound text nodes matched loaded entities.' });
}
function exportSelectedFrame() {
    const frame = selectedExportFrame();
    const warnings = [];
    const widgets = [];
    traverseVisible(frame, (node) => {
        if (node === frame)
            return;
        if ('getPluginData' in node && node.getPluginData('trmnl_non_exportable') === 'true')
            return;
        const widget = exportNode(node, frame, warnings);
        if (widget)
            widgets.push(widget);
    });
    post({ type: 'export-result', layout: { width: 800, height: 480, widgets }, warnings });
}
function selectedFrameOrPage() {
    const selected = figma.currentPage.selection[0];
    if (selected?.type === 'FRAME')
        return selected;
    if (selected)
        return containingFrame(selected) ?? figma.currentPage;
    return figma.currentPage;
}
function selectedExportFrame() {
    const selection = figma.currentPage.selection;
    if (selection.length !== 1)
        throw new Error('Select exactly one TRMNL frame or one bound node inside a frame before exporting.');
    const selected = selection[0];
    const frame = selected.type === 'FRAME' ? selected : containingFrame(selected);
    if (!frame)
        throw new Error('Selected content must be inside a frame.');
    if (Math.round(frame.width) !== 800 || Math.round(frame.height) !== 480)
        throw new Error('Export frame must be 800x480.');
    return frame;
}
function containingFrame(node) {
    let parent = node.parent;
    while (parent) {
        if (parent.type === 'FRAME' && Math.round(parent.width) === 800 && Math.round(parent.height) === 480)
            return parent;
        parent = parent.parent;
    }
    return null;
}
function exportNode(node, frame, warnings) {
    const binding = readBinding(node);
    if (binding?.widget_type === 'metric_label' || binding?.widget_type === 'metric_value')
        return null;
    const bounds = relativeBounds(node, frame);
    if (!bounds) {
        warnings.push(`${node.name}: skipped because bounds could not be read.`);
        return null;
    }
    if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 800 || bounds.y + bounds.height > 480) {
        warnings.push(`${node.name}: skipped because it is outside the 800x480 frame.`);
        return null;
    }
    if (binding?.widget_type === 'metric_card') {
        return { type: 'metric_card', entity: binding.entity_id, unit: binding.unit, label: cardLabel(node, binding.entity_id), ...bounds, fontSize: largestChildFontSize(node) ?? 30 };
    }
    if (node.type === 'TEXT') {
        return {
            type: 'text',
            entity: binding?.entity_id,
            unit: binding?.unit,
            label: binding ? textLabel(node, binding.entity_id) : undefined,
            staticText: binding ? undefined : node.characters,
            fontSize: typeof node.fontSize === 'number' ? node.fontSize : undefined,
            align: alignFor(node),
            weight: textWeight(node),
            ...bounds
        };
    }
    if (binding)
        warnings.push(`${node.name}: skipped bound node with unsupported export type.`);
    return null;
}
function traverse(node, visit) {
    visit(node);
    if ('children' in node)
        for (const child of node.children)
            traverse(child, visit);
}
function traverseVisible(node, visit) {
    if ('visible' in node && !node.visible)
        return;
    visit(node);
    if ('children' in node)
        for (const child of node.children)
            traverseVisible(child, visit);
}
function boundNodes(node) {
    const nodes = [];
    traverse(node, (entry) => { if ('getPluginData' in entry && readBinding(entry))
        nodes.push(entry); });
    return nodes;
}
function relativeBounds(node, frame) {
    const absolute = node.absoluteBoundingBox;
    const frameBounds = frame.absoluteBoundingBox;
    if (!absolute || !frameBounds)
        return null;
    return {
        x: Math.round(absolute.x - frameBounds.x),
        y: Math.round(absolute.y - frameBounds.y),
        width: Math.round(absolute.width),
        height: Math.round(absolute.height)
    };
}
function setBinding(node, entity, bindingType) {
    node.setPluginData('entity_id', entity.entity_id);
    node.setPluginData('binding_type', bindingType);
    node.setPluginData('widget_type', bindingType);
    node.setPluginData('unit', entity.unit ?? '');
}
function setBoundTextMetadata(node, label, value) {
    node.setPluginData('bound_text_label', label);
    node.setPluginData('bound_text_value', value);
}
function readBinding(node) {
    if (!('getPluginData' in node))
        return null;
    const entityId = node.getPluginData('entity_id');
    if (!entityId)
        return null;
    return {
        entity_id: entityId,
        binding_type: node.getPluginData('binding_type'),
        widget_type: node.getPluginData('widget_type'),
        unit: node.getPluginData('unit') || null
    };
}
function cardLabel(node, fallback) {
    if ('children' in node) {
        const label = node.children.find(child => child.type === 'TEXT' && child.name.startsWith('ha-label:'));
        if (label?.type === 'TEXT')
            return label.characters;
    }
    return fallback;
}
function textLabel(node, fallback) {
    const label = boundTextLabel(node, fallback);
    return label || fallback;
}
function boundTextLabel(node, fallback, currentValue) {
    const stored = node.getPluginData('bound_text_label');
    const storedValue = node.getPluginData('bound_text_value');
    const edited = boundTextLabelFromSuffix(node.characters, storedValue || currentValue);
    if (edited)
        return edited;
    if (stored)
        return stored;
    node.setPluginData('bound_text_label', fallback);
    return fallback;
}
function boundTextLabelFromSuffix(current, value) {
    if (!value)
        return '';
    const suffix = `: ${value}`;
    if (!current.endsWith(suffix))
        return '';
    return current.slice(0, -suffix.length).trim();
}
function largestChildFontSize(node) {
    if (!('children' in node))
        return undefined;
    const sizes = node.children.flatMap(child => child.type === 'TEXT' && typeof child.fontSize === 'number' ? [child.fontSize] : []);
    return sizes.length ? Math.max(...sizes) : undefined;
}
function alignFor(node) {
    if (node.textAlignHorizontal === 'CENTER')
        return 'center';
    if (node.textAlignHorizontal === 'RIGHT')
        return 'right';
    if (node.textAlignHorizontal === 'LEFT')
        return 'left';
    return undefined;
}
function textWeight(node) {
    if (typeof node.fontName !== 'object')
        return undefined;
    return /bold|black|heavy|semibold/i.test(node.fontName.style) ? 700 : 400;
}
async function loadInter(style) {
    try {
        await figma.loadFontAsync({ family: 'Inter', style });
    }
    catch {
        throw new Error(`Could not load Inter ${style}. Install or enable Inter in Figma, then retry.`);
    }
}
function entityLine(entity) {
    return `${entity.name || entity.entity_id}: ${entityValue(entity)}`;
}
function entityValue(entity) {
    return `${entity.state}${entity.unit ?? ''}`;
}
function blackFill() {
    return [{ type: 'SOLID', color: { r: 0.05, g: 0.05, b: 0.05 } }];
}
