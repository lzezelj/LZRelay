// Shared by microphone/deafen controls, including the dock and call view.
let nextToggle = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
function schedule() {
  if (!timer && listeners.size && nextToggle > Date.now())
    timer = setTimeout(
      () => {
        timer = null;
        listeners.forEach((listener) => listener());
        schedule();
      },
      Math.max(1, nextToggle - Date.now() + 1),
    );
}
export const voiceToggleRemaining = () =>
  Math.max(0, Math.ceil((nextToggle - Date.now()) / 1000));
export const subscribeVoiceToggle = (listener: () => void) => {
  listeners.add(listener);
  schedule();
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
};
export function takeVoiceToggle(now = Date.now()) {
  if (now < nextToggle) return false;
  nextToggle = now + 750;
  listeners.forEach((listener) => listener());
  if (timer) clearTimeout(timer);
  timer = null;
  schedule();
  return true;
}
