import type { SeedNote } from '../core/types'

/**
 * 首次启动播种的 8 张便签：用户提供的开发测试服务账号。
 * 明文、纯自由文本，用户可任意修改或删除；只在存储键完全不存在时写入一次。
 * 请勿把本仓库推到公共远端。
 */
export const INITIAL_NOTES: SeedNote[] = [
  {
    title: 'pyxis',
    content: '地址：https://10.6.125.231:30443\n账号：admin\n密码：Poc@Meta_027n',
  },
  {
    title: 'apisix',
    content: '地址：http://10.6.125.231:30453\n账号：admin\n密码：1qaz@WSX2022.',
  },
  {
    title: 'canal',
    content: '地址：http://10.6.125.231:38089\n账号：admin\n密码：canal@uMeta135',
  },
  {
    title: 'laf',
    content: '地址：http://10.6.125.231.nip.io:14080\n账号：admin\n密码：2wsx%TGB2022.',
  },
  {
    title: 'Alert',
    content: '地址：http://10.6.125.230:19090\n账号：admin\n密码：R1Q9Y7kV3H42cwWo0Fexrmq95u4CJAZf',
  },
  {
    title: 'Monitor',
    content: '地址：http://10.6.125.230:13000/grafana\n账号：admin\n密码：Poc@Meta_027ml\n备注：Grafana 面板',
  },
  {
    title: 'Log server（victorialogs）',
    content: '地址：http://10.6.125.230:9428/select/vmui/\n账号：admin\n密码：Poc@Meta_027ml\n备注：参考文档：victorialogs使用手册',
  },
  {
    title: 'rocketMq',
    content: '地址：http://10.6.125.230:18080/#/topic\n账号：admin\n密码：aMQ@Meta_027\n备注：/#/topic 是页内 hash，实际入口为 18080',
  },
]
