/**
 * SPEC v5.0：记事本的 Markdown 渲染。
 *
 * 不引第三方解析器：先把整段文本转义，再只拼白名单标签，
 * 所以粘贴进来的 `<script>`、`onerror=` 只会变成字面文字。
 * 支持：标题、粗体 / 斜体 / 删除线、行内代码、代码块、引用、
 * 有序 / 无序 / 任务列表、表格、分割线、链接与图片（仅 http(s)/mailto）。
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch)
}

/** 只放行 http(s) / mailto 与相对路径，挡掉 javascript:、data: 这类可执行协议。 */
function safeUrl(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()
  if (!scheme) return url
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? url : null
}

/** 行内代码先抽成占位符，避免里面的 `*` `_` 被当成强调语法。 */
const CODE_OPEN = '\u0000c'
const CODE_CLOSE = '\u0000'

function renderInline(text: string): string {
  const codes: string[] = []
  let out = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`)
    return `${CODE_OPEN}${codes.length - 1}${CODE_CLOSE}`
  })
  out = escapeHtml(out)
  // 图片必须排在链接前面，否则 ![alt](url) 会先被链接规则吃掉
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt: string, url: string) => {
    const safe = safeUrl(url)
    return safe ? `<img src="${safe}" alt="${alt}" loading="lazy" />` : match
  })
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
    const safe = safeUrl(url)
    if (!safe) return match
    const external = /^https?:/i.test(safe)
    return `<a href="${safe}"${external ? ' target="_blank" rel="noreferrer noopener"' : ''}>${label}</a>`
  })
  out = out.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^\n_]+?)__/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<em>$2</em>')
  out = out.replace(/(^|[^\w_])_([^_\n]+?)_(?=[^\w_]|$)/g, '$1<em>$2</em>')
  out = out.replace(/~~([^\n]+?)~~/g, '<del>$1</del>')
  return out.replace(
    new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, 'g'),
    (_match, index: string) => codes[Number(index)] ?? '',
  )
}

const FENCE = /^```([\w+#.-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const UL = /^(\s*)[-*+]\s+(.*)$/
const OL = /^(\s*)\d{1,9}[.)]\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/

function isTableStart(lines: string[], index: number): boolean {
  return lines[index]?.includes('|') === true && TABLE_SEP.test(lines[index + 1] ?? '')
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function alignOf(cell: string): string {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  // 左对齐也要显式返回：否则序列化回 Markdown 时 `:---` 会被抹成 `---`
  if (left) return 'left'
  return ''
}

function renderTable(lines: string[], start: number): { html: string; next: number } {
  const head = splitRow(lines[start]!)
  const aligns = splitRow(lines[start + 1]!).map(alignOf)
  let index = start + 2
  const rows: string[][] = []
  while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) {
    rows.push(splitRow(lines[index]!))
    index += 1
  }
  const cell = (tag: string, text: string, column: number) => {
    const align = aligns[column]
    return `<${tag}${align ? ` style="text-align:${align}"` : ''}>${renderInline(text)}</${tag}>`
  }
  const headHtml = `<thead><tr>${head.map((text, column) => cell('th', text, column)).join('')}</tr></thead>`
  const bodyHtml = rows.length
    ? `<tbody>${rows.map((row) => `<tr>${head.map((_, column) => cell('td', row[column] ?? '', column)).join('')}</tr>`).join('')}</tbody>`
    : ''
  return { html: `<table>${headHtml}${bodyHtml}</table>`, next: index }
}

type ListItem = { indent: number; ordered: boolean; text: string; task: boolean | null }

function renderList(items: ListItem[]): string {
  let html = ''
  // 子列表必须长在父 <li> 里面，所以栈里要记住当前层是否有未闭合的 li
  const stack: { ordered: boolean; indent: number; liOpen: boolean }[] = []
  const closeLi = () => {
    const top = stack[stack.length - 1]
    if (top?.liOpen) {
      html += '</li>'
      top.liOpen = false
    }
  }
  const closeList = () => {
    const top = stack.pop()
    if (!top) return
    if (top.liOpen) html += '</li>'
    html += top.ordered ? '</ol>' : '</ul>'
  }
  const openList = (ordered: boolean, indent: number) => {
    html += ordered ? '<ol>' : '<ul>'
    stack.push({ ordered, indent, liOpen: false })
  }

  for (const item of items) {
    while (stack.length && item.indent < stack[stack.length - 1]!.indent) closeList()
    if (!stack.length) openList(item.ordered, item.indent)
    else if (item.indent > stack[stack.length - 1]!.indent) openList(item.ordered, item.indent)
    else if (stack[stack.length - 1]!.ordered !== item.ordered) {
      closeList()
      openList(item.ordered, item.indent)
    }
    closeLi()
    const checkbox = item.task === null
      ? ''
      : `<span class="md-check${item.task ? ' md-check--on' : ''}" aria-hidden="true"></span>`
    const text = item.text.split('\n').map(renderInline).join('<br />')
    html += `<li${item.task === null ? '' : ' class="md-task"'}>${checkbox}${text}`
    stack[stack.length - 1]!.liOpen = true
  }
  while (stack.length) closeList()
  return html
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? ''
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    UL.test(line) ||
    OL.test(line) ||
    isTableStart(lines, index)
  )
}

function renderBlocks(lines: string[]): string {
  let html = ''
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!

    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      index += 1
      const code: string[] = []
      while (index < lines.length && !FENCE.test(lines[index]!)) {
        code.push(lines[index]!)
        index += 1
      }
      index += 1
      const lang = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : ''
      html += `<pre><code${lang}>${escapeHtml(code.join('\n'))}</code></pre>`
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const level = heading[1]!.length
      html += `<h${level}>${renderInline(heading[2]!)}</h${level}>`
      index += 1
      continue
    }

    if (HR.test(line)) {
      html += '<hr />'
      index += 1
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (index < lines.length) {
        const quote = QUOTE.exec(lines[index]!)
        if (!quote) break
        quoted.push(quote[1]!)
        index += 1
      }
      html += `<blockquote>${renderBlocks(quoted)}</blockquote>`
      continue
    }

    if (UL.test(line) || OL.test(line)) {
      const items: ListItem[] = []
      while (index < lines.length) {
        const ul = UL.exec(lines[index]!)
        const ol = OL.exec(lines[index]!)
        if (!ul && !ol) break
        const leading = ul?.[1] ?? ol?.[1] ?? ''
        const indent = Math.floor(leading.replace(/\t/g, '  ').length / 2)
        let text = ul?.[2] ?? ol?.[2] ?? ''
        let task: boolean | null = null
        const checkbox = /^\[([ xX])\]\s+(.*)$/.exec(text)
        if (checkbox) {
          task = checkbox[1]!.toLowerCase() === 'x'
          text = checkbox[2]!
        }
        items.push({ indent, ordered: Boolean(ol), text, task })
        index += 1
        // 缩进续行并入上一条，避免「列表项里换行」被拆成新段落
        while (index < lines.length && /^\s{2,}/.test(lines[index]!) && !UL.test(lines[index]!) && !OL.test(lines[index]!)) {
          if (!lines[index]!.trim()) break
          items[items.length - 1]!.text += `\n${lines[index]!.trim()}`
          index += 1
        }
      }
      html += renderList(items)
      continue
    }

    if (isTableStart(lines, index)) {
      const table = renderTable(lines, index)
      html += table.html
      index = table.next
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && lines[index]!.trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]!)
      index += 1
    }
    // 便签 / 记事本里用户按一次回车就是换行，不按 CommonMark 的软换行处理
    html += `<p>${paragraph.map(renderInline).join('<br />')}</p>`
  }
  return html
}

export function renderMarkdown(source: string): string {
  const text = source.replace(/\r\n?/g, '\n')
  if (!text.trim()) return ''
  return renderBlocks(text.split('\n'))
}
