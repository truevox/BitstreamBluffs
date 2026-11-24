import {auditVerdictExitCode} from '../../tools/music/audit-verdict-exit.js';
describe('immutable audit reports and process exit code agree',()=>{
	test.each(['PASS_SAMPLED_MIXED_OUTPUT_4X_ESTIMATE',
		'PASS_33_GENUINE_PHYSICS_BSOD_FINAL_MASTER_SAMPLED_NOT_MASTERED'])(
		'passing %s returns process success',status=>
			expect(auditVerdictExitCode(status)).toBe(0));
	test.each(['FAILED_SAMPLE_PEAK','FAILED_ESTIMATED_4X_TRUE_PEAK',
		'INVALID_INCOMPLETE','INVALID_BROWSER_OR_HTTP_ERRORS',
		'VALID_CAPTURE_AUDIO_LIMIT_FAILURE',null,undefined,''])(
		'failed/invalid %s returns nonzero exit',status=>
			expect(auditVerdictExitCode(status)).not.toBe(0));
});
