<script setup lang="ts">
import { computed } from 'vue'
import type { JwtResult } from '@/core/encoding'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{ info: JwtResult; compact?: boolean }>(), { compact: false })

interface Token {
  text: string
  cls: string
}

/** 轻量 JSON 着色：只做词法分段，不用 v-html，避免把令牌内容当 HTML 执行 */
function tokenize(text: string): Token[] {
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\],])/g
  const tokens: Token[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > last) tokens.push({ text: text.slice(last, match.index), cls: '' })
    const cls = match[1] ? (match[2] ? 'key' : 'string') : match[3] ? 'number' : match[4] ? 'atom' : 'punct'
    tokens.push({ text: match[0], cls })
    last = pattern.lastIndex
  }
  if (last < text.length) tokens.push({ text: text.slice(last), cls: '' })
  return tokens
}

const headerTokens = computed(() => tokenize(props.info.headerText))
const payloadTokens = computed(() => tokenize(props.info.payloadText))
const hasClaims = computed(() => props.info.claims.length > 0)
</script>

<template>
  <div class="jwt" :class="{ 'jwt--compact': compact }">
    <div v-if="!info.ok" class="jwt__empty">
      <Icon name="key" :size="24" />
      <strong>无法解析 JWT</strong>
      <span>{{ info.error }}</span>
      <span class="jwt__empty-tip">在左侧粘贴形如 header.payload.signature 的令牌，或点「示例」载入演示数据。</span>
    </div>

    <template v-else>
      <div class="jwt__head">
        <span class="jwt__badge" :class="`jwt__badge--${info.status}`">{{ info.statusText }}</span>
        <span class="jwt__meta">alg <b>{{ info.algorithm }}</b></span>
        <span class="jwt__meta">签名 <b>{{ info.signatureBytes }}</b> 字节</span>
        <span class="spacer" />
        <span class="jwt__offline"><Icon name="shield" :size="12" /> 本地解码</span>
      </div>

      <div v-for="(warning, i) in info.warnings" :key="i" class="jwt__warn">
        <Icon name="alert" :size="13" />
        <span>{{ warning }}</span>
      </div>

      <div class="jwt__grid">
        <section class="jwt__card">
          <header><span class="jwt__dot jwt__dot--head" />Header<span class="jwt__card-sub">头部</span></header>
          <pre class="jwt__code"><span v-for="(t, i) in headerTokens" :key="i" :class="`tok--${t.cls}`">{{ t.text }}</span></pre>
        </section>
        <section class="jwt__card">
          <header><span class="jwt__dot jwt__dot--body" />Payload<span class="jwt__card-sub">载荷</span></header>
          <pre class="jwt__code"><span v-for="(t, i) in payloadTokens" :key="i" :class="`tok--${t.cls}`">{{ t.text }}</span></pre>
        </section>
      </div>

      <section v-if="hasClaims" class="jwt__claims">
        <header>标准声明与自定义字段</header>
        <div class="jwt__claim jwt__claim--head">
          <span>字段</span><span>值</span><span>说明</span>
        </div>
        <div v-for="claim in info.claims" :key="claim.key" class="jwt__claim">
          <span class="jwt__claim-key">{{ claim.key }}<small>{{ claim.label }}</small></span>
          <span class="jwt__claim-val">{{ claim.value }}</span>
          <span class="jwt__claim-hint" :class="`tone--${claim.tone}`">{{ claim.hint }}</span>
        </div>
      </section>

      <div class="jwt__sig">
        <span>签名段</span>
        <code :title="info.signature">{{ info.signature || '（空）' }}</code>
      </div>
    </template>
  </div>
</template>

<style scoped>
.jwt {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px;
  font-size: 12px;
}

.jwt__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.jwt__badge {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  background: var(--surface-3);
  color: var(--text-2);
}

.jwt__badge--active {
  background: var(--ok-soft);
  color: var(--ok);
}

.jwt__badge--expired {
  background: var(--err-soft);
  color: var(--err);
}

.jwt__badge--future,
.jwt__badge--unknown {
  background: var(--warn-soft);
  color: var(--warn);
}

.jwt__meta {
  color: var(--text-3);
  font-size: 11.5px;
}

.jwt__meta b {
  color: var(--text-2);
  font-family: var(--font-mono);
}

.jwt__offline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ok);
  font-size: 11px;
}

.spacer {
  flex: 1 1 auto;
}

.jwt__grid {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 10px;
  min-height: 0;
  /* 外层是滚动容器，内部区块一律不许被 flex 压缩裁掉 */
  flex: none;
}

.jwt__card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  overflow: hidden;
}

.jwt__card > header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-2);
}

.jwt__card-sub {
  font-size: 10.5px;
  font-weight: 400;
  color: var(--text-3);
}

.jwt__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.jwt__dot--head {
  background: var(--accent);
}

.jwt__dot--body {
  background: var(--ok);
}

.jwt__code {
  margin: 0;
  padding: 9px 11px;
  max-height: 260px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
}

.tok--key {
  color: var(--json-key);
}
.tok--string {
  color: var(--json-string);
}
.tok--number {
  color: var(--json-number);
}
.tok--atom {
  color: var(--json-atom);
  font-weight: 600;
}
.tok--punct {
  color: var(--json-punct);
}

.jwt__claims {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: auto;
  max-height: 340px;
  flex: none;
}

.jwt__claims > header {
  padding: 6px 10px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-2);
}

.jwt__claim {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 130px;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11.5px;
  align-items: center;
}

.jwt__claim:last-child {
  border-bottom: none;
}

.jwt__claim--head {
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 10.5px;
  padding: 4px 10px;
}

.jwt__claim-key {
  font-family: var(--font-mono);
  color: var(--accent);
  min-width: 0;
}

.jwt__claim-key small {
  display: block;
  font-family: var(--font-ui);
  color: var(--text-3);
  font-size: 10px;
}

.jwt__claim-val {
  font-family: var(--font-mono);
  color: var(--text);
  word-break: break-all;
}

.jwt__claim-hint {
  color: var(--text-3);
  font-size: 10.5px;
}

.tone--ok {
  color: var(--ok);
}
.tone--warn {
  color: var(--warn);
}
.tone--err {
  color: var(--err);
}

.jwt__sig {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-3);
  font-size: 11px;
}

.jwt__sig code {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-3);
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 10.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.jwt__warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  flex: none;
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 11px;
  line-height: 1.5;
}

.jwt__warn svg {
  flex: none;
  margin-top: 1px;
}

.jwt__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 100%;
  min-height: 180px;
  color: var(--text-3);
  text-align: center;
}

.jwt__empty strong {
  color: var(--text-2);
  font-size: 13px;
}

.jwt__empty-tip {
  max-width: 320px;
  font-size: 11px;
  line-height: 1.5;
}

/* 紧凑模式：卡片堆叠、声明表精简 */
.jwt--compact {
  padding: 9px;
  gap: 8px;
}

.jwt--compact .jwt__grid {
  grid-template-columns: 1fr;
}

.jwt--compact .jwt__code {
  max-height: 150px;
}

.jwt--compact .jwt__claims {
  max-height: 210px;
}

.jwt--compact .jwt__claim {
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 5px;
}

.jwt--compact .jwt__claim-hint,
.jwt--compact .jwt__claim--head span:last-child {
  display: none;
}

.jwt--compact .jwt__offline {
  display: none;
}
</style>
