/**
 * Hard regression: five genuine BSOD escapes on one uninterrupted physical
 * Gym flight. The fixture grants TWO legitimately representable opt-in ranks
 * (canopy 25, airbrake 25) without paying their Shop prices; it does not
 * mutate pursuit speed, physics, terrain, score, collisions, or positions
 * after starting the DEFAULT, still-locked Gym course.
 *
 * Run against this branch's Vite server, e.g.:
 * GAME_URL=http://127.0.0.1:8231/ node tools/bsod-gym-real-five-flight-browser-smoke.mjs
 */
process.env.SCENARIO='aero-25';
process.env.FRAMES='1800';
process.env.ASSERT_FIVE='1';
await import('./bsod-gym-physics-feasibility-browser-probe.mjs');
