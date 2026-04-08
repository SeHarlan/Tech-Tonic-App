import { useEffect, useCallback, useImperativeHandle, useRef, forwardRef } from 'react';
import type { Engine } from '../../engine/renderer';
import type { EraseVariant } from '../../engine/types';
import { SEED_MODULUS } from '../../engine/parameters';
import { setupMenu } from '../../engine/ui/menu';
import '../../engine/ui/menu.css';
import menuHtml from '../../engine/ui/menu.html?raw';

export interface MenuDrawerHandle {
  open: () => void;
  close: () => void;
  toggle: () => void;
  /**
   * Pull the current brush size from the engine into the menu's internal
   * display state. Call after any non-menu source (hand tracking, mouse wheel)
   * changes the engine brush size so the menu label/preview stay accurate.
   */
  syncBrushFromEngine: () => void;
}

export interface MenuDrawerProps {
  engine: Engine | null;
  onAppMenu?: () => void;
  onBrushSizeChange?: () => void;
  hidden?: boolean;
}

/** Map menu.js action names to Engine API calls. */
function dispatchToEngine(
  engine: Engine,
  action: string,
  menuState: { brushSize: number; eraseVariant?: string; waterfallVariant?: boolean },
) {
  const dm = engine.getDrawingManager();

  switch (action) {
    // Brush size
    case 'increaseBrushSize':
      dm.increaseBrushSize();
      break;
    case 'decreaseBrushSize':
      dm.decreaseBrushSize();
      break;
    case 'brushSizeChanged':
      dm.setBrushSize(menuState.brushSize);
      break;

    // Movement modes
    case 'waterfallUp':
      engine.setDrawMode('waterfall');
      engine.setDirection('up');
      engine.setWaterfallVariant(menuState.waterfallVariant ?? true);
      break;
    case 'waterfallDown':
      engine.setDrawMode('waterfall');
      engine.setDirection('down');
      engine.setWaterfallVariant(menuState.waterfallVariant ?? true);
      break;
    case 'moveLeft':
      engine.setDrawMode('move');
      engine.setDirection('left');
      break;
    case 'moveRight':
      engine.setDrawMode('move');
      engine.setDirection('right');
      break;
    case 'shuffle':
      engine.setDrawMode('shuffle');
      break;
    case 'trickle':
      engine.setDrawMode('trickle');
      break;
    case 'eraseMovement':
      engine.setDrawMode('erase');
      engine.setEraseVariant((menuState.eraseVariant as EraseVariant) ?? 'movement');
      break;
    case 'freezeBrush':
      engine.setDrawMode('freeze');
      break;

    // Pause
    case 'toggleGlobalFreeze':
      engine.setGlobalFreeze(!engine.isGlobalFrozen());
      break;

    // Paint modes
    case 'drawSpace':
      engine.setDrawMode('empty');
      break;
    case 'drawGem':
      engine.setDrawMode('gem');
      break;
    case 'drawStatic':
      engine.setDrawMode('static');
      break;
    case 'resetInitialMovement':
      engine.setDrawMode('erase');
      engine.setEraseVariant((menuState.eraseVariant as EraseVariant) ?? 'paint');
      break;

    // Global
    case 'toggleManualMode':
      engine.setManualMode(!engine.isManualMode());
      break;
    case 'globalReset':
      engine.forceReset();
      break;
    case 'newSeed':
      engine.setSeed(Math.floor(Math.random() * SEED_MODULUS));
      break;
    // Keyboard-only actions
    case 'cycleEraseMode':
      engine.setDrawMode('erase');
      engine.setEraseVariant((menuState.eraseVariant as EraseVariant) ?? 'both');
      break;
    case 'saveScreenshot':
      engine.captureScreenshot();
      break;
    case 'recordVideo':
      if (engine.isRecording()) {
        engine.stopRecording();
      } else {
        engine.startRecording();
      }
      break;
  }
}

export const MenuDrawer = forwardRef<MenuDrawerHandle, MenuDrawerProps>(function MenuDrawer({ engine, onAppMenu, onBrushSizeChange, hidden }, ref) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<ReturnType<typeof setupMenu> | null>(null);

  // Keep latest props in refs so stable callbacks always see current values
  const engineRef = useRef(engine);
  useEffect(() => { engineRef.current = engine; });
  const onAppMenuRef = useRef(onAppMenu);
  useEffect(() => { onAppMenuRef.current = onAppMenu; });
  const onBrushSizeChangeRef = useRef(onBrushSizeChange);
  useEffect(() => { onBrushSizeChangeRef.current = onBrushSizeChange; });

  useImperativeHandle(ref, () => ({
    open: () => menuRef.current?.open(),
    close: () => menuRef.current?.close(),
    toggle: () => {
      const ctrl = menuRef.current;
      if (!ctrl) return;
      const container = wrapperRef.current?.querySelector('#menu-container');
      if (container?.classList.contains('menu-closed')) {
        ctrl.open();
      } else {
        ctrl.close();
      }
    },
    syncBrushFromEngine: () => {
      const ctrl = menuRef.current;
      const eng = engineRef.current;
      if (!ctrl || !eng) return;
      // Engine.setBrushSize() already snaps brushSizeIndex to the nearest
      // option, so just read both fields back instead of repeating the search.
      const dm = eng.getDrawingManager();
      ctrl.setState({ brushSize: dm.getBrushSize(), brushSizeIndex: dm.getBrushSizeIndex() });
    },
  }));

  const onMenuAction = useCallback(
    (action: string, state: { brushSize: number; eraseVariant?: string; waterfallVariant?: boolean }) => {
      if (engineRef.current) {
        dispatchToEngine(engineRef.current, action, state);
      }
      if (action === 'increaseBrushSize' || action === 'decreaseBrushSize' || action === 'brushSizeChanged') {
        onBrushSizeChangeRef.current?.();
      }
    },
    [],
  );

  const onMenuAppMenu = useCallback(() => {
    onAppMenuRef.current?.();
  }, []);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const node = wrapperRef.current;
    node.innerHTML = menuHtml;

    const ctrl = setupMenu({
      onAction: onMenuAction,
      onAppMenu: onMenuAppMenu,
    });
    menuRef.current = ctrl;
    return () => {
      ctrl?.destroy();
      menuRef.current = null;
      node.innerHTML = '';
    };
  }, [onMenuAction, onMenuAppMenu]);

  // Sync engine state into menu when engine changes or menu becomes visible
  useEffect(() => {
    if (!engine || !menuRef.current || hidden) return;
    const dm = engine.getDrawingManager();
    menuRef.current.setState({
      brushSizeOptions: dm.getBrushSizeOptions(),
      brushSizeIndex: dm.getBrushSizeIndex(),
      brushSize: dm.getBrushSize(),
      waterfallVariant: engine.getWaterfallVariant(),
      manualMode: engine.isManualMode(),
    });
  }, [engine, hidden]);

  // Show/hide action bar via controller when overlay toggles
  useEffect(() => {
    if (!menuRef.current) return;
    if (hidden) {
      menuRef.current.hide();
    } else {
      menuRef.current.show();
    }
  }, [hidden]);

  return <div ref={wrapperRef} />;
});
