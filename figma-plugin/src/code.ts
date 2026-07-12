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

type PluginMessage =
  | { type: 'ready' }
  | { type: 'save-backend-url'; url: string }
  | { type: 'save-dashboard-token'; token: string }
  | { type: 'create-frame' }
  | { type: 'insert-text'; entity: FigmaEntity }
  | { type: 'insert-card'; entity: FigmaEntity }
  | { type: 'refresh-selected'; entities: FigmaEntity[] }
  | { type: 'export-selected' }

type UiMessage =
  | { type: 'stored-backend-url'; url: string }
  | { type: 'stored-dashboard-token'; token: string }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'export-result'; layout: ExportedLayout; warnings: string[] }

type BoundNode = SceneNode & PluginDataMixin
type Bounds = { x: number; y: number; width: number; height: number }

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
      await createTrmnlFrame()
    } else if (message.type === 'insert-text') {
      await insertText(message.entity)
    } else if (message.type === 'insert-card') {
      await insertCard(message.entity)
    } else if (message.type === 'refresh-selected') {
      await refreshSelected(message.entities)
    } else if (message.type === 'export-selected') {
      exportSelectedFrame()
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

async function createTrmnlFrame(): Promise<void> {
  const frame = figma.createFrame()
  frame.name = 'TRMNL 800x480'
  frame.resize(800, 480)
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  frame.strokes = [{ type: 'SOLID', color: { r: 0.05, g: 0.05, b: 0.05 } }]
  frame.strokeWeight = 1
  frame.clipsContent = true
  frame.setPluginData('trmnl_frame', '800x480')

  await loadInter('Regular')
  const label = figma.createText()
  label.name = 'TRMNL guide label'
  label.setPluginData('trmnl_non_exportable', 'true')
  label.fontName = { family: 'Inter', style: 'Regular' }
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
  await loadInter('Regular')
  const node = figma.createText()
  node.name = `ha:${entity.entity_id}`
  node.fontName = { family: 'Inter', style: 'Regular' }
  node.characters = entityLine(entity)
  node.fontSize = 24
  node.fills = blackFill()
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
  await Promise.all([loadInter('Regular'), loadInter('Bold')])
  const card = figma.createFrame()
  card.name = `ha-card:${entity.entity_id}`
  card.resize(220, 92)
  card.x = 32
  card.y = 80
  card.fills = [{ type: 'SOLID', color: { r: 0.97, g: 0.97, b: 0.97 } }]
  card.strokes = blackFill()
  card.strokeWeight = 1
  card.cornerRadius = 10
  card.clipsContent = true
  setBinding(card, entity, 'metric_card')

  const label = figma.createText()
  label.name = `ha-label:${entity.entity_id}`
  label.fontName = { family: 'Inter', style: 'Regular' }
  label.characters = entity.name || entity.entity_id
  label.fontSize = 16
  label.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.3, b: 0.3 } }]
  label.x = 14
  label.y = 12
  label.resize(192, 22)
  setBinding(label, entity, 'metric_label')

  const value = figma.createText()
  value.name = `ha-value:${entity.entity_id}`
  value.fontName = { family: 'Inter', style: 'Bold' }
  value.characters = entityValue(entity)
  value.fontSize = 34
  value.fills = blackFill()
  value.x = 14
  value.y = 42
  value.resize(192, 42)
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
      bound.setPluginData('unit', binding.value_path === 'state' ? (entity.unit ?? '') : '')
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

