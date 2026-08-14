import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as PremiseGuard from 'dsh-premise-guard'
import { extractAnchors, vanishedAnchors } from 'dsh-premise-guard'
import { MockAdapter, textResponse } from './mock-adapter.ts'

/**
 * Behavior suite for the premise-drift guard: anchor extraction, vanished
 * detection, and the one-shot notice injected after a compaction whose summary
 * dropped a critical literal. The notice path is exercised by emitting
 * `agent/pre-step` directly (the loop itself runs before the alarm exists).
 */

async function harness(): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(PremiseGuard, {})
  const adapter = new MockAdapter([
    textResponse('setting up with params.json, alpha=1.5'),
  ])
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
  await new Promise<void>((resolve) => {
    const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  })
  return { ctx, agent }
}

/** Seq of the first real user message. */
function firstUserSeq(agent: Agent): number {
  const e = [...agent.session.events].find((candidate): candidate is SessionEvent<'user/message'> =>
    candidate.type === 'user/message' && candidate.data.source.kind === 'user')
  if (e === undefined) throw new Error('no user message found')
  return e.seq
}

/** Seq of the first assistant message with visible text. */
function firstAssistantSeq(agent: Agent): number {
  const e = [...agent.session.events].find((candidate): candidate is SessionEvent<'assistant/message'> =>
    candidate.type === 'assistant/message')
  if (e === undefined) throw new Error('no assistant message found')
  return e.seq
}

/** Append a well-formed compaction bracket (start + summary + end) shadowing the given seqs. */
function appendCompaction(agent: Agent, seqs: number[], summaryText: string): void {
  const id = CompactionId('test-1')
  agent.session.append('compaction/start', { compactionId: id, turn: null })
  agent.session.append('compaction/summary', {
    compactionId: id,
    summary: [{ type: 'text', text: summaryText }],
    shadowedRange: { start: seqs[0]!, end: seqs[seqs.length - 1]! },
    shadowedSeqs: [...seqs],
    shadowedTokenCount: 120,
    provider: 'mock',
    model: 'mock',
  })
  agent.session.append('compaction/end', { compactionId: id, turn: null })
}

/** Emit one agent-scoped pre-step waterfall and return its decision. */
async function preStep(ctx: Context, agent: Agent, messages: unknown[]): Promise<{ kind: string; messages?: unknown[] }> {
  const dispatch = agentEvents(ctx, agent)
  return dispatch.waterfall(
    'agent/pre-step',
    { messages, turn: 2, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter' as const, messages: [] }),
  ) as Promise<{ kind: string; messages?: unknown[] }>
}

describe('anchor extraction', () => {
  it('finds paths, quoted literals, key=value pairs, and error codes; respects minimum length and stopwords', () => {
    const text = 'failed to load C:\\data\\backtest\\params.json with "alpha=1.5" and key=42; ERROR_TIMEOUT happened. '
      + 'the file path is fine and error is generic.'
    const anchors = extractAnchors(text, 6)
    expect(anchors).toContain('C:\\data\\backtest\\params.json')
    expect(anchors).toContain('alpha=1.5')
    expect(anchors).toContain('ERROR_TIMEOUT')
    // short tokens and stopwords are filtered
    expect(anchors.some(a => a === 'error')).toBe(false)
    expect(anchors.some(a => a.length < 6)).toBe(false)
  })

  it('reports exactly the anchors absent from a summary', () => {
    const anchors = ['alpha=1.5', 'C:\\data\\backtest\\params.json', 'ERROR_TIMEOUT']
    expect(vanishedAnchors(anchors, 'the run failed with ERROR_TIMEOUT')).toEqual([
      'alpha=1.5',
      'C:\\data\\backtest\\params.json',
    ])
  })
})

describe('post-compaction notice', () => {
  it('injects a one-shot notice when the summary dropped a critical anchor', async () => {
    const { ctx, agent } = await harness()
    const userSeq = firstUserSeq(agent)
    const assistantSeq = firstAssistantSeq(agent)
    appendCompaction(agent, [userSeq, assistantSeq], 'the setup step ran; alpha was noted.')

    const decision = await preStep(ctx, agent, [])
    expect(decision.kind).toBe('enter')
    const messages = decision.messages ?? []
    const injected = messages.filter((m): m is { source: { kind: string }; content: unknown[] } =>
      m !== null && typeof m === 'object' && (m as { source?: { kind?: string } }).source?.kind === 'plugin')
    expect(injected).toHaveLength(1)
    const text = injected[0]!.content
      .filter((b): b is { type: string; text: string } => (b as { type?: string }).type === 'text')
      .map(b => b.text)
      .join('')
    expect(text).toContain('premise-guard')
    expect(text).toContain('alpha=1.5')
    expect(text).toContain('params.json')
    expect(text).toContain(`seqs ${userSeq}-${assistantSeq}`)

    // One-shot: a second pre-step carries no further notice.
    const second = await preStep(ctx, agent, [])
    expect(second.messages ?? []).toHaveLength(0)
  })

  it('skips delivery when a fresh user prompt enters the step', async () => {
    const { ctx, agent } = await harness()
    appendCompaction(agent, [firstUserSeq(agent), firstAssistantSeq(agent)], 'alpha was dropped entirely')

    const decision = await preStep(ctx, agent, [
      createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
    ])
    expect(decision.kind).toBe('enter')
    expect(decision.messages ?? []).toHaveLength(0)
  })

  it('does not inject when the summary kept every anchor', async () => {
    const { ctx, agent } = await harness()
    appendCompaction(agent, [firstUserSeq(agent), firstAssistantSeq(agent)], 'alpha=1.5 and params.json were the key values')

    const decision = await preStep(ctx, agent, [])
    expect(decision.messages ?? []).toHaveLength(0)
  })
})
