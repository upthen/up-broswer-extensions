import type { JsonValue } from '../json/value'

export type PrimitiveKind = 'string' | 'integer' | 'number' | 'boolean' | 'unknown'

export interface SchemaField {
  key: string
  schema: Schema
  /** 在部分样本里缺失 */
  optional: boolean
}

export interface Schema {
  /** 标量类型并集；对象/数组类型单独放在下面两个字段 */
  primitives: PrimitiveKind[]
  nullable: boolean
  objectFields?: SchemaField[]
  arrayItems?: Schema
}

export function emptySchema(): Schema {
  return { primitives: [], nullable: false }
}

export function inferSchema(value: JsonValue): Schema {
  if (value === null) return { primitives: [], nullable: true }
  if (Array.isArray(value)) {
    const items = value.length ? value.map(inferSchema).reduce(mergeSchema) : { primitives: ['unknown'] as PrimitiveKind[], nullable: false }
    return { primitives: [], nullable: false, arrayItems: items }
  }
  switch (typeof value) {
    case 'string':
      return { primitives: ['string'], nullable: false }
    case 'number':
      return { primitives: [Number.isInteger(value) ? 'integer' : 'number'], nullable: false }
    case 'boolean':
      return { primitives: ['boolean'], nullable: false }
    case 'object': {
      const keys = Object.keys(value)
      return {
        primitives: [],
        nullable: false,
        objectFields: keys.map((key) => ({ key, schema: inferSchema(value[key]), optional: false })),
      }
    }
    default:
      return { primitives: ['unknown'], nullable: false }
  }
}

/** 合并两个结构（用于数组元素、多份样本） */
export function mergeSchema(a: Schema, b: Schema): Schema {
  let primitives = [...new Set([...a.primitives, ...b.primitives])]
  // integer 与 number 同时出现时归一为 number
  if (primitives.includes('number') && primitives.includes('integer')) {
    primitives = primitives.filter((p) => p !== 'integer')
  }
  // 固定顺序，保证同类输入永远生成同样的代码
  const order: PrimitiveKind[] = ['string', 'integer', 'number', 'boolean', 'unknown']
  primitives = order.filter((kind) => primitives.includes(kind))
  const merged: Schema = {
    primitives,
    nullable: a.nullable || b.nullable,
  }

  if (a.objectFields || b.objectFields) {
    const left = a.objectFields ?? []
    const right = b.objectFields ?? []
    const keys: string[] = []
    for (const f of left) if (!keys.includes(f.key)) keys.push(f.key)
    for (const f of right) if (!keys.includes(f.key)) keys.push(f.key)
    merged.objectFields = keys.map((key) => {
      const la = left.find((f) => f.key === key)
      const lb = right.find((f) => f.key === key)
      return {
        key,
        schema: la && lb ? mergeSchema(la.schema, lb.schema) : (la ?? lb)!.schema,
        optional: !la || !lb || la.optional || lb.optional,
      }
    })
  }

  if (a.arrayItems || b.arrayItems) {
    merged.arrayItems = a.arrayItems && b.arrayItems ? mergeSchema(a.arrayItems, b.arrayItems) : (a.arrayItems ?? b.arrayItems)!
  }
  return merged
}

/** 统计信息，UI 里展示「推断出 N 个类型」 */
export function countObjectSchemas(schema: Schema): number {
  let count = schema.objectFields ? 1 : 0
  for (const field of schema.objectFields ?? []) count += countObjectSchemas(field.schema)
  if (schema.arrayItems) count += countObjectSchemas(schema.arrayItems)
  return count
}
