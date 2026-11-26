/** Optional browser-icon cancellation after navigation is not an offline game failure.
 * Only the exact, base-scoped apple-touch icon AND Chromium's ERR_ABORTED are exempt.
 * Never suppress failed JS, audio, manifest, service worker or any other origin asset.
 */
export function isBenignOptionalIconAbort(pathname, errorText, optionalIconPath) {
  return pathname === optionalIconPath && errorText === 'net::ERR_ABORTED';
}
