/**
 * Discoverable streamer permissions without forcibly muting music.
 * Safe to use from keyboard/gamepad-confirm as well as pointer activation.
 */
export function streamerPolicyUrl(baseHref) {
	return new URL('streamers.html', baseHref).href;
}

/** Opens the publicly included policy page. No gameplay/audio state changes. */
export function openStreamerPolicy(hostWindow) {
	try {
		if (!hostWindow?.open || !hostWindow?.location?.href) return false;
		hostWindow.open(streamerPolicyUrl(hostWindow.location.href), '_blank', 'noopener,noreferrer');
		return true;
	} catch {
		return false;
	}
}
