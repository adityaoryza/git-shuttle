/* The queue behind the notifications ("toasts"): what is shown, for how long, and what happens on hover.
 * No DOM here, and the clock is injected: the tests drive it by hand. */

export const MAX_VISIBLE = 4;
export const EXIT_MS = 180;
// How long each kind stays; 0 means until it is dismissed.
export const AUTO_MS = { success: 4000, info: 4000, warning: 7000, error: 0 };
export const VARIANTS = Object.keys(AUTO_MS);

export function createToasts({ setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now, onChange = () => {} } = {}) {
  let items = [];
  let seq = 0;

  const emit = () => onChange(items.map(({ timer, ...visible }) => visible));
  const find = id => items.find(item => item.id === id);
  const isOpen = item => item && !item.leaving;

  function startTimer(item) {
    clearTimer(item.timer);
    item.timer = null;
    if (!item.duration) return;
    item.startedAt = now();
    item.timer = setTimer(() => dismiss(item.id), item.remaining);
  }

  function remove(id) {
    items = items.filter(item => item.id !== id);
    emit();
  }

  function dismiss(id) {
    const item = find(id);
    if (!isOpen(item)) return;
    clearTimer(item.timer);
    item.timer = null;
    item.leaving = true;
    setTimer(() => remove(id), EXIT_MS);
    emit();
  }

  // spec: { variant, title, detail?, actions?: [{label, ...}], duration? }; the same toast again only counts up.
  function push(spec) {
    const variant = VARIANTS.includes(spec.variant) ? spec.variant : "info";
    const key = [variant, spec.title, spec.detail || ""].join("\u0001");
    const duration = spec.duration !== undefined ? spec.duration : AUTO_MS[variant];
    const same = items.find(item => isOpen(item) && item.key === key);
    if (same) {
      same.count += 1;
      same.remaining = same.duration;
      same.paused = false;
      startTimer(same);
      emit();
      return same.id;
    }
    const item = {
      id: ++seq, key, variant, title: spec.title, detail: spec.detail || "", actions: spec.actions || [],
      count: 1, duration, remaining: duration, startedAt: 0, paused: false, leaving: false, timer: null,
    };
    items.push(item);
    startTimer(item);
    const open = items.filter(isOpen);
    for (const old of open.slice(0, Math.max(0, open.length - MAX_VISIBLE))) dismiss(old.id);
    emit();
    return item.id;
  }

  // Hovering or focusing a toast stops its clock; leaving it starts again with the time that was left.
  function pause(id) {
    const item = find(id);
    if (!isOpen(item) || item.paused || !item.duration || !item.timer) return;
    clearTimer(item.timer);
    item.timer = null;
    item.remaining = Math.max(0, item.remaining - (now() - item.startedAt));
    item.paused = true;
    emit();
  }

  function resume(id) {
    const item = find(id);
    if (!isOpen(item) || !item.paused) return;
    item.paused = false;
    startTimer(item);
    emit();
  }

  function clear() {
    for (const item of items) { clearTimer(item.timer); }
    items = [];
    emit();
  }

  return { push, dismiss, pause, resume, clear, snapshot: () => items.map(({ timer, ...visible }) => visible) };
}
