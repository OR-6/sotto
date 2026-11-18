// Switch scanning: one switch (Space, or any switch interface that types a key) steps
// automatically through the targets; pressing it selects. Two switches: Tab-like advance with
// one key (Enter) and select with the other (Space). Hold Space for one second to turn it on or off.

export type Scanner = {
  readonly on: boolean;
  start(): void;
  stop(): void;
  toggle(): void;
  dispose(): void;
  setRate(ms: number): void;
};

export type ScanOptions = {
  /** The targets in scan order, recomputed each step (they change as suggestions arrive). */
  items: () => HTMLElement[];
  rateMs?: number;
  onChange?: (on: boolean) => void;
  /** Announces the current item to screen readers. */
  announce?: (label: string) => void;
  doc?: Document;
};

export function createScanner(o: ScanOptions): Scanner {
  const doc = o.doc ?? document;
  let rate = Math.min(4000, Math.max(600, o.rateMs ?? 1200));
  let on = false;
  let index = -1;
  let timer = 0;
  let spaceDownAt = 0;
  let longPressTimer = 0;
  let longPressed = false;

  const current = () => o.items().filter((el) => el.isConnected && !(el as HTMLButtonElement).disabled && !el.closest('[hidden]'));
  const paint = () => {
    const items = current();
    doc.querySelectorAll('.scan').forEach((el) => el.classList.remove('scan'));
    if (!on || !items.length) return;
    index = ((index % items.length) + items.length) % items.length;
    const el = items[index];
    el.classList.add('scan');
    el.scrollIntoView?.({ block: 'nearest' });
    o.announce?.(el.getAttribute('aria-label') || el.textContent || '');
  };
  const step = () => {
    index++;
    paint();
  };
  const select = () => {
    const items = current();
    const el = items[index];
    if (!el) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') (el as HTMLInputElement).focus();
    else el.click();
    index = 0; // restart from the top after a choice: the next answer is usually option 1
    restart();
  };
  const restart = () => {
    window.clearInterval(timer);
    if (on) timer = window.setInterval(step, rate);
    paint();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (e.code === 'Space' && !typing) {
      // While scanning, Space is the switch. Otherwise leave it to a focused button, and only
      // watch for the one-second hold that turns scanning on.
      if (on || t === doc.body) e.preventDefault();
      if (e.repeat) return;
      spaceDownAt = performance.now();
      longPressed = false;
      longPressTimer = window.setTimeout(() => {
        longPressed = true;
        api.toggle();
      }, 1000);
    } else if (on && e.key === 'Enter' && !typing) {
      e.preventDefault();
      step(); // second switch: advance
      restart();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || !spaceDownAt) return;
    window.clearTimeout(longPressTimer);
    spaceDownAt = 0;
    if (!longPressed && on) select();
  };
  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('keyup', onKeyUp);

  const api: Scanner = {
    get on() {
      return on;
    },
    start() {
      on = true;
      index = 0;
      restart();
      o.onChange?.(true);
    },
    stop() {
      on = false;
      window.clearInterval(timer);
      paint();
      o.onChange?.(false);
    },
    toggle() {
      if (on) api.stop();
      else api.start();
    },
    setRate(ms) {
      rate = Math.min(4000, Math.max(600, ms));
      if (on) restart();
    },
    dispose() {
      api.stop();
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('keyup', onKeyUp);
    },
  };
  return api;
}
