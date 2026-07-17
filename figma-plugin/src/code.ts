type FigmaEntity = {
  entity_id: string
  name: string
  state: string
  unit?: string | null
  domain?: string | null
  device_class?: string | null
  values?: Array<{ path: string; label: string; value: string | number | boolean | null }>
  value_path?: string
  format?: '' | 'minutes' | 'time' | 'date'
}

type ExportedWidget = {
  type: 'text' | 'metric_card'
  entity?: string
  unit?: string | null
  valuePath?: string
  format?: string
  label?: string
  x: number
  y: number
  width: number
  height: number
  fontSize?: number
  align?: 'left' | 'center' | 'right'
  staticText?: string
  weight?: number | string
}

type ExportedLayout = {
  width: 800
  height: 480
  widgets: ExportedWidget[]
}

type FrameStyle = {
  background: string
  foreground: string
  fontFamily: string
}

type PluginMessage =
  | { type: 'ready' }
  | { type: 'save-backend-url'; url: string }
  | { type: 'save-dashboard-token'; token: string }
  | { type: 'create-frame'; frame: FrameStyle }
  | { type: 'set-frame-style'; frame: FrameStyle }
  | { type: 'insert-text'; entity: FigmaEntity }
  | { type: 'insert-card'; entity: FigmaEntity }
  | { type: 'refresh-selected'; entities: FigmaEntity[] }
  | { type: 'export-selected'; requestId: number }

type UiMessage =
  | { type: 'stored-backend-url'; url: string }
  | { type: 'stored-dashboard-token'; token: string }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'export-result'; requestId: number; layout: ExportedLayout; warnings: string[] }

type BoundNode = SceneNode & PluginDataMixin
type Bounds = { x: number; y: number; width: number; height: number }

const METRIC_CARD = {
  fill: { r: 0.97, g: 0.97, b: 0.97 },
  foreground: { r: 0.067, g: 0.067, b: 0.067 },
  muted: { r: 0.333, g: 0.333, b: 0.333 },
  cornerRadius: 10,
  label: { x: 16, y: 14, fontSize: 18, height: 22 },
  value: { x: 16, y: 46, fontSize: 30 }
} as const

const MAX_METRIC_LABEL_LENGTH = 256
const MAX_STATIC_TEXT_LENGTH = 4096
let backendFrameStyle: FrameStyle | null = null

figma.showUI(__html__, { width: 420, height: 640, themeColors: true })

