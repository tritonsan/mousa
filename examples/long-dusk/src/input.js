// Keyboard and touch input. One Input can drive several games at once (the comparison walks both characters).

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const ACT = new Set(['KeyE', 'Enter', 'Space']);

export class Input {
  constructor(target = window) {
    this.left = false;
    this.right = false;
    this.pressed = new Set();
    this.listeners = new Set();
    this.onKeyDown = event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      // Leave keys alone while a control has focus, so buttons and links keep their own Enter and Space.
      const tag = event.target?.tagName;
      if ((tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') && (event.code === 'Enter' || event.code === 'Space' || event.code === 'Tab')) return;
      let used = true;
      if (LEFT.has(event.code)) this.left = true;
      else if (RIGHT.has(event.code)) this.right = true;
      else if (ACT.has(event.code)) { if (!event.repeat) this.press('act'); }
      else if (event.code === 'KeyR') { if (!event.repeat) this.press('replay'); }
      else if (event.code === 'KeyP') { if (!event.repeat) this.press('pause'); }
      else used = false;
      if (used) { event.preventDefault(); this.notify(); }
    };
    this.onKeyUp = event => {
      if (LEFT.has(event.code)) this.left = false;
      if (RIGHT.has(event.code)) this.right = false;
    };
    this.onBlur = () => { this.left = false; this.right = false; };
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Called on any manual input, so an autoplay can hand control back to the player. */
  onManual(listener) { this.listeners.add(listener); }
  notify() { for (const listener of this.listeners) listener(); }

  press(name) { this.pressed.add(name); }

  get dir() { return (this.right ? 1 : 0) - (this.left ? 1 : 0); }

  /** Edge-triggered presses since the last call. */
  take() {
    const result = new Set(this.pressed);
    this.pressed.clear();
    return result;
  }

  /** Hold-to-walk touch buttons: [data-touch="left"|"right"|"act"]. */
  bindTouch(root) {
    for (const button of root.querySelectorAll('[data-touch]')) {
      const name = button.dataset.touch;
      const down = event => {
        event.preventDefault();
        if (name === 'left') this.left = true;
        else if (name === 'right') this.right = true;
        else this.press('act');
        this.notify();
      };
      const up = () => { if (name === 'left') this.left = false; if (name === 'right') this.right = false; };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('pointerleave', up);
    }
  }
}
