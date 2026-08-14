/**
 * Post-compaction premise-drift guard. After a `compaction/summary`, the guard
 * extracts distinctive literal anchors (paths, quoted strings, key=value
 * pairs, error codes) from the shadowed span's text, checks whether the
 * committed summary still contains them, and — when a critical anchor
 * vanished — injects one notice into the next step telling the model what it
 * may have lost and how to recover it from the append-only log.
 *
 * This fills the runtime gap left by recall-oriented designs: recall tools
 * make shadowed content reachable *when suspected*, but nothing says "you just
 * dropped a key fact". The guard turns the compaction summary into a checked
 * handoff instead of a blind one.
 * @module @deepseek-ai/dsh-premise-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message, MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
// Type-only: pulls in dsh-compaction's SessionEventMap augmentation so the
// 'compaction/summary' event type (and its ContentBlock[] summary) is visible.
import type {} from '@deepseek-ai/dsh-compaction'

export const name = 'premise-guard'

/** Plugin config, validated by the same-named schemastery schema plus fail-loud load checks in `apply`. */
export interface Config {
  /** Maximum vanished anchors named in one notice (default 5). */
  maxAnchors?: number
  /** Minimum anchor length to be treated as critical (default 6). */
  minAnchorLength?: number
  /** Maximum notice text length (default 400). */
  maxNoticeChars?: number
}

export const Config: z<Config> = z.object({
  maxAnchors: z.number().default(5),
  minAnchorLength: z.number().default(6),
  maxNoticeChars: z.number().default(400),
})

/** The `{kind:'plugin'}` source stamped on every notice this guard injects. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'premise-guard' }

/** Words too generic to be anchors; a stopword alone never counts as critical. */
const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'have', 'your', 'what',
  'error', 'failed', 'failure', 'timeout', 'exception', 'command', 'result',
  'output', 'input', 'value', 'status', 'note', 'file', 'path',
])

/** An anchor must look load-bearing: digits/symbols, or long enough to be a code-like token. */
function distinctive(anchor: string): boolean {
  if (STOPWORDS.has(anchor.toLowerCase())) return false
  return /[0-9./\\_=:%-]/.test(anchor) || anchor.length >= 12
}

/**
 * Extract candidate literal anchors from a text: quoted literals, file paths,
 * key=value pairs, error-ish tokens, and dotted command tokens. Returns
 * longest-first, deduplicated, minimum length applied.
 */
export function extractAnchors(text: string, minLength: number): string[] {
  const seen = new Set<string>()
  const anchors: string[] = []
  const patterns: RegExp[] = [
    /(["'`])([^"'`\n]{4,80})\1/g,
    /(?:[A-Za-z]:[\\/]|(?:\/|\.{1,2}[\\/]))[\w.\\/()-]+\.\w{1,5}/g,
    /\b[\w.-]{2,40}\s*[=:]\s*[\w./:%-]{1,60}/g,
    /\b(?:[A-Z][A-Z0-9_]{3,}|[\w-]*[Ee]rror[\w-]*|[\w-]*(?:exception|failed|timeout)[\w-]*)\b/g,
    /\b[\w-]{2,40}\.[\w.-]{2,40}\b/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1] ?? match[0]
      const anchor = raw.trim()
      if (anchor.length < minLength || !distinctive(anchor)) continue
      if (seen.has(anchor)) continue
      seen.add(anchor)
      anchors.push(anchor)
    }
  }
  return anchors.sort((a, b) => b.length - a.length)
}

/** Anchors from `candidates` that do not appear in `summary` (substring match). */
export function vanishedAnchors(candidates: readonly string[], summary: string): string[] {
  return candidates.filter(anchor => !summary.includes(anchor))
}

/** One pending alarm per session, injected once at the next eligible pre-step. */
interface Alarm {
  anchors: string[]
  range: string
}

/** Fail-loud integer validation. */
function validateInt(label: string, value: number | undefined, fallback: number): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`premise-guard: invalid ${label} ${resolved} — must be an integer >= 1`)
  }
  return resolved
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const maxAnchors = validateInt('maxAnchors', config.maxAnchors, 5)
  const minAnchorLength = validateInt('minAnchorLength', config.minAnchorLength, 6)
  const maxNoticeChars = validateInt('maxNoticeChars', config.maxNoticeChars, 400)

  const pending = new Map<SessionId, Alarm>()

  // A compaction/summary event carries the summary text and the seqs it
  // shadowed; the append-only log still holds every shadowed byte.
  ctx.on('session/event', (_session, event: SessionEvent): void => {
    if (event.type !== 'compaction/summary') return
    const shadowedText = event.data.shadowedSeqs
      .map(seq => _session.deriveEventMessage(_session.events[seq]!))
      .filter((message): message is Message => message !== null)
      .map(message => message.content
        .filter((block): block is { type: 'text'; text: string } =>
          block !== null && typeof block === 'object'
          && (block as { type?: unknown }).type === 'text'
          && typeof (block as { text?: unknown }).text === 'string')
        .map(block => block.text)
        .join('\n'))
      .join('\n')
    const summaryText = event.data.summary
      .filter((block): block is { type: 'text'; text: string } =>
        block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
    const lost = vanishedAnchors(
      extractAnchors(shadowedText, minAnchorLength),
      summaryText,
    ).slice(0, maxAnchors)
    if (lost.length === 0) return
    pending.set(_session.id, {
      anchors: lost,
      range: `${event.data.shadowedRange.start}-${event.data.shadowedRange.end}`,
    })
  })

  // Deliver the alarm once, at the next step that is not itself a new user
  // prompt (a fresh prompt re-frames the problem; no notice needed).
  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) return next()
    const alarm = pending.get(agent.id)
    if (alarm === undefined) return next()
    pending.delete(agent.id)

    const anchorLines = alarm.anchors.map(anchor => `- ${anchor}`).join('\n')
    let text = '⚠️ 前提告警（premise-guard）：刚才的上下文压缩（seqs '
      + `${alarm.range}）生成的摘要丢失了以下关键锚点：\n${anchorLines}\n`
      + '若这些前提仍然重要，用 session_event_read 或 history_read 从日志读回被压缩区间；'
      + '若已不再需要，忽略本提醒。'
    if (text.length > maxNoticeChars) {
      text = `${text.slice(0, maxNoticeChars)}…`
    }

    const downstream = await next()
    if (downstream.kind !== 'enter') return downstream
    return {
      kind: 'enter',
      messages: [
        ...downstream.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'premise-drift alarm' },
        }),
      ],
    }
  })

  // Release per-agent state when the agent leaves the registry.
  ctx.on('agent/disposed', ({ agent }: { agent: Agent }): void => {
    pending.delete(agent.id)
  })
}
