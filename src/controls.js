// Besturing: virtuele joystick + kijken met swipen op touch, WASD + muis op desktop.
export class Controls {
  constructor(el) {
    this.el = el;
    this.move = { x: 0, y: 0 }; // x = rechts, y = vooruit (-1..1)
    this.look = { x: 0, y: 0 }; // opgespaarde kijk-delta in pixels
    this.firing = false;
    this.jumpPressed = false;
    this.switchPressed = false;
    this.mountPressed = false;
    this.sprint = false;
    this.enabled = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.sensitivity = 1;
    this.keys = new Set();

    this.joyBase = document.getElementById('joy-base');
    this.joyKnob = document.getElementById('joy-knob');
    this.joyId = null;
    this.joyOrigin = { x: 0, y: 0 };
    this.lookIds = new Map(); // pointerId -> laatste positie

    this._bindTouch();
    this._bindKeyboard();
  }

  _bindTouch() {
    const zone = this.el;
    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      if (e.clientX < window.innerWidth * 0.45 && this.joyId === null) {
        this.joyId = e.pointerId;
        this.joyOrigin = { x: e.clientX, y: e.clientY };
        this.joyBase.style.left = e.clientX + 'px';
        this.joyBase.style.top = e.clientY + 'px';
        this.joyBase.classList.add('active');
        this._setKnob(0, 0);
      } else {
        this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
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
        this._setKnob(dx, dy);
        this.move.x = dx / max;
        this.move.y = -dy / max;
        this.sprint = len > max * 1.15;
      } else if (this.lookIds.has(e.pointerId)) {
        const last = this.lookIds.get(e.pointerId);
        this.look.x += (e.clientX - last.x) * 1.0;
        this.look.y += (e.clientY - last.y) * 1.0;
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

    // Vuurknop: ingedrukt houden = schieten, en tegelijk slepen = richten.
    const fire = document.getElementById('btn-fire');
    let fireId = null;
    let fireLast = null;
    fire.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fire.setPointerCapture(e.pointerId);
      fireId = e.pointerId;
      fireLast = { x: e.clientX, y: e.clientY };
      this.firing = true;
      fire.classList.add('pressed');
    });
    fire.addEventListener('pointermove', (e) => {
      if (e.pointerId !== fireId) return;
      this.look.x += e.clientX - fireLast.x;
      this.look.y += e.clientY - fireLast.y;
      fireLast = { x: e.clientX, y: e.clientY };
    });
    const fireEnd = (e) => {
      if (e.pointerId !== fireId) return;
      fireId = null;
      this.firing = false;
      fire.classList.remove('pressed');
    };
    fire.addEventListener('pointerup', fireEnd);
    fire.addEventListener('pointercancel', fireEnd);

    const tap = (id, fn) => {
      const b = document.getElementById(id);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
    };
    tap('btn-jump', () => (this.jumpPressed = true));
    tap('btn-switch', () => (this.switchPressed = true));
    tap('btn-mount', () => (this.mountPressed = true));
  }

  // Muis vastzetten voor richten; als de browser dat weigert, valt de besturing terug op slepen.
  lock() {
    if (this.isTouch || this.noLock || !this.el.requestPointerLock) return;
    try {
      const r = this.el.requestPointerLock();
      if (r && r.catch) r.catch(() => (this.noLock = true));
    } catch (e) {
      this.noLock = true;
    }
  }

  _setKnob(dx, dy) {
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (!this.enabled) return;
      if (e.code === 'Space') this.jumpPressed = true;
      if (e.code === 'KeyQ') this.switchPressed = true;
      if (e.code === 'Digit1') this.selectWeapon = 'sword';
      if (e.code === 'Digit2') this.selectWeapon = 'bow';
      if (e.code === 'KeyE' || e.code === 'KeyF') this.mountPressed = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      if (!this.isTouch) this.firing = false;
    });

    const canvasHost = this.el;
    document.addEventListener('pointerlockerror', () => (this.noLock = true));
    canvasHost.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvasHost && !this.noLock) {
        this.lock();
        return;
      }
      if (e.button === 0) this.firing = true;
    });
    canvasHost.addEventListener('contextmenu', (e) => e.preventDefault());
    canvasHost.addEventListener('wheel', (e) => {
      if (this.enabled && Math.abs(e.deltaY) > 20) this.switchPressed = true;
    }, { passive: true });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && !this.isTouch) this.firing = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      // zonder pointer lock: richten door met ingedrukte muisknop te slepen
      if (document.pointerLockElement === canvasHost || (this.noLock && e.buttons)) {
        this.look.x += e.movementX * 0.8;
        this.look.y += e.movementY * 0.8;
      }
    });
  }

  // Keyboard-input mengen met joystick-input.
  update() {
    if (this.keys.size) {
      const k = this.keys;
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
    this.jumpPressed = this.switchPressed = this.mountPressed = false;
    this.joyId = null;
    this.lookIds.clear();
    this.joyBase.classList.remove('active');
  }
}
