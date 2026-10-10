// Besturing: virtuele joystick + swipen op touch, WASD + muis op desktop.
export class Controls {
  constructor(zone) {
    this.el = zone;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.firing = false;
    this.sprint = false;
    this.enabled = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.sensitivity = 1;
    this.keys = new Set();
    this.actions = { switch: false, climb: false, cry: false, select: null };
    this.noLock = false;
    this.freeDrag = false; // na sneuvelen: muis vrij, slepen = rondkijken

    this.joyBase = document.getElementById('joy-base');
    this.joyKnob = document.getElementById('joy-knob');
    this.joyId = null;
    this.joyOrigin = { x: 0, y: 0 };
    this.lookIds = new Map();
    this._bindTouch();
    this._bindKeyboard();
  }

  _bindTouch() {
    const zone = this.el;
    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      if (e.clientX < window.innerWidth * 0.42 && this.joyId === null) {
        this.joyId = e.pointerId;
        this.joyOrigin = { x: e.clientX, y: e.clientY };
        this.joyBase.style.left = e.clientX + 'px';
        this.joyBase.style.top = e.clientY + 'px';
        this.joyBase.classList.add('active');
        this._knob(0, 0);
      } else this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyId) {
        const max = 55;
        let dx = e.clientX - this.joyOrigin.x;
        let dy = e.clientY - this.joyOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > max) {
          dx = (dx / len) * max;
          dy = (dy / len) * max;
        }
        this._knob(dx, dy);
        this.move.x = dx / max;
        this.move.y = -dy / max;
        this.sprint = len > max * 1.2;
      } else if (this.lookIds.has(e.pointerId)) {
        const l = this.lookIds.get(e.pointerId);
        this.look.x += e.clientX - l.x;
        this.look.y += e.clientY - l.y;
        this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
    });
    const end = (e) => {
      if (e.pointerId === this.joyId) {
        this.joyId = null;
        this.move.x = this.move.y = 0;
        this.sprint = false;
        this.joyBase.classList.remove('active');
      }
      this.lookIds.delete(e.pointerId);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    // aanvalsknop: ingedrukt houden = aanvallen, slepen = richten
    const fire = document.getElementById('btn-fire');
    let fid = null;
    let fl = null;
    fire.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fire.setPointerCapture(e.pointerId);
      fid = e.pointerId;
      fl = { x: e.clientX, y: e.clientY };
      this.firing = true;
      fire.classList.add('pressed');
    });
    fire.addEventListener('pointermove', (e) => {
      if (e.pointerId !== fid) return;
      this.look.x += e.clientX - fl.x;
      this.look.y += e.clientY - fl.y;
      fl = { x: e.clientX, y: e.clientY };
    });
    const fend = (e) => {
      if (e.pointerId !== fid) return;
      fid = null;
      this.firing = false;
      fire.classList.remove('pressed');
    };
    fire.addEventListener('pointerup', fend);
    fire.addEventListener('pointercancel', fend);

    const tap = (id, fn) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
    };
    tap('btn-switch', () => (this.actions.switch = true));
    tap('btn-climb', () => (this.actions.climb = true));
    tap('btn-cry', () => (this.actions.cry = true));
  }

  _knob(dx, dy) {
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (!this.enabled) return;
      if (e.code === 'KeyQ') this.actions.switch = true;
      if (e.code === 'Digit1') this.actions.select = 0;
      if (e.code === 'Digit2') this.actions.select = 1;
      if (e.code === 'KeyE' || e.code === 'KeyF') this.actions.climb = true;
      if (e.code === 'KeyR' || e.code === 'KeyG') this.actions.cry = true;
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      if (!this.isTouch) this.firing = false;
    });
    const host = this.el;
    document.addEventListener('pointerlockerror', () => (this.noLock = true));
    host.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== host && !this.noLock && !this.freeDrag) {
        this.lock();
        return;
      }
      if (e.button === 0) this.firing = true;
    });
    host.addEventListener('contextmenu', (e) => e.preventDefault());
    host.addEventListener('wheel', (e) => {
      if (this.enabled && Math.abs(e.deltaY) > 20) this.actions.switch = true;
    }, { passive: true });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && !this.isTouch) this.firing = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === host || ((this.noLock || this.freeDrag) && e.buttons)) {
        this.look.x += e.movementX * 0.8;
        this.look.y += e.movementY * 0.8;
      }
    });
  }

  lock() {
    if (this.isTouch || this.noLock || !this.el.requestPointerLock) return;
    try {
      const r = this.el.requestPointerLock();
      if (r && r.catch) r.catch(() => (this.noLock = true));
    } catch (e) {
      this.noLock = true;
    }
  }

  update() {
    const k = this.keys;
    if (k.size) {
      const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      if (x || y || this.joyId === null) {
        const len = Math.hypot(x, y) || 1;
        this.move.x = x / len;
        this.move.y = y / len;
      }
      this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    } else if (this.joyId === null) {
      this.move.x = this.move.y = 0;
      if (!this.isTouch) this.sprint = false;
    }
  }

  consumeLook() {
    const l = { x: this.look.x * this.sensitivity, y: this.look.y * this.sensitivity };
    this.look.x = this.look.y = 0;
    return l;
  }

  reset() {
    this.move.x = this.move.y = 0;
    this.look.x = this.look.y = 0;
    this.firing = false;
    this.actions = { switch: false, climb: false, cry: false, select: null };
    this.joyId = null;
    this.lookIds.clear();
    this.joyBase?.classList.remove('active');
  }
}
