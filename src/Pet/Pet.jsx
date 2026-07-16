import { useEffect, useState } from "react";

import xixi from "../../assets/xixi_png.png";

import { PetContextMenu } from "./components/ContextMenu.jsx";
import { PetSprite } from "./components/Sprite.jsx";
import { usePetDrag } from "./hooks/usePetDrag.js";
import "./Pet.css";

const MENU_WIDTH = 156;
const MENU_HEIGHT = 138;
const MENU_EDGE_GAP = 8;

export default function Pet() {
  const [menu, setMenu] = useState({
    open: false,
    x: 0,
    y: 0
  });

  const closeMenu = () => {
    setMenu((current) => ({
      ...current,
      open: false
    }));
  };

  const dragHandlers = usePetDrag({
    onPetClick: () => {
      console.log("Pet clicked");
    },
    onDragStart: closeMenu
  });

  const runMenuAction = (action) => {
    closeMenu();
    action?.();
  };

  const handleContextMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();

    const x = Math.min(
      event.clientX,
      window.innerWidth -
        MENU_WIDTH -
        MENU_EDGE_GAP
    );

    const y = Math.min(
      event.clientY,
      window.innerHeight -
        MENU_HEIGHT -
        MENU_EDGE_GAP
    );

    setMenu({
      open: true,
      x: Math.max(MENU_EDGE_GAP, x),
      y: Math.max(MENU_EDGE_GAP, y)
    });
  };

  useEffect(() => {
    const handleBlur = () => {
      closeMenu();
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeMenu();
        window.api?.endPetDrag?.();
      }
    };

    window.addEventListener(
      "blur",
      handleBlur
    );

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "blur",
        handleBlur
      );

      window.removeEventListener(
        "keydown",
        handleKeyDown
      );

      window.api?.endPetDrag?.();
    };
  }, []);

  return (
    <main
      className="pet"
      onContextMenu={handleContextMenu}
    >
      <PetSprite
        src={xixi}
        dragHandlers={dragHandlers}
      />

      <PetContextMenu
        open={menu.open}
        x={menu.x}
        y={menu.y}
        onClose={closeMenu}
        onOpenInput={() => {
          runMenuAction(
            window.api?.openInput
          );
        }}
        onOpenResponse={() => {
          runMenuAction(
            window.api?.openResponse
          );
        }}
        onOpenSetting={() => {
          runMenuAction(
            window.api?.openSetting
          );
        }}
      />
    </main>
  );
}
