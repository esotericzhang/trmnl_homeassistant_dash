export type FigmaEntity = {
  entity_id: string
  name: string
  state: string
  unit?: string | null
  domain?: string | null
  device_class?: string | null
}

export type ExportedWidget = {
  type: 'text' | 'metric_card'
  entity?: string
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

export type ExportedLayout = {
  width: 800
  height: 480
  widgets: ExportedWidget[]
}

export type PluginMessage =
  | { type: 'ready' }
  | { type: 'save-backend-url'; url: string }
  | { type: 'create-frame' }
  | { type: 'insert-text'; entity: FigmaEntity }
  | { type: 'insert-card'; entity: FigmaEntity }
  | { type: 'refresh-selected'; entities: FigmaEntity[] }
  | { type: 'export-selected' }

export type UiMessage =
  | { type: 'stored-backend-url'; url: string }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'export-result'; layout: ExportedLayout; warnings: string[] }
