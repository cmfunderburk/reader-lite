import { useRef, type PointerEvent } from 'react';

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
const SWIPE_MIN_PX = 40;

export type TapZone = 'left' | 'middle' | 'right';

interface GestureHandlers {
  onTap: (zone: TapZone) => void;
  onSwipe: (direction: 'next' | 'previous') => void;
  onLongPress: (target: Element | null) => void;
}

interface Press {
  id: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
  longPressed: boolean;
}

/**
 * Kindle-style page gestures: tap the left/right third to turn pages, the
 * middle to toggle toolbars, swipe to turn, long-press to pick a line.
 */
export function usePageGestures({ onTap, onSwipe, onLongPress }: GestureHandlers) {
  const press = useRef<Press | null>(null);

  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!event.isPrimary) return;
      cancel();
      const { clientX: x, clientY: y, pointerId: id } = event;
      const timer = setTimeout(() => {
        if (!press.current) return;
        press.current.longPressed = true;
        onLongPress(document.elementFromPoint(x, y));
      }, LONG_PRESS_MS);
      press.current = { id, x, y, timer, longPressed: false };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = press.current;
      if (!current || current.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > MOVE_TOLERANCE_PX) {
        clearTimeout(current.timer);
      }
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const current = press.current;
      if (!current || current.id !== event.pointerId) return;
      cancel();
      if (current.longPressed) return;

      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
        onSwipe(dx < 0 ? 'next' : 'previous');
        return;
      }
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const fraction = (event.clientX - rect.left) / rect.width;
      onTap(fraction < 1 / 3 ? 'left' : fraction > 2 / 3 ? 'right' : 'middle');
    },
    onPointerCancel: cancel,
  };
}
