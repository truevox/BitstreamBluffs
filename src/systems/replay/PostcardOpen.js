/**
 * #67: the UI-free half of OPENING a postcard (pasted text or the contents of a `.bbpostcard` file). NO Phaser, NO network.
 * decode -> postcardCompatible -> fingerprint-only takeover descriptor -> validateTakeoverDescriptor. The trust check itself is the
 * fingerprint at tick N, made by RunScene's seek; this module only refuses what can be refused up front.
 */
import { decodePostcard, postcardCompatible, buildPostcardDescriptor, MAX_ENCODED_POSTCARD_CHARS, POSTCARD_PREFIX } from './Postcard.js';
import { validateTakeoverDescriptor } from './Takeover.js';

const fail = (reason, message) => ({ ok: false, reason, message });

/**
 * @param {string} text pasted code or file contents (whitespace, a BOM and line wraps are ignored)
 * @param {{identity:{simRevision:number, rulesetId:string, buildId:string}, codec?:object}} o identity = the RUNNING build
 * @returns {Promise<{ok:true, postcard:object, descriptor:object}|{ok:false, reason:string, message:string}>}
 */
export async function openPostcardText(text, o = {}) {
  try {
    const raw = String(text === undefined || text === null ? '' : text);
    // Bound the work before touching the text: a huge paste is refused, not scanned.
    if (raw.length > MAX_ENCODED_POSTCARD_CHARS * 2) return fail('too-large', 'this is too large to be a postcard');
    const code = raw.replace(/^﻿/, '').replace(/\s+/g, '');
    if (!code) return fail('empty', 'paste a postcard code or open a .bbpostcard file');
    const dec = await decodePostcard(code, o.codec ? { codec: o.codec } : {});
    if (!dec.ok) return dec;
    const pc = dec.postcard;
    const compat = postcardCompatible(pc, o.identity);
    if (!compat.ok) return compat;
    const descriptor = buildPostcardDescriptor(pc);
    const v = validateTakeoverDescriptor(descriptor, { rulesetId: o.identity.rulesetId });
    if (!v.ok) return v;
    return { ok: true, postcard: pc, descriptor };
  } catch (e) {
    return fail('error', String((e && e.message) || e));
  }
}

export { POSTCARD_PREFIX };