figma.ui.onmessage = async (message: PluginMessage) => {
  try {
    if (message.type === 'ready') {
      post({ type: 'stored-backend-url', url: await backendUrl() })
      post({ type: 'stored-dashboard-token', token: await dashboardToken() })
    } else if (message.type === 'save-backend-url') {
      await figma.clientStorage.setAsync('backendUrl', message.url || 'http://localhost:10000')
      post({ type: 'status', message: `Saved backend URL: ${message.url || 'http://localhost:10000'}` })
    } else if (message.type === 'save-dashboard-token') {
      await figma.clientStorage.setAsync('dashboardToken', message.token)
      post({ type: 'status', message: message.token ? 'Saved dashboard token for protected bridge calls.' : 'Cleared dashboard token.' })
    } else if (message.type === 'create-frame') {
      backendFrameStyle = message.frame
      await createTrmnlFrame(message.frame)
    } else if (message.type === 'set-frame-style') {
      backendFrameStyle = message.frame
    } else if (message.type === 'insert-text') {
      await insertText(message.entity)
    } else if (message.type === 'insert-card') {
      await insertCard(message.entity)
    } else if (message.type === 'refresh-selected') {
      await refreshSelected(message.entities)
    } else if (message.type === 'export-selected') {
      exportSelectedFrame(message.requestId)
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

async function backendUrl(): Promise<string> {
  const value = await figma.clientStorage.getAsync('backendUrl')
  return typeof value === 'string' && value.length > 0 ? value : 'http://localhost:10000'
}

async function dashboardToken(): Promise<string> {
  const value = await figma.clientStorage.getAsync('dashboardToken')
  return typeof value === 'string' ? value : ''
}

function post(message: UiMessage): void {
  figma.ui.postMessage(message)
}

async function createTrmnlFrame(style: FrameStyle): Promise<void> {
  const frame = figma.createFrame()
  frame.name = 'TRMNL 800x480'
  frame.resize(800, 480)
  frame.fills = [{ type: 'SOLID', color: parseHexColor(style.background) }]
  frame.strokes = []
  frame.clipsContent = true
  frame.setPluginData('trmnl_frame', '800x480')

  await loadBackendFont('Regular')
  const label = figma.createText()
  label.name = 'TRMNL guide label'
  label.setPluginData('trmnl_non_exportable', 'true')
  label.fontName = { family: backendFontFamily(), style: 'Regular' }
  label.characters = 'TRMNL 800x480 e-ink frame'
  label.fontSize = 12
  label.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }]
  label.x = 12
  label.y = 8
  frame.appendChild(label)

  figma.currentPage.appendChild(frame)
  figma.viewport.scrollAndZoomIntoView([frame])
  figma.currentPage.selection = [frame]
  post({ type: 'status', message: 'Created TRMNL 800x480 frame.' })
}

async function insertText(entity: FigmaEntity): Promise<void> {
  const parent = selectedTrmnlFrame()
  if (!backendFrameStyle) throw new Error('Load entities before inserting so the backend frame style is known.')
  await loadBackendFont('Regular')
  const node = figma.createText()
  node.name = `ha:${entity.entity_id}`
  node.fontName = { family: backendFontFamily(), style: 'Regular' }
  node.characters = entityLine(entity)
  node.fontSize = 24
  node.fills = foregroundFill()
  node.x = 32
  node.y = 32
  node.resize(360, 32)
  setBinding(node, entity, 'text')
  setBoundTextMetadata(node, entity.name || entity.entity_id, entityValue(entity))
  parent.appendChild(node)
  figma.currentPage.selection = [node]
  figma.viewport.scrollAndZoomIntoView([node])
  post({ type: 'status', message: `Inserted text for ${entity.entity_id}.` })
}

async function insertCard(entity: FigmaEntity): Promise<void> {
  const parent = selectedTrmnlFrame()
  if (!backendFrameStyle) throw new Error('Load entities before inserting so the backend frame style is known.')
  await Promise.all([loadBackendFont('Regular'), loadBackendFont('Bold')])
  const card = figma.createFrame()
  card.name = `ha-card:${entity.entity_id}`
  card.resize(220, 92)
  card.x = 32
  card.y = 80
  card.fills = [{ type: 'SOLID', color: METRIC_CARD.fill }]
  card.strokes = [{ type: 'SOLID', color: METRIC_CARD.foreground }]
  card.strokeWeight = 1
  card.cornerRadius = METRIC_CARD.cornerRadius
  card.clipsContent = true
  setBinding(card, entity, 'metric_card')

  const label = figma.createText()
  label.name = `ha-label:${entity.entity_id}`
  label.fontName = { family: backendFontFamily(), style: 'Regular' }
  label.characters = entity.name || entity.entity_id
  label.fontSize = METRIC_CARD.label.fontSize
  label.fills = [{ type: 'SOLID', color: METRIC_CARD.muted }]
  label.x = METRIC_CARD.label.x
  label.y = METRIC_CARD.label.y
  label.resize(card.width - METRIC_CARD.label.x * 2, METRIC_CARD.label.height)
  label.constraints = { horizontal: 'STRETCH', vertical: 'MIN' }
  setBinding(label, entity, 'metric_label')

  const value = figma.createText()
  value.name = `ha-value:${entity.entity_id}`
  value.fontName = { family: backendFontFamily(), style: 'Bold' }
  value.characters = entityValue(entity)
  value.fontSize = METRIC_CARD.value.fontSize
  value.fills = foregroundFill()
  value.x = METRIC_CARD.value.x
  value.y = METRIC_CARD.value.y
  value.resize(card.width - METRIC_CARD.value.x * 2, Math.max(card.height - METRIC_CARD.value.y, 1))
  value.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' }
  setBinding(value, entity, 'metric_value')

  card.appendChild(label)
  card.appendChild(value)
  parent.appendChild(card)
  figma.currentPage.selection = [card]
  figma.viewport.scrollAndZoomIntoView([card])
  post({ type: 'status', message: `Inserted card for ${entity.entity_id}.` })
}

async function refreshSelected(entities: FigmaEntity[]): Promise<void> {
  const byId = new Map(entities.map(entity => [entity.entity_id, entity]))
  let updated = 0
  for (const node of figma.currentPage.selection) {
    for (const bound of boundNodes(node)) {
      const binding = readBinding(bound)
      if (!binding) continue
      const entity = byId.get(binding.entity_id)
      if (!entity) continue
      bound.setPluginData('unit', binding.unit ?? '')
      if (bound.type === 'TEXT') {
        await loadTextNodeFonts(bound)
        if (binding.binding_type === 'metric_value') bound.characters = entityValue(entityForBinding(entity, binding))
        else if (binding.binding_type === 'metric_label') continue
        else if (binding.binding_type === 'text') {
          const configured = entityForBinding(entity, binding)
          const value = entityValue(configured)
          const label = boundTextLabel(bound, entity.entity_id, value)
          bound.characters = `${label}: ${value}`
          setBoundTextMetadata(bound, label, value)
        } else bound.characters = entityValue(entityForBinding(entity, binding))
        updated++
      }
    }
  }
  post({ type: 'status', message: updated ? `Refreshed ${updated} bound text node(s).` : 'No selected bound text nodes matched loaded entities.' })
}

function exportSelectedFrame(requestId: number): void {
  const frame = selectedExportFrame()
  const warnings: string[] = []
  const widgets: ExportedWidget[] = []
  if (hasUnrepresentableTransformInAncestorChain(frame)) throw new Error('Export frame or one of its ancestors cannot be rotated, skewed, scaled, or flipped.')
  if (!backendFrameStyle) throw new Error('Load entities before exporting so the backend frame style can be validated.')
  if (!hasRepresentableBlendModeToPage(frame)) throw new Error('Export frame or one of its ancestors has a blend mode that cannot be represented.')
  if (!frameMatchesBackendStyle(frame, backendFrameStyle)) throw new Error('Export frame background does not match the preserved backend frame style.')
  const frameState = effectiveFrameState(frame)
  if (!frameState.visible) throw new Error('Export frame or one of its ancestors is hidden.')
  if (frameState.opacity < 0.999) throw new Error('Export frame or one of its ancestors has opacity that cannot be represented.')
  const frameBounds = frame.absoluteBoundingBox
  if (!frameBounds) throw new Error('Export frame bounds could not be read.')
  const clip = ancestorClipBounds(frame, frameBounds)
  if (!clip) throw new Error('Export frame is fully clipped by an ancestor.')
  for (const child of frame.children) exportTree(child, frame, clip, widgets, warnings)
  post({ type: 'export-result', requestId, layout: { width: 800, height: 480, widgets }, warnings })
}

function selectedTrmnlFrame(): FrameNode {
  const selected = figma.currentPage.selection[0]
  if (!selected) throw new Error('Select an 800x480 TRMNL frame or a node inside one before inserting.')
  if (selected.type === 'FRAME' && isTrmnlFrame(selected)) return selected
  const frame = containingFrame(selected)
  if (frame) return frame
  throw new Error('Selected content must be inside an 800x480 TRMNL frame.')
}

function selectedExportFrame(): FrameNode {
  const selection = figma.currentPage.selection
  if (selection.length !== 1) throw new Error('Select exactly one TRMNL frame or one bound node inside a frame before exporting.')
  const selected = selection[0]
  const frame = selected.type === 'FRAME' && isTrmnlFrame(selected) ? selected : containingFrame(selected)
  if (!frame) throw new Error('Selected content must be inside a frame.')
  if (!isTrmnlFrame(frame)) throw new Error('Export frame must be 800x480.')
  return frame
}

function isTrmnlFrame(node: FrameNode): boolean {
  const epsilon = 0.001
  return Math.abs(node.width - 800) < epsilon && Math.abs(node.height - 480) < epsilon
}

function containingFrame(node: BaseNode): FrameNode | null {
  let parent = node.parent
  while (parent) {
    if (parent.type === 'FRAME' && isTrmnlFrame(parent)) return parent
    parent = parent.parent
  }
  return null
}

function exportNode(node: SceneNode, frame: FrameNode, warnings: string[]): ExportedWidget | null {
  const binding = readBinding(node)
  if (binding?.widget_type === 'metric_label' || binding?.widget_type === 'metric_value') return null
  if (hasUnrepresentableTransformToFrame(node, frame)) {
    warnings.push(`${node.name}: skipped because rotated, skewed, scaled, or flipped content cannot be exported.`)
    return null
  }
  if (!hasRepresentableBlendModeToFrame(node, frame)) {
    warnings.push(`${node.name}: skipped because its blend mode or an ancestor blend mode cannot be represented.`)
    return null
  }
  const bounds = relativeBounds(node, frame)
  if (!bounds) {
    warnings.push(`${node.name}: skipped because bounds could not be read.`)
    return null
  }
  if (bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0
    || bounds.x + bounds.width > 800 || bounds.y + bounds.height > 480) {
    warnings.push(`${node.name}: skipped because its rounded bounds are not positive and inside the 800x480 frame.`)
    return null
  }
  if (binding?.widget_type === 'metric_card') {
    const parts = metricCardParts(node, warnings)
    if (!parts) {
      warnings.push(`${node.name}: skipped because it differs from the supported metric-card template.`)
      return null
    }
    const valueBinding = readBinding(parts.value)
    if (!valueBinding || !sameValueBinding(binding, valueBinding)) {
      warnings.push(`${node.name}: skipped because its value binding differs from the metric card binding.`)
      return null
    }
    if (parts.label.characters.length > MAX_METRIC_LABEL_LENGTH) {
      warnings.push(`${node.name}: skipped because its label exceeds ${MAX_METRIC_LABEL_LENGTH} characters.`)
      return null
    }
    return { type: 'metric_card', entity: binding.entity_id, unit: binding.unit, valuePath: binding.value_path, format: binding.format, label: parts.label.characters, ...bounds, fontSize: typeof parts.value.fontSize === 'number' ? parts.value.fontSize : 30 }
  }
  if (node.type === 'TEXT') {
    if (!hasRepresentableTypography(node, warnings)) return null
    if (!hasRepresentableTextPaint(node, warnings)) return null
    if (hasVisiblePaint(node.strokes) || node.effects.some(effect => effect.visible !== false)) {
      warnings.push(`${node.name}: skipped because text strokes or effects cannot be represented.`)
      return null
    }
    if (!binding && node.characters.length > MAX_STATIC_TEXT_LENGTH) {
      warnings.push(`${node.name}: skipped because static text exceeds ${MAX_STATIC_TEXT_LENGTH} characters.`)
      return null
    }
    const label = binding ? textLabel(node, binding.entity_id) : undefined
    if (label === null) {
      warnings.push(`${node.name}: skipped because its bound label and value changed; use Refresh Selected before exporting.`)
      return null
    }
    return {
      type: 'text',
      entity: binding?.entity_id,
      unit: binding?.unit,
      valuePath: binding?.value_path,
      format: binding?.format,
      label,
      staticText: binding ? undefined : node.characters,
      fontSize: typeof node.fontSize === 'number' ? node.fontSize : undefined,
      align: alignFor(node),
      weight: textWeight(node),
      ...bounds
    }
  }
  return null
}

function exportTree(node: SceneNode, frame: FrameNode, clip: Bounds, widgets: ExportedWidget[], warnings: string[], ancestorOpacity = 1): number {
  if ('visible' in node && !node.visible) return 0
  if ('getPluginData' in node && node.getPluginData('trmnl_non_exportable') === 'true') return 0

  const effectiveOpacity = ancestorOpacity * ('opacity' in node ? node.opacity : 1)
  if (effectiveOpacity <= 0.001) return 0
  if (effectiveOpacity < 0.999) warnings.push(`${node.name}: opacity cannot be represented and will export as fully opaque.`)

  const binding = readBinding(node)
  if (binding?.widget_type === 'metric_label' || binding?.widget_type === 'metric_value') return 0

  if (node.type === 'TEXT' || binding?.widget_type === 'metric_card') {
    if (isClipped(node, clip)) {
      warnings.push(`${node.name}: skipped because ancestor clipping cannot be represented.`)
      return 0
    }
    const widget = exportNode(node, frame, warnings)
    if (!widget) return 0
    widgets.push(widget)
    return 1
  }

  let exportedDescendants = 0
  if ('children' in node) {
    const childClip = 'clipsContent' in node && node.clipsContent && node.absoluteBoundingBox
      ? intersectBounds(clip, node.absoluteBoundingBox)
      : clip
    if (childClip) {
      for (const child of node.children) exportedDescendants += exportTree(child, frame, childClip, widgets, warnings, effectiveOpacity)
    } else if (node.children.some(hasExportableContent)) {
      warnings.push(`${node.name}: skipped exportable content because ancestor clipping excludes it.`)
    }
  }

  if (exportedDescendants > 0 && hasUnsupportedContainerStyle(node)) {
    warnings.push(`${node.name}: container fills, strokes, or effects cannot be represented and will be omitted.`)
  } else if (exportedDescendants === 0 && (hasUnsupportedContainerStyle(node) || isUnsupportedVisualNode(node))) {
    warnings.push(`${node.name}: skipped visible ${node.type.toLowerCase()} because this export type is unsupported.`)
  }
  return exportedDescendants
}

function hasExportableContent(node: SceneNode): boolean {
  if ('visible' in node && !node.visible) return false
  if ('opacity' in node && node.opacity <= 0.001) return false
  if ('getPluginData' in node && node.getPluginData('trmnl_non_exportable') === 'true') return false
  const binding = readBinding(node)
  if (node.type === 'TEXT' || binding?.widget_type === 'metric_card') return true
  if (binding?.widget_type === 'metric_label' || binding?.widget_type === 'metric_value') return false
  return 'children' in node && node.children.some(hasExportableContent)
}

function hasUnsupportedContainerStyle(node: SceneNode): boolean {
  if (!('children' in node) || readBinding(node)?.widget_type === 'metric_card') return false
  return hasVisiblePaint('fills' in node ? node.fills : [])
    || hasVisiblePaint('strokes' in node ? node.strokes : [])
    || ('effects' in node && node.effects.some(effect => effect.visible !== false))
}

function hasVisiblePaint(paints: readonly Paint[] | PluginAPI['mixed']): boolean {
  return paints !== figma.mixed && paints.some(paint => paint.visible !== false && (paint.opacity ?? 1) > 0.001)
}

function hasRepresentableBlendModeToFrame(node: SceneNode, frame: FrameNode): boolean {
  let current: BaseNode | null = node
  while (current && current !== frame) {
    if ('blendMode' in current && !isRepresentableNodeBlendMode(current.blendMode)) return false
    current = current.parent
  }
  return current === frame
}

function hasRepresentableBlendModeToPage(node: SceneNode): boolean {
  let current: BaseNode | null = node
  while (current && current.type !== 'PAGE') {
    if ('blendMode' in current && !isRepresentableNodeBlendMode(current.blendMode)) return false
    current = current.parent
  }
  return true
}

function isRepresentableNodeBlendMode(mode: BlendMode): boolean {
  return mode === 'NORMAL' || mode === 'PASS_THROUGH'
}

function isRepresentablePaintBlendMode(paint: Paint): boolean {
  return !('blendMode' in paint) || paint.blendMode === 'NORMAL'
}

function isClipped(node: SceneNode, clip: Bounds): boolean {
  const bounds = node.absoluteBoundingBox
  if (!bounds) return false
  const epsilon = 0.001
  return bounds.x < clip.x - epsilon
    || bounds.y < clip.y - epsilon
    || bounds.x + bounds.width > clip.x + clip.width + epsilon
    || bounds.y + bounds.height > clip.y + clip.height + epsilon
}

function intersectBounds(a: Bounds, b: Bounds): Bounds | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

function ancestorClipBounds(node: SceneNode, initial: Bounds): Bounds | null {
  let clip: Bounds | null = initial
  let parent = node.parent
  while (parent && parent.type !== 'PAGE') {
    if ('clipsContent' in parent && parent.clipsContent && parent.absoluteBoundingBox) {
      clip = clip && intersectBounds(clip, parent.absoluteBoundingBox)
      if (!clip) return null
    }
    parent = parent.parent
  }
  return clip
}

function effectiveFrameState(node: SceneNode): { visible: boolean; opacity: number } {
  let visible = true
  let opacity = 1
  let current: BaseNode | null = node
  while (current && current.type !== 'PAGE') {
    if ('visible' in current && !current.visible) visible = false
    if ('opacity' in current) opacity *= current.opacity
    current = current.parent
  }
  return { visible, opacity }
}

function isUnsupportedVisualNode(node: SceneNode): boolean {
  if (readBinding(node)) return true
  return !('children' in node) || node.type === 'BOOLEAN_OPERATION'
}

function traverse(node: SceneNode, visit: (node: SceneNode) => void): void {
  visit(node)
  if ('children' in node) for (const child of node.children) traverse(child, visit)
}

function boundNodes(node: SceneNode): BoundNode[] {
  const nodes: BoundNode[] = []
  traverse(node, (entry) => { if ('getPluginData' in entry && readBinding(entry)) nodes.push(entry as BoundNode) })
  return nodes
}

function relativeBounds(node: SceneNode, frame: FrameNode): Omit<ExportedWidget, 'type'> | null {
  const absolute = node.absoluteBoundingBox
  const frameBounds = frame.absoluteBoundingBox
  if (!absolute || !frameBounds) return null
  return {
    x: Math.round(absolute.x - frameBounds.x),
    y: Math.round(absolute.y - frameBounds.y),
    width: Math.round(absolute.width),
    height: Math.round(absolute.height)
  }
}

function hasUnrepresentableTransformToFrame(node: SceneNode, frame: FrameNode): boolean {
  let current: BaseNode | null = node
  while (current && current !== frame) {
    if ('relativeTransform' in current && hasUnrepresentableTransform(current)) return true
    current = current.parent
  }
  return current !== frame
}

function hasUnrepresentableTransformInAncestorChain(node: SceneNode): boolean {
  let current: BaseNode | null = node
  while (current && current.type !== 'PAGE') {
    if ('relativeTransform' in current && hasUnrepresentableTransform(current)) return true
    current = current.parent
  }
  return false
}

function hasUnrepresentableTransform(node: { relativeTransform: Transform }): boolean {
  const [[scaleX, skewX], [skewY, scaleY]] = node.relativeTransform
  const epsilon = 0.0001
  return Math.abs(scaleX - 1) > epsilon || Math.abs(scaleY - 1) > epsilon || Math.abs(skewX) > epsilon || Math.abs(skewY) > epsilon
}

function setBinding(node: PluginDataMixin, entity: FigmaEntity, bindingType: string): void {
  node.setPluginData('entity_id', entity.entity_id)
  node.setPluginData('binding_type', bindingType)
  node.setPluginData('widget_type', bindingType)
  node.setPluginData('unit', entity.unit ?? '')
  node.setPluginData('value_path', entity.value_path ?? 'state')
  node.setPluginData('format', entity.format ?? '')
}

function setBoundTextMetadata(node: PluginDataMixin, label: string, value: string): void {
  node.setPluginData('bound_text_label', label)
  node.setPluginData('bound_text_value', value)
}

function readBinding(node: BaseNode): { entity_id: string; binding_type: string; widget_type: string; unit: string | null; value_path: string; format: string } | null {
  if (!('getPluginData' in node)) return null
  const entityId = node.getPluginData('entity_id')
  if (!entityId) return null
  return {
    entity_id: entityId,
    binding_type: node.getPluginData('binding_type'),
    widget_type: node.getPluginData('widget_type'),
    unit: node.getPluginData('unit') || null,
    value_path: node.getPluginData('value_path') || 'state',
    format: node.getPluginData('format') || ''
  }
}

function sameValueBinding(
  left: { entity_id: string; unit: string | null; value_path: string; format: string },
  right: { entity_id: string; unit: string | null; value_path: string; format: string }
): boolean {
  return left.entity_id === right.entity_id
    && left.unit === right.unit
    && left.value_path === right.value_path
    && left.format === right.format
}

function textLabel(node: TextNode, fallback: string): string | null {
  const storedValue = node.getPluginData('bound_text_value')
  if (hasPluginData(node, 'bound_text_value') && boundTextLabelFromSuffix(node.characters, storedValue) === null) return null
  const label = boundTextLabel(node, fallback)
  return label ?? fallback
}

function boundTextLabel(node: TextNode, fallback: string, currentValue?: string): string {
  const stored = node.getPluginData('bound_text_label')
  const storedValue = node.getPluginData('bound_text_value')
  const edited = boundTextLabelFromSuffix(node.characters, hasPluginData(node, 'bound_text_value') ? storedValue : currentValue)
  if (edited !== null) return edited
  if (hasPluginData(node, 'bound_text_label')) return stored
  node.setPluginData('bound_text_label', fallback)
  return fallback
}

function boundTextLabelFromSuffix(current: string, value?: string): string | null {
  if (value === undefined) return null
  const suffix = `: ${value}`
  if (!current.endsWith(suffix)) return null
  return current.slice(0, -suffix.length).trim()
}

function hasPluginData(node: PluginDataMixin, key: string): boolean {
  return node.getPluginDataKeys().includes(key)
}

function metricCardParts(node: SceneNode, warnings: string[]): { label: TextNode; value: TextNode } | null {
  if (!('children' in node) || !node.absoluteBoundingBox) return null
  const relevantChildren = node.children.filter(child => readBinding(child)?.binding_type === 'metric_label' || readBinding(child)?.binding_type === 'metric_value')
  const visibleOtherChildren = node.children.filter(child => !relevantChildren.includes(child) && child.visible && (!('opacity' in child) || child.opacity > 0.001))
  const labels = relevantChildren.filter(child => child.type === 'TEXT' && readBinding(child)?.binding_type === 'metric_label')
  const values = relevantChildren.filter(child => child.type === 'TEXT' && readBinding(child)?.binding_type === 'metric_value')
  if (visibleOtherChildren.length > 0 || relevantChildren.length !== 2 || labels.length !== 1 || values.length !== 1) return null
  const [label] = labels
  const [value] = values
  if (label.type !== 'TEXT' || value.type !== 'TEXT') return null
  if (!hasCanonicalMetricCardStyle(node) || !hasCanonicalMetricPart(label, node, 'label') || !hasCanonicalMetricPart(value, node, 'value')) return null
  for (const part of [label, value]) {
    if (!hasRepresentableTypography(part, warnings)) return null
  }
  const valueFontSize = value.fontSize === figma.mixed ? METRIC_CARD.value.fontSize : value.fontSize
  const placement = metricPlacement(node.height, valueFontSize)
  if ((placement.showLabel && !isVisibleMetricPart(label, node.absoluteBoundingBox)) || !isVisibleMetricPart(value, node.absoluteBoundingBox)) return null
  return { label, value }
}

function hasCanonicalMetricCardStyle(node: SceneNode): boolean {
  if (node.type !== 'FRAME') return false
  return node.opacity === 1
    && node.visible
    && node.clipsContent
    && node.effects.every(effect => effect.visible === false)
    && node.cornerRadius !== figma.mixed
    && close(node.cornerRadius, METRIC_CARD.cornerRadius)
    && node.strokeWeight !== figma.mixed
    && close(node.strokeWeight, 1)
    && node.strokeAlign === 'INSIDE'
    && node.dashPattern.length === 0
    && hasCanonicalSolidPaint(node.fills, METRIC_CARD.fill)
    && hasCanonicalSolidPaint(node.strokes, METRIC_CARD.foreground)
}

function hasCanonicalMetricPart(node: TextNode, card: SceneNode & ChildrenMixin, kind: 'label' | 'value'): boolean {
  const fontSize = kind === 'value' && node.fontSize !== figma.mixed ? node.fontSize : METRIC_CARD.value.fontSize
  const placement = metricPlacement(card.height, fontSize)
  const expected = kind === 'label'
    ? { ...METRIC_CARD.label, y: placement.labelY }
    : { ...METRIC_CARD.value, y: placement.valueY }
  const expectedHeight = kind === 'label' ? METRIC_CARD.label.height : Math.max(card.height - placement.valueY, 1)
  const expectedColor = kind === 'label' ? METRIC_CARD.muted : backendForeground()
  const expectedStyle = kind === 'label' ? 'regular' : 'bold'
  return node.parent === card
    && node.visible === (kind === 'value' || placement.showLabel)
    && node.opacity === 1
    && node.effects.every(effect => effect.visible === false)
    && close(node.x, expected.x)
    && close(node.y, expected.y)
    && close(node.width, card.width - expected.x * 2)
    && close(node.height, expectedHeight)
    && node.fontName !== figma.mixed
    && node.fontName.family === backendFontFamily()
    && node.fontName.style.toLowerCase() === expectedStyle
    && node.fontSize !== figma.mixed
    && (kind === 'value' || close(node.fontSize, expected.fontSize))
    && node.textAlignHorizontal === 'LEFT'
    && node.textAlignVertical === 'TOP'
    && node.textAutoResize === 'NONE'
    && hasCanonicalSolidPaint(node.fills, expectedColor)
    && !hasVisiblePaint(node.strokes)
}

function hasCanonicalSolidPaint(paints: readonly Paint[] | PluginAPI['mixed'], color: RGB): boolean {
  if (paints === figma.mixed) return false
  const visible = paints.filter(paint => paint.visible !== false && (paint.opacity ?? 1) > 0.001)
  return visible.length === 1
    && visible[0].type === 'SOLID'
    && isRepresentablePaintBlendMode(visible[0])
    && (visible[0].opacity ?? 1) === 1
    && close(visible[0].color.r, color.r)
    && close(visible[0].color.g, color.g)
    && close(visible[0].color.b, color.b)
}

function close(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 0.01
}

function hasRepresentableTypography(node: TextNode, warnings: string[]): boolean {
  const mixed: string[] = []
  if (node.fontName === figma.mixed) mixed.push('font name')
  if (node.fontSize === figma.mixed) mixed.push('font size')
  if (mixed.length > 0) {
    warnings.push(`${node.name}: skipped because mixed ${mixed.join(' and ')} cannot be represented.`)
    return false
  }
  if (typeof node.fontName !== 'object') return false
  const style = node.fontName.style.toLowerCase().replace(/[\s-]+/g, '')
  if (node.fontName.family !== backendFontFamily() || !/^(regular|bold|thin|hairline|extralight|ultralight|light|medium|semibold|demibold|extrabold|ultrabold|black|heavy)$/.test(style)) {
    warnings.push(`${node.name}: skipped because font family or style cannot be represented.`)
    return false
  }
  const unsupportedLayout = typeof node.lineHeight === 'symbol'
    || node.lineHeight.unit !== 'AUTO'
    || typeof node.letterSpacing === 'symbol'
    || node.letterSpacing.value !== 0
    || node.paragraphSpacing !== 0
    || node.paragraphIndent !== 0
    || node.textCase !== 'ORIGINAL'
    || node.textDecoration !== 'NONE'
    || node.textAlignHorizontal === 'JUSTIFIED'
    || node.textAlignVertical !== 'TOP'
  if (unsupportedLayout) {
    warnings.push(`${node.name}: skipped because line height, spacing, case, decoration, or vertical alignment cannot be represented.`)
    return false
  }
  return true
}

function isVisibleMetricPart(node: TextNode, cardBounds: Rect): boolean {
  return node.visible && node.opacity > 0.001 && Boolean(node.absoluteBoundingBox) && !isClipped(node, cardBounds)
}

function hasRepresentableTextPaint(node: TextNode, warnings: string[]): boolean {
  if (node.fills === figma.mixed) {
    warnings.push(`${node.name}: skipped because mixed text fills cannot be safely exported.`)
    return false
  }
  const visiblePaints = node.fills.filter(paint => paint.visible !== false && (paint.opacity ?? 1) > 0.001)
  if (visiblePaints.length === 0) {
    warnings.push(`${node.name}: skipped because its text fills are hidden or transparent.`)
    return false
  }
  if (visiblePaints.length !== 1 || visiblePaints[0].type !== 'SOLID') {
    warnings.push(`${node.name}: skipped because multiple, gradient, image, or other non-solid text fills cannot be represented.`)
    return false
  }
  const paint = visiblePaints[0]
  if (!isRepresentablePaintBlendMode(paint)) {
    warnings.push(`${node.name}: skipped because text paint blend mode cannot be represented.`)
    return false
  }
  if ((paint.opacity ?? 1) < 0.999) {
    warnings.push(`${node.name}: skipped because text fill opacity cannot be represented.`)
    return false
  }
  const expected = backendForeground()
  const { r, g, b } = paint.color
  if (!close(r, expected.r) || !close(g, expected.g) || !close(b, expected.b)) {
    warnings.push(`${node.name}: skipped because its text color does not match the supported foreground.`)
    return false
  }
  return true
}

function alignFor(node: TextNode): 'left' | 'center' | 'right' | undefined {
  if (node.textAlignHorizontal === 'CENTER') return 'center'
  if (node.textAlignHorizontal === 'RIGHT') return 'right'
  if (node.textAlignHorizontal === 'LEFT') return 'left'
  return undefined
}

function textWeight(node: TextNode): number | undefined {
  if (typeof node.fontName !== 'object') return undefined
  const style = node.fontName.style.toLowerCase().replace(/[\s-]+/g, '')
  if (/thin|hairline/.test(style)) return 100
  if (/extralight|ultralight/.test(style)) return 200
  if (/light/.test(style)) return 300
  if (/medium/.test(style)) return 500
  if (/semibold|demibold/.test(style)) return 600
  if (/extrabold|ultrabold/.test(style)) return 800
  if (/black|heavy/.test(style)) return 900
  if (/bold/.test(style)) return 700
  return 400
}

async function loadBackendFont(style: 'Regular' | 'Bold'): Promise<void> {
  const family = backendFontFamily()
  try {
    await figma.loadFontAsync({ family, style })
  } catch {
    throw new Error(`Could not load ${family} ${style}. Install or enable the backend frame font in Figma, then retry.`)
  }
}

async function loadTextNodeFonts(node: TextNode): Promise<void> {
  const fonts = node.getRangeAllFontNames(0, node.characters.length)
  if (typeof node.fontName === 'object') fonts.push(node.fontName)
  const uniqueFonts = new Map(fonts.map(font => [`${font.family}\u0000${font.style}`, font]))
  await Promise.all([...uniqueFonts.values()].map(font => figma.loadFontAsync(font)))
}

function entityLine(entity: FigmaEntity): string {
  return `${entity.name || entity.entity_id}: ${entityValue(entity)}`
}

function entityValue(entity: FigmaEntity): string {
  const path = entity.value_path ?? 'state'
  const selectedValue = entity.values?.find(value => value.path === path)
  const selected = selectedValue?.value ?? (path === 'state' ? entity.state : undefined)
  const formatted = formatEntityValue(selected, entity.format)
  const unit = !entity.format && formatted !== '—' ? (entity.unit ?? '') : ''
  return `${formatted}${unit}`
}

function entityForBinding(entity: FigmaEntity, binding: { value_path: string; format: string; unit: string | null }): FigmaEntity {
  return { ...entity, unit: binding.unit ?? undefined, value_path: binding.value_path, format: binding.format as FigmaEntity['format'] }
}

function formatEntityValue(value: unknown, format?: string): string {
  if (value === null || value === undefined || value === 'unknown' || value === 'unavailable') return '—'
  if (format === 'minutes') {
    const minutes = Number(value)
    if (Number.isFinite(minutes)) {
      const hours = Math.floor(minutes / 60)
      return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes % 60}m`
    }
  }
  if (format === 'time' || format === 'date') {
    const input = String(value)
    const date = format === 'date' ? parseCalendarDate(input) ?? parseTimestamp(input) : parseTimestamp(input)
    if (date) {
      return format === 'time'
        ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
        : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
    }
  }
  return String(value ?? '')
}

function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

function parseTimestamp(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] ?? 0)
  const offset = match[7]
  if (!validDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) return null
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function metricPlacement(height: number, valueFontSize: number): { valueY: number; labelY: number; showLabel: boolean } {
  const valueY = Math.max(Math.min(46, height - valueFontSize), 0)
  const labelY = Math.min(14, Math.max(valueY - 22, 0))
  return { valueY, labelY, showLabel: labelY + 18 <= valueY }
}

function frameMatchesBackendStyle(frame: FrameNode, style: FrameStyle): boolean {
  const background = parseHexColor(style.background)
  return hasCanonicalSolidPaint(frame.fills, background)
    && !hasVisiblePaint(frame.strokes)
    && frame.effects.every(effect => effect.visible === false)
}

function backendFontFamily(): string {
  if (!backendFrameStyle) throw new Error('Load entities before editing or exporting so the backend frame font is known.')
  const family = backendFrameStyle.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  if (!family) throw new Error('Backend frame fontFamily does not contain a usable font family.')
  return family
}

function backendForeground(): RGB {
  if (!backendFrameStyle) throw new Error('Load entities before editing or exporting so the backend foreground is known.')
  return parseHexColor(backendFrameStyle.foreground)
}

function parseHexColor(value: string): RGB {
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  if (!match) throw new Error(`Backend frame color ${value} is not a supported six-digit hex color.`)
  return {
    r: parseInt(match[1].slice(0, 2), 16) / 255,
    g: parseInt(match[1].slice(2, 4), 16) / 255,
    b: parseInt(match[1].slice(4, 6), 16) / 255
  }
}

function foregroundFill(): SolidPaint[] {
  return [{ type: 'SOLID', color: backendForeground() }]
}
