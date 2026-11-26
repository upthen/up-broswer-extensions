/**
 * SPEC v4.1 §8：记事本导入 txt 的纯逻辑。
 * 只处理字节、文件名与导入计划，不碰浏览器扩展 API / DOM / 网络 / 控制台，可完整单测。
 * 设计边界：一个 txt → 一篇新文档；不追加、不覆盖、不改写正文。
 */

/** 单个文件上限 1 MiB：storage.local 默认配额约 10 MB，且每次输入会序列化全库。 */
export const MAX_IMPORT_BYTES = 1024 * 1024
/** 一次最多导入 20 个文件，避免一次写入把配额打满。 */
export const MAX_IMPORT_FILES = 20
/** 文件选择器只收纯文本：`.md` 走编辑器里的粘贴 / 手写，不单独开一个文件入口。 */
export const TXT_ACCEPT = '.txt,text/plain'

export const SKIP_REASON = {
  notTxt: '只支持 .txt 文件',
  tooLarge: '超过 1 MB',
  tooMany: `一次最多 ${MAX_IMPORT_FILES} 个文件`,
  decode: '无法解码',
} as const

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030'

export interface DecodedTextFile {
  text: string
  encoding: TextEncoding
}

export interface ImportSource {
  name: string
  /** 文件原始字节数；超限时不读进内存 */
  size: number
  bytes: Uint8Array
}

export interface ImportEntry {
  title: string
  content: string
}

export interface ImportPlan {
  entries: ImportEntry[]
  skipped: { name: string; reason: string }[]
}

const hasPrefix = (bytes: Uint8Array, prefix: number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b)

/**
 * 编码识别顺序：BOM → 无 BOM 的 UTF-16LE（NUL 比例）→ 严格 UTF-8 → GB18030 兜底。
 * Windows 中文环境大量 txt 是 GBK/GB18030；用 fatal UTF-8 试解，失败才回退，
 * 这样 UTF-8 文件永远不会被误判，而 GBK 文件不会变成乱码。
 * BOM 一律剥掉，不留在正文里；正文原样返回，不做换行归一化。
 */
export function decodeTextFile(bytes: Uint8Array): DecodedTextFile {
  if (hasPrefix(bytes, [0xef, 0xbb, 0xbf])) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  }
  if (hasPrefix(bytes, [0xff, 0xfe])) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (hasPrefix(bytes, [0xfe, 0xff])) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  }

  if (bytes.length >= 4 && bytes.length % 2 === 0) {
    let nuls = 0
    for (const b of bytes) if (b === 0) nuls++
    if (nuls / bytes.length > 0.2) {
      return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' }
    }
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'gb18030' }
  }
}

/** 只取文件名、去掉末尾 .txt（大小写不敏感）；空白名兜底，超长截断。 */
export function titleFromFileName(name: string): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? ''
  const trimmed = base.trim()
  const stripped = /\.txt$/i.test(trimmed) ? trimmed.slice(0, -4) : trimmed
  const title = stripped.trim()
  return (title || '未命名文档').slice(0, 80)
}

export function isTxtFile(name: string): boolean {
  return /\.txt$/i.test(String(name ?? '').trim())
}

/**
 * 纯函数：把一次选中的若干文件转成「新增文档条目 + 跳过说明」。
 * 顺序即用户选择顺序；同名文件不去重、不阻止；一个坏文件不阻塞其他文件。
 */
export function planImport(sources: ImportSource[]): ImportPlan {
  const entries: ImportEntry[] = []
  const skipped: { name: string; reason: string }[] = []

  for (const [index, item] of sources.entries()) {
    const name = String(item?.name ?? '')
    if (index >= MAX_IMPORT_FILES) {
      skipped.push({ name, reason: SKIP_REASON.tooMany })
      continue
    }
    if (!isTxtFile(name)) {
      skipped.push({ name, reason: SKIP_REASON.notTxt })
      continue
    }
    if (item.size > MAX_IMPORT_BYTES) {
      skipped.push({ name, reason: SKIP_REASON.tooLarge })
      continue
    }
    try {
      const { text } = decodeTextFile(item.bytes)
      entries.push({ title: titleFromFileName(name), content: text })
    } catch {
      skipped.push({ name, reason: SKIP_REASON.decode })
    }
  }

  return { entries, skipped }
}
