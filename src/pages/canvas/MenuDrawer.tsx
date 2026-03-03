import { useEffect, useCallback, useImperativeHandle, useRef, forwardRef } from 'react';
import type { Engine } from '../../engine/renderer';
import type { EraseVariant } from '../../engine/types';
import { setupMenu } from '../../engine/ui/menu';
import '../../engine/ui/menu.css';
import menuHtml from '../../engine/ui/menu.html?raw';

export interface MenuDrawerHandle {
  close: () => void;
}

export interface MenuDrawerProps {
  engine: Engine | null;
  onAppMenu?: () => void;
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
      engine.setEraseVariant('movement');
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
      engine.setEraseVariant('paint');
      break;

    // Global
    case 'toggleManualMode':
      engine.setManualMode(!engine.isManualMode());
      break;
    case 'globalReset':
      engine.forceReset();
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
    case 'newSeed':
      engine.setSeed(Math.floor(Math.random() * 1000));
      break;
  }
}

export const MenuDrawer = forwardRef<MenuDrawerHandle, MenuDrawerProps>(function MenuDrawer({ engine, onAppMenu, hidden }, ref) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<ReturnType<typeof setupMenu> | null>(null);

  // Keep latest props in refs so stable callbacks always see current values
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const onAppMenuRef = useRef(onAppMenu);
  onAppMenuRef.current = onAppMenu;

  useImperativeHandle(ref, () => ({
    close: () => menuRef.current?.close(),
  }));

  const onMenuAction = useCallback(
    (action: string, state: { brushSize: number; eraseVariant?: string; waterfallVariant?: boolean }) => {
      if (engineRef.current) {
        dispatchToEngine(engineRef.current, action, state);
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
  }, []);

  // Sync brush size options from engine when engine changes
  useEffect(() => {
    if (!engine || !menuRef.current) return;
    const dm = engine.getDrawingManager();
    menuRef.current.setState({
      brushSizeOptions: dm.getBrushSizeOptions(),
      brushSizeIndex: dm.getBrushSizeIndex(),
      brushSize: dm.getBrushSize(),
    });
  }, [engine]);

  return <div ref={wrapperRef} style={hidden ? { visibility: 'hidden' } : undefined} />;
});
