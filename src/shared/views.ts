export type ViewMode = 'text' | 'tree' | 'query' | 'code'

export const VIEWS: { id: ViewMode; label: string; short: string; icon: string; pane: string }[] = [
  { id: 'text', label: 'JSON 格式化', short: '文本', icon: 'braces', pane: '结果' },
  { id: 'tree', label: '树形视图', short: '树形', icon: 'tree', pane: '树形视图' },
  { id: 'query', label: 'JSONPath', short: '查询', icon: 'search', pane: '查询结果' },
  { id: 'code', label: '代码生成', short: '代码', icon: 'code', pane: '类型定义' },
]
