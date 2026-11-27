/** Exact layout declaration for envelope-only local suspend admission.
 * Bind the actual typed codec source closure, not only section names.
 * This does not authorize world publication or official play. */
import {SAVESTATE_SCHEMA_SOURCES} from './layoutSources.js';
export const SAVESTATE_LAYOUT_DECLARATION_VERSION = 1;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const SAVESTATE_LAYOUT_DESCRIPTOR=freeze({
 version:SAVESTATE_LAYOUT_DECLARATION_VERSION,
 sections:{candidate:{kind:'bb-internal-candidate-file',version:1,
  sections:['clock','rng','recorder','terrain','matter','entities','subsystems','remainder'],
  numeric:'BB-CJSON canonical F64',integrity:'sha256',admission:'envelope-only'}},
 schemaSources:SAVESTATE_SCHEMA_SOURCES,
});
