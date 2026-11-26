import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/core/markdown'

describe('T-43 · 记事本 Markdown 渲染', () => {
  it('空文本不产生空壳标签', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   \n\n ')).toBe('')
  })

  it('用户文本里的 HTML 一律转义，不会变成可执行标签', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('onerror=alert(1)')
  })

  it('标题按层级输出', () => {
    expect(renderMarkdown('# 一级')).toContain('<h1>一级</h1>')
    expect(renderMarkdown('### 三级 ###')).toContain('<h3>三级</h3>')
    expect(renderMarkdown('####### 七个井号')).not.toContain('<h7>')
  })

  it('粗体 / 斜体 / 删除线 / 行内代码', () => {
    expect(renderMarkdown('**粗** 和 *斜* 与 ~~删~~')).toBe('<p><strong>粗</strong> 和 <em>斜</em> 与 <del>删</del></p>')
    expect(renderMarkdown('`npm run build`')).toBe('<p><code>npm run build</code></p>')
  })

  it('行内代码里的星号不会被当成强调', () => {
    expect(renderMarkdown('`a * b * c`')).toBe('<p><code>a * b * c</code></p>')
  })

  it('围栏代码块保留原文并标注语言', () => {
    const html = renderMarkdown('```ts\nconst a = 1 < 2 // *不是斜体*\n```')
    expect(html).toContain('<pre><code class="language-ts">')
    expect(html).toContain('1 &lt; 2')
    expect(html).toContain('*不是斜体*')
  })

  it('链接只放行 http(s) / mailto / 相对路径', () => {
    expect(renderMarkdown('[站内](/notes/1)')).toContain('<a href="/notes/1">站内</a>')
    const external = renderMarkdown('[外链](https://example.com/?a=1&b=2)')
    expect(external).toContain('href="https://example.com/?a=1&amp;b=2"')
    expect(external).toContain('rel="noreferrer noopener"')
    const bad = renderMarkdown('[坏链](javascript:alert(1))')
    expect(bad).not.toContain('<a ')
    expect(bad).toContain('javascript:alert(1)')
  })

  it('图片同样走协议白名单', () => {
    expect(renderMarkdown('![图](https://img.example.com/a.png)')).toContain(
      '<img src="https://img.example.com/a.png" alt="图" loading="lazy" />',
    )
    expect(renderMarkdown('![x](data:image/svg+xml,<svg onload=alert(1)>)')).not.toContain('<img')
  })

  it('无序 / 有序 / 嵌套列表', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('1. 一\n2. 二')).toBe('<ol><li>一</li><li>二</li></ol>')
    const nested = renderMarkdown('- 父\n  - 子\n- 父二')
    expect(nested).toContain('<ul><li>父<ul><li>子</li></ul></li><li>父二</li></ul>')
  })

  it('任务列表输出只读勾选框', () => {
    const html = renderMarkdown('- [x] 已完成\n- [ ] 待办')
    expect(html).toContain('class="md-task"')
    expect(html).toContain('md-check md-check--on')
    expect(html).toContain('待办')
  })

  it('引用可以嵌套其它块', () => {
    const html = renderMarkdown('> ## 标题\n> 正文')
    expect(html).toBe('<blockquote><h2>标题</h2><p>正文</p></blockquote>')
  })

  it('表格支持对齐语法', () => {
    const html = renderMarkdown('| 名称 | 数量 |\n| :--- | ---: |\n| 苹果 | 3 |')
    expect(html).toContain('<table>')
    // 左对齐也显式输出：`:---` 要按原样体现对齐意图，不能退化成「无对齐」
    expect(html).toContain('<th style="text-align:left">名称</th>')
    expect(html).toContain('<th style="text-align:right">数量</th>')
    expect(html).toContain('<td style="text-align:left">苹果</td>')
    expect(html).toContain('<td style="text-align:right">3</td>')
  })

  it('分割线与段落内换行', () => {
    expect(renderMarkdown('---')).toBe('<hr />')
    expect(renderMarkdown('第一行\n第二行')).toBe('<p>第一行<br />第二行</p>')
    expect(renderMarkdown('第一段\n\n第二段')).toBe('<p>第一段</p><p>第二段</p>')
  })
})
