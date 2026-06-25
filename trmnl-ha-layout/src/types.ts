export type Align = 'left' | 'center' | 'right'

export interface FrameConfig {
  width: number
  height: number
  background: string
  foreground: string
  fontFamily: string
}

export interface LayoutConfig {
  frame: FrameConfig
  data: { entities: Record<string, string> }
  items: LayoutItem[]
}

export type LayoutItem = TextItem | MetricItem | ForecastItem | LineItem

export interface BaseItem {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  fontSize?: number
  align?: Align
  weight?: number | string
}

export interface TextItem extends BaseItem {
  type: 'text'
  text: string
}

export interface MetricItem extends BaseItem {
  type: 'metric'
  label: string
  value: string
}

export interface ForecastItem extends BaseItem {
  type: 'forecast'
  source: string
  maxItems?: number
  rowHeight?: number
  timeX?: number
  tempX?: number
  precipX?: number
  conditionX?: number
  conditionFontSize?: number
  timeWeight?: number | string
  tempWeight?: number | string
  precipWeight?: number | string
  conditionWeight?: number | string
  rowDivider?: boolean
  dividerInset?: number
  rowPaddingY?: number
}

export interface LineItem extends BaseItem {
  type: 'line'
}

export interface HassState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed?: string
  last_updated?: string
}

export type HassStateMap = Record<string, HassState>

export interface RenderData {
  values: Record<string, string | number | null | undefined>
  states: HassStateMap
}
