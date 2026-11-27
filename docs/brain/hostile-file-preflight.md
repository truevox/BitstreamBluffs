# #450: Bounded hostile-file preflight (foundation, not brain ABI)

The first AlphaBluffs brain import boundary is `preflightBrainJson()` in
`src/systems/brain/brainFilePreflight.js`. It accepts **raw JSON string or
UTF-8 bytes only**. It never executes data, imports code, loads modules,
creates a policy, trains, awards anything, or accepts a browser URL. It does
not touch storage or the network. Inputs such as JS objects (including cyclic
objects, Maps, typed arrays other than raw Uint8Array, functions and proxies)
are not accepted. Files larger than 2 MiB are rejected **before JSON.parse**;
UTF-8 decoding is strict and the original bytes are copied before parsing.

The validated tree has null prototypes and returns explicit
`admission:'preflight-only'`. This is NOT a model admission or a claim of
training compatibility. Every production consumer MUST subsequently run the
versioned model/observation/action schema from #24/#450, checking the ABI,
SIM_REVISION, finite bounded tensor dimensions, legal operator names, weight
count, action outputs and any platform-specific ownership/state. No model
import UI or public upload is enabled by this change.

Safety limits are provisional Friday-selected denial-of-service bounds,
**not** previously owner-approved neural-network dimensions: 2 MiB wire,
32 levels of nesting, 80,000 total JSON nodes, 65,536 entries per array,
1,024 object keys, 8,192 chars per key/string, absolute numeric magnitude
at most 1e12. Reject reserved object keys `__proto__`, `constructor`, and
`prototype`. These can be revised when the model ABI is established, with
regression tests and resource measurements. Every failure uses a tagged error
code and supplies no partially admitted tree.

Tests: `npm test -- --runInBand tests/brain/brain-file-preflight.test.js`.
CI runs the same test on every change to this module or the brain import
schema tests. Remaining #450 P0 work includes the actual versioned brain file
schema, validated memory/tensor shape budget, ABI and SIM_REVISION stamps,
hostile real-file import UI, and valid serialized brain roundtrip against a
real trainer/policy runtime. This preflight is a prerequisite, not completion.
