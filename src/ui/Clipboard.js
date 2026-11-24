/**
 * OWNER: UI engineer.
 * Clipboard helper with fallbacks. Resolves true if the text reached the clipboard.
 */

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    /* fall through to execCommand */
  }
  let ta = null;
  try {
    ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    return !!document.execCommand('copy');
  } catch (e) {
    return false;
  } finally {
    // A throwing execCommand used to skip the remove and leave a focused, invisible textarea in the page,
    // which then swallowed the next keystrokes.
    if (ta) ta.remove();
  }
}
