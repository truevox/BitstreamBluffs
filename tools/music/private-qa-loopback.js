/** Private music source overlays must NEVER expose unauthenticated OGGs. */
export function assertPrivateAudioQaLoopbackHost(host) {
	if (host !== '127.0.0.1' && host !== '::1')
		throw new Error('Private QA media overlay must bind loopback only; loopback-only numeric addresses 127.0.0.1 or ::1 required, refusing unauthenticated network exposure: '+host);
	return host;
}
