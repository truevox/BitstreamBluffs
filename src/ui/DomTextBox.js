/**
 * OWNER: UI engineer.
 * A real DOM input/textarea positioned over the canvas, for things canvas text cannot do: typing seeds on touch
 * devices (summons the virtual keyboard), pasting and selecting sharecodes. Positioned in the 480x270 virtual
 * canvas space and re-aligned every frame. Keyboard events are stopped at the element so neither Phaser nor the
 * InputRouter sees what is typed. Removed on scene shutdown.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants.js';

export class DomTextBox {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{x:number,y:number,w:number,h:number,multiline?:boolean,readOnly?:boolean,value?:string,maxLength?:number,
   *          placeholder?:string,onSubmit?:function(string):void,onCancel?:function():void,color?:string}} o
   */
  constructor(scene, theme, o) {
    this.scene = scene;
    this.theme = theme;
    this.o = o;
    const el = document.createElement(o.multiline ? 'textarea' : 'input');
    if (!o.multiline) el.type = 'text';
    el.value = o.value || '';
    if (o.maxLength) el.maxLength = o.maxLength;
    if (o.placeholder) el.placeholder = o.placeholder;
    el.readOnly = !!o.readOnly;
    el.spellcheck = false;
    el.autocomplete = 'off';
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('aria-label', o.placeholder || 'text');
    el.style.cssText = 'position:fixed;z-index:50;box-sizing:border-box;margin:0;resize:none;outline:none;' +
      'font-family:ui-monospace,Menlo,Consolas,monospace;border-radius:0;overflow:hidden;';
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (o.onCancel) o.onCancel();
      } else if (e.key === 'Enter' && (!o.multiline || e.ctrlKey || e.metaKey || o.readOnly)) {
        e.preventDefault();
        if (o.onSubmit) o.onSubmit(el.value);
      }
    });
    el.addEventListener('keyup', (e) => e.stopPropagation());
    el.addEventListener('keypress', (e) => e.stopPropagation());
    el.addEventListener('focus', () => this._style(true));
    el.addEventListener('blur', () => this._style(false));
    document.body.appendChild(el);
    this.el = el;
    this.lastKey = '';
    this._style(false);
    this._reposition();
    this._onUpdate = () => this._reposition();
    scene.events.on(Phaser.Scenes.Events.UPDATE, this._onUpdate);
    this._cleanup = () => this.destroy();
    scene.events.once('shutdown', this._cleanup);
    scene.events.once('destroy', this._cleanup);
    this._unbind = theme.bind(() => this._style(document.activeElement === el));
  }

  _style(focused) {
    if (!this.el) return;
    const css = this.theme.css;
    this.el.style.background = css.bg;
    this.el.style.color = css.text;
    this.el.style.caretColor = css.lime;
    this.el.style.border = `1px solid ${focused ? css.lime : css[this.o.color || 'cyan']}`;
    this.el.style.boxShadow = focused ? `0 0 6px ${css.lime}66` : 'none';
  }

  _reposition() {
    const el = this.el;
    const canvas = this.scene.game.canvas;
    if (!el || !canvas) return;
    const r = canvas.getBoundingClientRect();
    const sx = r.width / GAME_WIDTH;
    const sy = r.height / GAME_HEIGHT;
    const key = `${r.left}|${r.top}|${sx}|${sy}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const o = this.o;
    el.style.left = `${r.left + o.x * sx}px`;
    el.style.top = `${r.top + o.y * sy}px`;
    el.style.width = `${o.w * sx}px`;
    el.style.height = `${o.h * sy}px`;
    el.style.fontSize = `${Math.max(10, 8 * sy)}px`;
    el.style.padding = `${2 * sy}px ${3 * sx}px`;
  }

  /** @returns {string} */
  getValue() {
    return this.el ? this.el.value : '';
  }

  /** @param {string} v @returns {void} */
  setValue(v) {
    if (this.el) this.el.value = v;
  }

  /** @returns {void} */
  focus() {
    if (this.el) {
      this.el.focus({ preventScroll: true });
      if (this.o.readOnly) this.el.select();
    }
  }

  /** Select all text (for manual copy). @returns {void} */
  selectAll() {
    if (this.el) {
      this.el.focus({ preventScroll: true });
      this.el.select();
    }
  }

  /** @returns {void} */
  destroy() {
    if (!this.el) return;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this._onUpdate);
    this.scene.events.off('shutdown', this._cleanup);
    this.scene.events.off('destroy', this._cleanup);
    if (this._unbind) this._unbind();
    const wasFocused = document.activeElement === this.el;
    this.el.remove();
    this.el = null;
    if (wasFocused && this.scene.game && this.scene.game.canvas) {
      try {
        this.scene.game.canvas.focus();
      } catch (e) {
        /* ignore */
      }
    }
  }
}
