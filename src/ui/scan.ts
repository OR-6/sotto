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
  /**
   * Optional group scanning: the scan steps through groups (all members highlighted), a select
   * enters a group and then steps through its members. A one-member group is chosen at once.
   * After two passes through a group with no choice, the scan goes back to the groups.
   */
  groups?: () => HTMLElement[][];
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
  /** The highlighted element itself, so the highlight stays on it when the list changes. */
  let anchor: HTMLElement | null = null;
  let changedAt = 0;
  let lastKey = '';
  /** A selection right after the targets changed is ignored: the user aimed at the old one. */
  const SETTLE_MS = 600;
  const dialogOpen = () => !!doc.querySelector('dialog[open]');

  const usable = (el: HTMLElement) => el.isConnected && !(el as HTMLButtonElement).disabled && !el.closest('[hidden]');
  /** -1: scanning the groups (or the flat list); otherwise the index of the group being scanned. */
  let inGroup = -1;
  let groupSteps = 0;
  /** Each target is one or more elements: a group, or a single item. */
  const current = (): HTMLElement[][] => {
    if (o.groups) {
      const gs = o.groups().map((g) => g.filter(usable)).filter((g) => g.length);
      if (inGroup >= 0) {
        const g = gs[inGroup];
        if (g) return g.map((el) => [el]);
        inGroup = -1;
      }
      return gs;
    }
    return o.items().filter(usable).map((el) => [el]);
  };
  const paint = () => {
    const targets = current();
    doc.querySelectorAll('.scan').forEach((el) => el.classList.remove('scan'));
    if (!on || !targets.length || dialogOpen()) return;
    const key = inGroup + ':' + targets.map((t) => t.map((el) => `${el.id}${el.textContent}`).join('+')).join('|');
    if (key !== lastKey) {
      lastKey = key;
      changedAt = performance.now();
      // Re-anchor on the element that was highlighted, wherever it is now.
      const at = anchor ? targets.findIndex((t) => t.includes(anchor!)) : -1;
      if (at >= 0) index = at;
    }
    index = ((index % targets.length) + targets.length) % targets.length;
    const t = targets[index];
    anchor = t[0];
    t.forEach((el) => el.classList.add('scan'));
    t[0].scrollIntoView?.({ block: 'nearest' });
    o.announce?.(t.length > 1 ? `Group of ${t.length}: ${t.map((el) => el.textContent).join(', ')}` : t[0].getAttribute('aria-label') || t[0].textContent || '');
  };
  const step = () => {
    if (dialogOpen()) return paint(); // paused while a dialog is open
    index++;
    if (inGroup >= 0 && ++groupSteps >= current().length * 2) {
      inGroup = -1; // two passes and no choice: back to the groups
      groupSteps = 0;
      index = 0;
    }
    paint();
  };
  const select = () => {
    if (dialogOpen()) return;
    paint(); // refresh: the targets may have changed since the last step
    if (performance.now() - changedAt < SETTLE_MS) return;
    const target = current()[index];
    if (!target) return;
    if (target.length > 1) {
      inGroup = index; // enter the group
      groupSteps = 0;
      index = 0;
      anchor = null;
      return restart();
    }
    const el = target[0];
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') (el as HTMLInputElement).focus();
    else el.click();
    inGroup = -1;
    index = 0; // restart from the top after a choice
    anchor = null;
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
      // Holding the switch only turns scanning ON. A slow release while scanning must never turn it
      // off, so turning it off is done with the Scan button (or Settings).
      if (!on)
        longPressTimer = window.setTimeout(() => {
          longPressed = true;
          api.start();
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
