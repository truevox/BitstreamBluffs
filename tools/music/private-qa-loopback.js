/** Private music source overlays must NEVER expose unauthenticated OGGs. */
export function assertPrivateAudioQaLoopbackHost(host) {
	if (host !== '127.0.0.1' && host !== '::1')
		throw new Error('Private QA media overlay must bind loopback only; loopback-only numeric addresses 127.0.0.1 or ::1 required, refusing unauthenticated network exposure: '+host);
	return host;
}

/** Require the exact numeric origin before serving private bytes (DNS rebinding guard). */
export function isPrivateQaRequestHost(value,host,port) {
	const authority=host==='::1'?'[::1]':host;
	return value===authority+':'+port;
}
