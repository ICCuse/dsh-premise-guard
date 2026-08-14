# @deepseek-ai/dsh-premise-guard

[English](README.md) | 中文

压缩后前提漂移守卫。每次 `compaction/summary` 事件发生后，从被压区间的文本里提取特征字面锚点（文件路径、引号字面量、key=value、错误码），检查提交的摘要是否仍包含它们——关键锚点消失时，向下一步注入一次性提醒，告诉模型它可能丢了什么、如何从 append-only 日志里找回。

## 为什么

召回类设计（recallable-compaction、session-query 工具）让被压内容在**起疑时**可达。但没有任何东西说"你刚丢了一个关键事实"。本守卫把压缩摘要变成一次被检查的交接：路径、数值或错误串不再在摘要上下文中时，模型立刻得知。

## 工作机制

| 钩子 | 作用 |
|---|---|
| `session/event`（`compaction/summary`） | 用 `shadowedSeqs` 从日志重导出被压区间文本（日志保留每个字节），提取锚点，与 `event.data.summary` 对比。 |
| `agent/pre-step` | 注入一次性提醒（插件源），点名最多 `maxAnchors` 个消失锚点与被压 seq 区间；新的用户提示会跳过投递。 |

锚点提取是确定性纯函数——无 LLM 调用、无新存储。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `maxAnchors` | `5` | 一条提醒中点名的消失锚点数。 |
| `minAnchorLength` | `6` | 短于此长度的锚点永不视为关键。 |
| `maxNoticeChars` | `400` | 提醒文本上限。 |

三者必须为 `>= 1` 的整数；配置错误在插件加载时直接抛错。

## 安装

尚未发布到 npm —— 直接从此仓库安装：

```sh
npm install github:ICCuse/dsh-premise-guard
# 或：pnpm add github:ICCuse/dsh-premise-guard
```

然后在 profile 组装中挂载（package.json 已声明 `dsh.bundle`）：

```yaml
- id: dsh-premise-guard
  name: 'dsh-premise-guard'
```

发布后亦可 `dsh plugin --profile web add dsh-premise-guard`。
