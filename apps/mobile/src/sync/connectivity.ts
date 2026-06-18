/**
 * Connectivity wrapper — the SINGLE Expo/React-Native-coupled file in `sync/`.
 *
 * Its only job is to tell the app "the network just came back" so the app can
 * kick off a {@link import('./drain').drain}. The reconcile + drain logic itself
 * is pure and headless-testable (see `reconcile.ts` / `drain.ts`); this thin
 * boundary is the one piece that genuinely needs the platform NetInfo API, so —
 * like `db/client.ts` — it is EXCLUDED from the Node typecheck (`tsconfig.json`
 * `exclude`) and the ESLint run (`eslint.config.js` `ignores`) until S9 installs
 * the Expo/native deps. Keeping the platform coupling isolated here is what lets
 * everything else stay testable in plain Node.
 *
 * The real implementation wires `@react-native-community/netinfo`'s
 * `addEventListener`, fires `cb` on a false→true `isConnected` transition, and
 * returns the unsubscribe handle. That import is deferred to S9 (Expo scaffold);
 * until then this is a documented, no-op stub with the final signature locked
 * in, so callers (and S9) can depend on the contract now.
 */

/**
 * Subscribe to "connectivity restored" events. `cb` is invoked each time the
 * device transitions from offline to online (the moment to drain the outbox).
 *
 * @returns an unsubscribe function — call it to stop listening (e.g. on app
 * teardown), exactly like NetInfo's own `addEventListener` return value.
 */
export function onConnectivityRestored(cb: () => void): () => void {
  // S9 wiring (real NetInfo):
  //
  //   import NetInfo from '@react-native-community/netinfo';
  //   let wasConnected = false;
  //   return NetInfo.addEventListener((state) => {
  //     const isConnected = state.isConnected === true;
  //     if (isConnected && !wasConnected) cb();
  //     wasConnected = isConnected;
  //   });
  //
  // Until then: no-op subscription. Reference `cb` so the parameter is "used"
  // without invoking it (no NetInfo events fire in the stub).
  void cb;
  return () => {
    /* no-op unsubscribe */
  };
}
