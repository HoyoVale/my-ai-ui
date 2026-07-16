import { useEffect, useRef } from "react";

const DRAG_THRESHOLD = 5;

export function usePetDrag({
  onPetClick,
  onDragStart
} = {}) {
  const dragRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    moved: false
  });

  const suppressClickRef =
    useRef(false);

  const finishDrag = (event) => {
    const drag = dragRef.current;

    if (!drag.active) {
      return;
    }

    const didMove = drag.moved;

    try {
      event?.currentTarget
        ?.releasePointerCapture?.(
          drag.pointerId
        );
    } catch {
      // 指针可能已经被浏览器自动释放。
    }

    window.api?.endPetDrag?.();

    suppressClickRef.current =
      didMove;

    dragRef.current = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      moved: false
    };
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    onDragStart?.();

    const target =
      event.currentTarget;

    const pointerId =
      event.pointerId;

    const screenX =
      event.screenX;

    const screenY =
      event.screenY;

    try {
      target.setPointerCapture(
        pointerId
      );
    } catch (error) {
      console.warn(
        "无法捕获 Pet 指针：",
        error
      );
    }

    dragRef.current = {
      active: true,
      pointerId,
      startX: screenX,
      startY: screenY,
      moved: false
    };

    suppressClickRef.current =
      false;

    /*
     * 不 await。
     * 这样无论 preload 内部使用 send 还是 invoke，
     * 都不会因为 React event.currentTarget 失效而中断。
     */
    window.api?.startPetDrag?.({
      x: screenX,
      y: screenY
    });
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;

    if (
      !drag.active ||
      drag.pointerId !==
        event.pointerId
    ) {
      return;
    }

    if ((event.buttons & 1) !== 1) {
      finishDrag(event);
      return;
    }

    const distanceX = Math.abs(
      event.screenX - drag.startX
    );

    const distanceY = Math.abs(
      event.screenY - drag.startY
    );

    if (
      distanceX >= DRAG_THRESHOLD ||
      distanceY >= DRAG_THRESHOLD
    ) {
      drag.moved = true;
    }

    window.api?.movePetDrag?.({
      x: event.screenX,
      y: event.screenY
    });
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current =
        false;
      return;
    }

    onPetClick?.();
  };

  useEffect(() => {
    return () => {
      window.api?.endPetDrag?.();
    };
  }, []);

  return {
    onPointerDown:
      handlePointerDown,

    onPointerMove:
      handlePointerMove,

    onPointerUp:
      finishDrag,

    onPointerCancel:
      finishDrag,

    onClick:
      handleClick
  };
}
