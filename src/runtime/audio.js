import {MiniEvent, MiniEventTarget, platformError, requireMethod} from './events.js';
import {resolveAssetPath} from './network.js';

function playbackAborted(message) { const error = new Error(message); error.name = 'AbortError'; return error; }

/** HTMLAudioElement subset backed by real native audio; not a Web Audio emulator. */
export function createAudioClass({api, assetRoot, instances}) {
  return class Audio extends MiniEventTarget {
    constructor(src) {
      super();
      this._inner = requireMethod(api, 'createInnerAudioContext')();
      if (!this._inner) throw new Error('Native createInnerAudioContext returned no context');
      this._subscriptions = [];
      this._playWaiters = new Set();
      this._paused = true;
      this._volume = this._inner.volume ?? 1;
      this._muted = false;
      this.ended = false;
      this.seeking = false;
      this.readyState = 0;
      this.error = null;
      this.tagName = 'AUDIO'; this.style = {};
      instances.add(this);
      try {
        for (const [native, event] of [['Canplay', 'canplay'], ['Play', 'play'], ['Pause', 'pause'], ['Stop', 'pause'], ['Ended', 'ended'], ['Seeking', 'seeking'], ['Seeked', 'seeked'], ['TimeUpdate', 'timeupdate'], ['Error', 'error']]) {
          if (typeof this._inner[`on${native}`] !== 'function') continue;
          const callback = data => {
            // Native implementations can deliver an already queued event after off*/destroy.
            if (!this._inner) return;
            if (event === 'canplay') { this.readyState = 3; this.dispatchEvent(new MiniEvent('loadedmetadata')); }
            if (event === 'play') { this._paused = false; this.ended = false; this._settlePlay(); }
            if (event === 'pause' || event === 'ended') {
              this._paused = true;
              this.ended = event === 'ended';
              this._settlePlay(playbackAborted(`Audio ${native.toLowerCase()} before playback started`));
            }
            if (event === 'seeking' || event === 'seeked') this.seeking = event === 'seeking';
            if (event === 'error') {
              this._paused = true;
              this.error = platformError('Audio', data);
              this._settlePlay(this.error);
            }
            if (this._inner) this.dispatchEvent(new MiniEvent(event, {detail: data}));
          };
          this._subscriptions.push([native, callback]);
          this._inner[`on${native}`](callback);
        }
        if (src !== undefined) this.src = src;
      } catch (error) {
        try { this.dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Audio construction and cleanup failed'); }
        throw error;
      }
    }
    _context() {
      if (!this._inner) throw new Error('Audio has been disposed');
      return this._inner;
    }
    _settlePlay(error) {
      const waiters = [...this._playWaiters];
      this._playWaiters.clear();
      for (const waiter of waiters) error ? waiter.reject(error) : waiter.resolve();
    }
    _reload(value) {
      const path = value ? resolveAssetPath(value, assetRoot) : '';
      const inner = this._context();
      this._settlePlay(playbackAborted('Audio source changed before playback started'));
      this._paused = true; this.ended = false; this.seeking = false;
      this.readyState = 0; this.error = null;
      inner.src = path;
      this._src = value;
    }
    get src() { return this._src || ''; }
    set src(value) { this._reload(String(value)); }
    get currentTime() { return this._context().currentTime || 0; }
    set currentTime(value) {
      value = Number(value);
      if (!Number.isFinite(value) || value < 0) throw new RangeError('Audio currentTime must be a finite non-negative number');
      requireMethod(this._context(), 'seek')(value);
    }
    get duration() { return this._context().duration || 0; }
    get paused() { return this._paused; }
    get volume() { return this._volume; }
    set volume(value) {
      value = Number(value);
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Audio volume must be between 0 and 1');
      this._context().volume = this.muted ? 0 : value;
      this._volume = value;
    }
    get loop() { return !!this._context().loop; }
    set loop(value) { this._context().loop = !!value; }
    get autoplay() { return !!this._context().autoplay; }
    set autoplay(value) { this._context().autoplay = !!value; }
    get muted() { return this._muted; }
    set muted(value) {
      value = !!value;
      this._context().volume = value ? 0 : this.volume;
      this._muted = value;
    }
    play() {
      if (!this._inner) return Promise.reject(new Error('Audio has been disposed'));
      if (this.error) return Promise.reject(this.error);
      if (!this._paused) return Promise.resolve();
      return new Promise((resolve, reject) => {
        if (typeof this._inner.onPlay !== 'function' || typeof this._inner.onError !== 'function') {
          reject(new Error('Audio playback events are unavailable')); return;
        }
        const pending = this._playWaiters.size > 0;
        this._playWaiters.add({resolve, reject});
        if (pending) return;
        try { requireMethod(this._inner, 'play')(); }
        catch (error) { this._settlePlay(platformError('Audio.play', error)); }
      });
    }
    pause() {
      const pause = requireMethod(this._context(), 'pause');
      const previouslyPaused = this._paused;
      this._paused = true;
      this._settlePlay(playbackAborted('Audio paused before playback started'));
      try { pause(); } catch (error) { this._paused = previouslyPaused; throw error; }
    }
    load() {
      if (!this.src) throw new Error('Audio.load requires src');
      // Native contexts begin loading on src assignment.
      this._reload(this.src);
    }
    canPlayType() { return ''; } // The native API offers no reliable MIME capability probe.
    setAttribute(name, value) {
      if (name === 'src') this.src = value;
      else if (name === 'loop' || name === 'autoplay') this[name] = true;
      else throw new Error(`Unsupported audio attribute: ${name}`);
    }
    remove() { this.parentNode?.removeChild(this); }
    dispose() {
      if (!this._inner) return;
      const inner = this._inner;
      this._inner = null; this._paused = true; this.seeking = false; this.readyState = 0;
      this._settlePlay(playbackAborted('Audio disposed before playback started'));
      this._clearListeners(); instances.delete(this);
      const errors = [];
      for (const [name, callback] of this._subscriptions.splice(0)) {
        try { inner[`off${name}`]?.(callback); } catch (error) { errors.push(error); }
      }
      try { requireMethod(inner, 'destroy')(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Native audio cleanup failed');
    }
  };
}
