// The HTML layer over one game: objective, interaction prompt, subtitles and the dialogue box with a live
// portrait. Text lives in the DOM so it stays crisp, readable by assistive technology and selectable.

const el = (tag, className, parent) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.append(node);
  return node;
};

export class GameUI {
  constructor(stage, { reducedMotion = false, compact = false } = {}) {
    this.reducedMotion = reducedMotion;
    this.hud = el('div', `hud${compact ? ' hud--compact' : ''}`, stage);
    this.objectiveEl = el('p', 'objective', this.hud);
    this.promptEl = el('p', 'prompt', this.hud);
    this.promptEl.hidden = true;
    const key = el('kbd', '', this.promptEl);
    key.textContent = 'E';
    this.promptText = el('span', '', this.promptEl);
    this.subtitleEl = el('p', 'subtitle', this.hud);
    this.subtitleEl.hidden = true;
    this.dialogue = el('section', 'dialogue', this.hud);
    this.dialogue.hidden = true;
    this.dialogue.setAttribute('aria-label', 'Dialogue');
    this.portrait = el('canvas', 'portrait', this.dialogue);
    this.portrait.setAttribute('aria-hidden', 'true');
    const body = el('div', 'dialogue-body', this.dialogue);
    this.speakerEl = el('p', 'speaker', body);
    this.lineEl = el('p', 'line', body);
    this.lineEl.setAttribute('aria-hidden', 'true');
    this.advanceEl = el('p', 'advance', this.dialogue);
    this.advanceEl.setAttribute('aria-hidden', 'true');
    const advanceKey = el('kbd', '', this.advanceEl);
    advanceKey.textContent = 'E';
    // Screen readers get each line once, in full, rather than letter by letter.
    this.live = el('p', 'visually-hidden', this.hud);
    this.live.setAttribute('aria-live', 'polite');
    this.text = '';
    this.shown = 0;
    this.subtitleTimer = 0;
  }

  objective(text) {
    if (this.objectiveEl.textContent !== text) this.objectiveEl.textContent = text || '';
  }

  prompt(text, position) {
    if (!text) { if (!this.promptEl.hidden) this.promptEl.hidden = true; return; }
    if (this.promptText.textContent !== text) { this.promptText.textContent = text; this.live.textContent = `${text}. Press E.`; }
    this.promptEl.hidden = false;
    if (position) {
      this.promptEl.style.left = `${Math.round(position[0])}px`;
      this.promptEl.style.top = `${Math.round(position[1])}px`;
    }
  }

  say(name, text) {
    this.dialogue.hidden = false;
    this.speakerEl.textContent = name;
    this.text = text;
    this.shown = this.reducedMotion ? text.length : 0;
    this.lineEl.textContent = this.reducedMotion ? text : '';
    this.live.textContent = `${name}: ${text}`;
    this.advanceEl.classList.toggle('is-ready', this.done);
  }

  get done() { return this.shown >= this.text.length; }

  revealAll() {
    this.shown = this.text.length;
    this.lineEl.textContent = this.text;
    this.advanceEl.classList.add('is-ready');
  }

  closeDialogue() {
    this.dialogue.hidden = true;
    this.text = '';
    this.shown = 0;
  }

  subtitle(text, seconds = 3) {
    this.subtitleEl.textContent = text;
    this.subtitleEl.hidden = false;
    this.subtitleTimer = seconds;
    this.live.textContent = text;
  }

  update(dt) {
    if (!this.dialogue.hidden && !this.done) {
      const before = Math.floor(this.shown);
      this.shown = Math.min(this.text.length, this.shown + dt * 60);
      if (Math.floor(this.shown) !== before) this.lineEl.textContent = this.text.slice(0, Math.floor(this.shown));
      if (this.done) this.advanceEl.classList.add('is-ready');
    }
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitleEl.hidden = true;
    }
  }

  reset() {
    this.closeDialogue();
    this.prompt(null);
    this.subtitleEl.hidden = true;
    this.subtitleTimer = 0;
    this.objective('');
  }
}
