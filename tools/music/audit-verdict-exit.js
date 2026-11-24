/** The audit process MUST fail for every incomplete or above-limit report. */
export function auditVerdictExitCode(status) {
	return typeof status==='string'&&status.startsWith('PASS_')?0:2;
}
