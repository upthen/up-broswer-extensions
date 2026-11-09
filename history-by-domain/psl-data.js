// 精简公共后缀表（public suffix，不含前导点）。
// 构建时固化在仓库里：不联网、不运行时解析 PSL 原始文件、不引第三方包。
// 表中未命中的后缀由 domain.js 的兜底规则（取最后两段）处理。
// 数据来源：publicsuffix.org 的 ICANN 段常见项 + PRIVATE 段常见托管域裁剪。

export const PUBLIC_SUFFIXES = [
  // 单段通用后缀
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'name',
  'io', 'ai', 'dev', 'app', 'co', 'xyz', 'me', 'tv', 'cc', 'cn', 'uk', 'jp',
  'kr', 'hk', 'tw', 'au', 'de', 'fr', 'ru', 'sg', 'in', 'ca', 'nl', 'it',
  'es', 'se', 'no', 'fi', 'dk', 'pl', 'ch', 'at', 'be', 'ie', 'pt', 'br',
  'mx', 'id', 'my', 'th', 'vn', 'ph', 'nz', 'za', 'eu', 'us', 'online',
  'site', 'tech', 'store', 'blog', 'cloud', 'top', 'club', 'vip', 'shop',
  'work', 'link', 'live', 'space', 'website', 'fun', 'pro', 'moe', 'icu',
  'wiki', 'design', 'art', 'world', 'today', 'news', 'email', 'group',
  'network', 'digital', 'solutions', 'agency', 'company', 'center', 'zone',
  'page', 'pages', 'host', 'press', 'studio', 'tools', 'systems',

  // 常见二段后缀（必须比单段优先匹配）
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'mil.cn',
  'com.hk', 'org.hk', 'edu.hk', 'gov.hk', 'idv.hk',
  'com.tw', 'org.tw', 'edu.tw', 'gov.tw', 'idv.tw',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'gr.jp',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.kr', 'or.kr', 'ne.kr', 're.kr', 'go.kr',
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'per.sg',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.mx', 'com.tr', 'com.ar', 'com.pl', 'com.ua', 'co.in', 'net.in',
  'org.in', 'gen.in', 'firm.in', 'co.nz', 'net.nz', 'org.nz',
  'co.za', 'org.za', 'net.za', 'com.my', 'com.ph', 'co.id', 'co.th',
  'com.vn', 'com.ru', 'com.es',

  // PRIVATE 段：多用户托管域，每个子站必须各自独立成卡
  'github.io', 'gitlab.io', 'gitee.io', 'pages.gitee.io', 'coding.me',
  'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
  'vercel.app', 'netlify.app', 'onrender.com', 'herokuapp.com',
  'appspot.com', 'cloudfront.net', 'azurewebsites.net',
  's3.amazonaws.com', 'blob.core.windows.net',
  'glitch.me', 'repl.co', 'replit.app', 'deno.dev',
  'notion.site', 'gitbook.io', 'readthedocs.io',
  'wordpress.com', 'blogspot.com', 'tumblr.com', 'medium.com',
  'githubusercontent.com', 'sharepoint.com', 'wixsite.com',
  'square.site', 'myshopify.com', 'crm.dynamics.com',
];

export const PSL_SET = new Set(PUBLIC_SUFFIXES);