function exportSelectedFrame(): void {
  const frame = selectedExportFrame()
  const warnings: string[] = []
  const widgets: ExportedWidget[] = []
  if (hasUnrepresentableTransformInAncestorChain(frame)) throw new Error('Export frame or one of its ancestors cannot be rotated, skewed, scaled, or flipped.')
  const frameBounds = frame.absoluteBoundingBox
  if (!frameBounds) throw new Error('Export frame bounds could not be read.')
  for (const child of frame.children) exportTree(child, frame, frameBounds, widgets, warnings)
  post({ type: 'export-result', layout: { width: 800, height: 480, widgets }, warnings })
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
      warnings.push(`${node.name}: skipped because its bound label or value is missing, hidden, transparent, or clipped.`)
      return null
    }
    return { type: 'metric_card', entity: binding.entity_id, unit: binding.unit, valuePath: binding.value_path, format: binding.format, label: parts.label.characters, ...bounds, fontSize: typeof parts.value.fontSize === 'number' ? parts.value.fontSize : 30 }
  }
  if (node.type === 'TEXT') {
    if (!hasRepresentableTypography(node, warnings)) return null
    const paintVisibility = textPaintVisibility(node)
    if (paintVisibility === 'partial') warnings.push(`${node.name}: text fill opacity cannot be represented and will export as fully opaque.`)
    if (paintVisibility !== 'visible' && paintVisibility !== 'partial') {
      warnings.push(`${node.name}: skipped because its text fills are ${paintVisibility === 'mixed' ? 'mixed and cannot be safely exported' : 'hidden or transparent'}.`)
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
  } else if (exportedDescendants === 0 && isUnsupportedVisualNode(node)) {
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

function textLabel(node: TextNode, fallback: string): string | null {
  const storedValue = node.getPluginData('bound_text_value')
  if (storedValue && !boundTextLabelFromSuffix(node.characters, storedValue)) return null
  const label = boundTextLabel(node, fallback)
  return label || fallback
}

function boundTextLabel(node: TextNode, fallback: string, currentValue?: string): string {
  const stored = node.getPluginData('bound_text_label')
  const storedValue = node.getPluginData('bound_text_value')
  const edited = boundTextLabelFromSuffix(node.characters, storedValue || currentValue)
  if (edited) return edited
  if (stored) return stored
  node.setPluginData('bound_text_label', fallback)
  return fallback
}

function boundTextLabelFromSuffix(current: string, value?: string): string {
  if (!value) return ''
  const suffix = `: ${value}`
  if (!current.endsWith(suffix)) return ''
  return current.slice(0, -suffix.length).trim()
}

function metricCardParts(node: SceneNode, warnings: string[]): { label: TextNode; value: TextNode } | null {
  if (!('children' in node) || !node.absoluteBoundingBox) return null
  const label = node.children.find(child => child.type === 'TEXT' && readBinding(child)?.binding_type === 'metric_label')
  const value = node.children.find(child => child.type === 'TEXT' && readBinding(child)?.binding_type === 'metric_value')
  if (label?.type !== 'TEXT' || value?.type !== 'TEXT') return null
  for (const part of [label, value]) {
    if (!hasRepresentableTypography(part, warnings)) return null
    const paintVisibility = textPaintVisibility(part)
    if (paintVisibility === 'mixed') warnings.push(`${part.name}: mixed text fills cannot be safely exported.`)
    if (paintVisibility === 'partial') warnings.push(`${part.name}: text fill opacity cannot be represented and will export as fully opaque.`)
    if (paintVisibility !== 'visible' && paintVisibility !== 'partial') return null
  }
  if (!isVisibleMetricPart(label, node.absoluteBoundingBox) || !isVisibleMetricPart(value, node.absoluteBoundingBox)) return null
  return { label, value }
}

function hasRepresentableTypography(node: TextNode, warnings: string[]): boolean {
  const mixed: string[] = []
  if (node.fontName === figma.mixed) mixed.push('font name')
  if (node.fontSize === figma.mixed) mixed.push('font size')
  if (mixed.length === 0) return true
  warnings.push(`${node.name}: skipped because mixed ${mixed.join(' and ')} cannot be represented.`)
  return false
}

function isVisibleMetricPart(node: TextNode, cardBounds: Rect): boolean {
  return node.visible && node.opacity > 0.001 && Boolean(node.absoluteBoundingBox) && !isClipped(node, cardBounds)
}

function textPaintVisibility(node: TextNode): 'visible' | 'partial' | 'invisible' | 'mixed' {
  if (node.fills === figma.mixed) return 'mixed'
  const visiblePaints = node.fills.filter(paint => paint.visible !== false && (paint.opacity ?? 1) > 0.001)
  if (visiblePaints.length === 0) return 'invisible'
  return visiblePaints.some(paint => (paint.opacity ?? 1) < 0.999) ? 'partial' : 'visible'
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

async function loadInter(style: 'Regular' | 'Bold'): Promise<void> {
  try {
    await figma.loadFontAsync({ family: 'Inter', style })
  } catch {
    throw new Error(`Could not load Inter ${style}. Install or enable Inter in Figma, then retry.`)
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
  const unit = path === 'state' && !entity.format && formatted !== '—' ? (entity.unit ?? '') : ''
  return `${formatted}${unit}`
}

function entityForBinding(entity: FigmaEntity, binding: { value_path: string; format: string }): FigmaEntity {
  return { ...entity, value_path: binding.value_path, format: binding.format as FigmaEntity['format'] }
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
    const date = new Date(String(value))
    if (!Number.isNaN(date.getTime())) {
      return format === 'time'
        ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
        : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
    }
  }
  return String(value ?? '')
}

function blackFill(): SolidPaint[] {
  return [{ type: 'SOLID', color: { r: 0.05, g: 0.05, b: 0.05 } }]
}
