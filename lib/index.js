import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import "@deepseek-ai/cordis";
//#region ../../llm/llm/src/brand.ts
/**
* Brand a message identifier.
* @param id - the opaque message identifier.
* @returns the same string, branded; no validation is performed.
*/
function MessageId(id) {
	return id;
}
//#endregion
//#region ../../llm/llm/src/call-config.ts
/**
* Deep-freeze a value in place with an iterative traversal, guarding cycles,
* so later mutation throws without imposing a JavaScript call-stack depth cap.
* {@link AbortSignal} objects are deliberately skipped because they are the
* request's live cancellation channel and freezing them breaks abort.
* @param value - the value to freeze in place.
* @returns the same value, frozen.
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object") continue;
		if (node instanceof AbortSignal) continue;
		if (seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
//#endregion
//#region ../../llm/llm/src/message.ts
/** Message value types, identity, and immutable construction helpers. */
/**
* Detach and deep-freeze a message whose identity already exists.
* @param message - complete message, including its stable identity.
* @returns an immutable snapshot that preserves the identity.
*/
function freezeMessage(message) {
	return deepFreeze(structuredClone(message));
}
/**
* Create one identified message and freeze it before publication.
* @param input - complete role, content, and source for a new message.
* @returns an immutable message with a fresh stable identity.
*/
function createMessage(input) {
	return freezeMessage({
		...input,
		id: MessageId(crypto.randomUUID())
	});
}
/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {
	return createMessage({
		...input,
		role: "user"
	});
}
//#endregion
//#region ../../util/timeout/src/index.ts
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;
//#endregion
//#region ../../llm/llm/src/error.ts
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
//#endregion
//#region ../../llm/llm/src/retry-policy.ts
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = z.object({
	initialDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: z.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = z.object({
	mode: z.const("normal").required(),
	maxRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
	retryableCodes: z.array(z.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = z.object({
	mode: z.const("always").required(),
	backoff: backoffSchema
});
z.union([normalPolicySchema, alwaysPolicySchema]);
//#endregion
//#region ../../llm/llm/src/attribution.ts
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
const { version } = createRequire(import.meta.url)("../package.json");
//#endregion
//#region lib/types/index.js
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
const name = "premise-guard";
const Config = z.object({
	maxAnchors: z.number().default(5),
	minAnchorLength: z.number().default(6),
	maxNoticeChars: z.number().default(400)
});
/** The `{kind:'plugin'}` source stamped on every notice this guard injects. */
const PLUGIN_SOURCE = {
	kind: "plugin",
	plugin: "premise-guard"
};
/** Words too generic to be anchors; a stopword alone never counts as critical. */
const STOPWORDS = new Set([
	"the",
	"and",
	"that",
	"this",
	"with",
	"from",
	"have",
	"your",
	"what",
	"error",
	"failed",
	"failure",
	"timeout",
	"exception",
	"command",
	"result",
	"output",
	"input",
	"value",
	"status",
	"note",
	"file",
	"path"
]);
/** An anchor must look load-bearing: digits/symbols, or long enough to be a code-like token. */
function distinctive(anchor) {
	if (STOPWORDS.has(anchor.toLowerCase())) return false;
	return /[0-9./\\_=:%-]/.test(anchor) || anchor.length >= 12;
}
/**
* Extract candidate literal anchors from a text: quoted literals, file paths,
* key=value pairs, error-ish tokens, and dotted command tokens. Returns
* longest-first, deduplicated, minimum length applied.
*/
function extractAnchors(text, minLength) {
	const seen = /* @__PURE__ */ new Set();
	const anchors = [];
	for (const pattern of [
		/(["'`])([^"'`\n]{4,80})\1/g,
		/(?:[A-Za-z]:[\\/]|(?:\/|\.{1,2}[\\/]))[\w.\\/()-]+\.\w{1,5}/g,
		/\b[\w.-]{2,40}\s*[=:]\s*[\w./:%-]{1,60}/g,
		/\b(?:[A-Z][A-Z0-9_]{3,}|[\w-]*[Ee]rror[\w-]*|[\w-]*(?:exception|failed|timeout)[\w-]*)\b/g,
		/\b[\w-]{2,40}\.[\w.-]{2,40}\b/g
	]) for (const match of text.matchAll(pattern)) {
		const anchor = (match[1] ?? match[0]).trim();
		if (anchor.length < minLength || !distinctive(anchor)) continue;
		if (seen.has(anchor)) continue;
		seen.add(anchor);
		anchors.push(anchor);
	}
	return anchors.sort((a, b) => b.length - a.length);
}
/** Anchors from `candidates` that do not appear in `summary` (substring match). */
function vanishedAnchors(candidates, summary) {
	return candidates.filter((anchor) => !summary.includes(anchor));
}
/** Fail-loud integer validation. */
function validateInt(label, value, fallback) {
	const resolved = value === void 0 ? fallback : value;
	if (!Number.isInteger(resolved) || resolved < 1) throw new Error(`premise-guard: invalid ${label} ${resolved} — must be an integer >= 1`);
	return resolved;
}
/**
* Install the guard's listeners.
* @param ctx - plugin context; listeners are scoped to it and disposed with it.
* @param config - validated {@link Config}.
*/
function apply(ctx, config) {
	const maxAnchors = validateInt("maxAnchors", config.maxAnchors, 5);
	const minAnchorLength = validateInt("minAnchorLength", config.minAnchorLength, 6);
	const maxNoticeChars = validateInt("maxNoticeChars", config.maxNoticeChars, 400);
	const pending = /* @__PURE__ */ new Map();
	ctx.on("session/event", (_session, event) => {
		if (event.type !== "compaction/summary") return;
		const shadowedText = event.data.shadowedSeqs.map((seq) => _session.deriveEventMessage(_session.events[seq])).filter((message) => message !== null).map((message) => message.content.filter((block) => block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n")).join("\n");
		const summaryText = event.data.summary.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
		const lost = vanishedAnchors(extractAnchors(shadowedText, minAnchorLength), summaryText).slice(0, maxAnchors);
		if (lost.length === 0) return;
		pending.set(_session.id, {
			anchors: lost,
			range: `${event.data.shadowedRange.start}-${event.data.shadowedRange.end}`
		});
	});
	ctx.on("agent/pre-step", async ({ agent, messages }, next) => {
		if (messages.some((message) => message.source.kind === "user")) return next();
		const alarm = pending.get(agent.id);
		if (alarm === void 0) return next();
		pending.delete(agent.id);
		const anchorLines = alarm.anchors.map((anchor) => `- ${anchor}`).join("\n");
		let text = `⚠️ 前提告警（premise-guard）：刚才的上下文压缩（seqs ${alarm.range}）生成的摘要丢失了以下关键锚点：\n${anchorLines}\n若这些前提仍然重要，用 session_event_read 或 history_read 从日志读回被压缩区间；若已不再需要，忽略本提醒。`;
		if (text.length > maxNoticeChars) text = `${text.slice(0, maxNoticeChars)}…`;
		const downstream = await next();
		if (downstream.kind !== "enter") return downstream;
		return {
			kind: "enter",
			messages: [...downstream.messages, createUserMessage({
				content: [{
					type: "text",
					text
				}],
				source: {
					...PLUGIN_SOURCE,
					form: "notice",
					summary: "premise-drift alarm"
				}
			})]
		};
	});
	ctx.on("agent/disposed", ({ agent }) => {
		pending.delete(agent.id);
	});
}
//#endregion
export { Config, apply, extractAnchors, name, vanishedAnchors };
