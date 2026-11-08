/**
 * Thin UCI wrapper around the bundled single-threaded Stockfish worker.
 *
 * The worker is created from /engine/stockfish-19-lite-single.js (copied from
 * the npm package at install time). Evaluations are serialized so that a move
 * arriving during an analysis never corrupts the protocol.
 */
export class StockfishEngine {
  constructor({ url, onLine, onWatchdogRestart } = {}) {
    const base = import.meta.env.BASE_URL || '/';
    this.url = url || `${base}engine/stockfish-19-lite-single.js`;
    this.onLine = onLine || null;
    this.onWatchdogRestart = onWatchdogRestart || null;
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.waiters = [];
    this.current = null;
    this.queue = Promise.resolve();
    this.lastInfo = null;
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.#doInit();
    return this.initPromise;
  }

  async #doInit() {
    if (typeof Worker === 'undefined') throw new Error('Web Workers are not available');

    this.worker = new Worker(this.url);
    this.worker.onmessage = (event) => this.#handleLine(String(event.data));
    this.worker.onmessageerror = () => this.#failAll(new Error('Engine message error'));
    this.worker.onerror = (event) => {
      this.#failAll(new Error(event?.message || 'Engine worker failed to load'));
    };

    await this.#waitFor(/^uciok/, 15000, () => this.#send('uci'));
    this.#send('setoption name Skill Level value 20');
    await this.#waitFor(/^readyok/, 45000, () => this.#send('isready'));
    this.ready = true;
    return true;
  }

  #send(command) {
    if (!this.worker) return;
    this.worker.postMessage(command);
  }

  #handleLine(line) {
    if (this.onLine) {
      try {
        this.onLine(line);
      } catch {
        /* logging must never break the engine */
      }
    }

    for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
      const waiter = this.waiters[i];
      if (waiter.regex.test(line)) {
        clearTimeout(waiter.timer);
        this.waiters.splice(i, 1);
        waiter.resolve(line);
      }
    }

    if (line.startsWith('info ') && this.current) {
      const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
      const depthMatch = line.match(/\bdepth (\d+)/);
      const pvMatch = line.match(/\bpv (.+)$/);
      if (scoreMatch) {
        this.current.score = { type: scoreMatch[1], value: Number(scoreMatch[2]) };
      }
      if (depthMatch) this.current.depth = Number(depthMatch[1]);
      if (pvMatch) this.current.pv = pvMatch[1].trim().split(/\s+/);
      this.lastInfo = line;
    }

    if (line.startsWith('bestmove') && this.current) {
      const match = line.match(/^bestmove\s+(\S+)/);
      const bestMove = match && match[1] !== '(none)' ? match[1] : null;
      this.#finishCurrent(null, bestMove);
    }
  }

  #finishCurrent(error, bestMove = null) {
    const current = this.current;
    if (!current) return;
    this.current = null;
    clearTimeout(current.timer);
    if (error) {
      current.reject(error);
      return;
    }
    current.resolve({
      fen: current.fen,
      score: current.score,
      bestMove: bestMove || current.pv?.[0] || null,
      pv: current.pv,
      depth: current.depth,
    });
  }

  #failAll(error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    if (this.current) {
      this.#finishCurrent(error);
    }
    this.ready = false;
  }

  #waitFor(regex, timeoutMs, start) {
    return new Promise((resolve, reject) => {
      const waiter = { regex, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('Engine did not answer in time'));
      }, timeoutMs);
      this.waiters.push(waiter);
      try {
        start();
      } catch (error) {
        clearTimeout(waiter.timer);
        reject(error);
      }
    });
  }

  #enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Evaluate a FEN. Returns { score, bestMove, pv, depth, fen }.
   * `movetime` is in milliseconds. Results are from the side to move's view.
   */
  evaluate(fen, { movetime = 600, skillLevel = 20 } = {}) {
    return this.#enqueue(async () => {
      if (!this.ready || !this.worker) throw new Error('Engine is not ready');

      const skill = Math.max(0, Math.min(20, Math.round(skillLevel)));
      this.#send(`setoption name Skill Level value ${skill}`);
      this.#send(`position fen ${fen}`);

      return new Promise((resolve, reject) => {
        this.current = {
          fen,
          score: null,
          pv: null,
          depth: 0,
          resolve,
          reject,
          timer: null,
        };
        this.current.timer = setTimeout(() => {
          const pending = this.current;
          this.#send('stop');
          // Give the engine a moment to emit the bestmove of the stopped
          // search before rejecting and restarting the worker.
          setTimeout(() => {
            if (this.current === pending) {
              const err = new Error('Engine analysis timed out (watchdog restart)');
              this.#finishCurrent(err);
              try {
                this.worker?.terminate();
              } catch {
                /* ignore */
              }
              this.worker = null;
              this.ready = false;
              this.initPromise = null;
              if (this.onWatchdogRestart) {
                try {
                  this.onWatchdogRestart();
                } catch {
                  /* ignore */
                }
              }
              // Automatically re-initialize worker for subsequent moves
              this.init().catch((e) => {
                console.warn('Engine watchdog auto-restart failed', e);
              });
            }
          }, 300);
        }, Math.max(1200, movetime + 1800));
        this.#send(`go movetime ${movetime}`);
      });
    });
  }

  dispose() {
    this.#failAll(new Error('Engine disposed'));
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
    }
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
  }
}
