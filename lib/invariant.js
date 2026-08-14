//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-premise-guard`.
* @module @deepseek-ai/dsh-premise-guard/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-premise-guard";
/** Cordis companion plugin name. */
const name = "premise-guard-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the alarm state is private to one session/event
* listener set and exposes no package-owned event or snapshot that an
* independent companion can observe.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
