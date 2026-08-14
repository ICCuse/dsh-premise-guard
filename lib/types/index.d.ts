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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "premise-guard";
/** Plugin config, validated by the same-named schemastery schema plus fail-loud load checks in `apply`. */
export interface Config {
    /** Maximum vanished anchors named in one notice (default 5). */
    maxAnchors?: number;
    /** Minimum anchor length to be treated as critical (default 6). */
    minAnchorLength?: number;
    /** Maximum notice text length (default 400). */
    maxNoticeChars?: number;
}
export declare const Config: z<Config>;
/**
 * Extract candidate literal anchors from a text: quoted literals, file paths,
 * key=value pairs, error-ish tokens, and dotted command tokens. Returns
 * longest-first, deduplicated, minimum length applied.
 */
export declare function extractAnchors(text: string, minLength: number): string[];
/** Anchors from `candidates` that do not appear in `summary` (substring match). */
export declare function vanishedAnchors(candidates: readonly string[], summary: string): string[];
/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map