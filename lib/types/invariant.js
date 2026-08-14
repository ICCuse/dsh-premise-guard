/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-premise-guard`.
 * @module @deepseek-ai/dsh-premise-guard/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-premise-guard';
/** Cordis companion plugin name. */
export const name = 'premise-guard-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: the alarm state is private to one session/event
 * listener set and exposes no package-owned event or snapshot that an
 * independent companion can observe.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map