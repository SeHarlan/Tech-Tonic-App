import { useEffect, useRef } from 'react';
import type { Engine } from '../engine/renderer';
import type { EraseVariant } from '../engine/types';
import { setupMenu } from '../engine/ui/menu';
import '../engine/ui/menu.css';

export interface MenuDrawerProps {
  engine: Engine | null;
  onAppMenu?: () => void;
}

/** Map menu.js action names to Engine API calls. */
function dispatchToEngine(
  engine: Engine,
  action: string,
  menuState: { brushSize: number; eraseVariant?: string },
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
      engine.setWaterfallVariant(true);
      break;
    case 'waterfallDown':
      engine.setDrawMode('waterfall');
      engine.setDirection('down');
      engine.setWaterfallVariant(true);
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

export function MenuDrawer({ engine, onAppMenu }: MenuDrawerProps) {
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const onAppMenuRef = useRef(onAppMenu);
  onAppMenuRef.current = onAppMenu;

  const menuRef = useRef<ReturnType<typeof setupMenu> | null>(null);

  useEffect(() => {
    const ctrl = setupMenu({
      onAction(action, state) {
        if (engineRef.current) {
          dispatchToEngine(engineRef.current, action, state);
        }
      },
      onAppMenu() {
        onAppMenuRef.current?.();
      },
    });
    menuRef.current = ctrl;
    return () => {
      ctrl?.destroy();
      menuRef.current = null;
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

  return (
    <div
      id="menu-container"
      className="menu-closed"
    >
      {/* Drawer handle (visible when closed) */}
      <div id="drawer-handle">
        <div className="drawer-handle-bar" />
        <div className="drawer-handle-bar" />
      </div>

      {/* Close handle (visible when open) */}
      <div id="close-handle" data-action="closeMenu" title="Close Menu">
        <svg className="close-handle-chevron" viewBox="0 0 40 10" xmlns="http://www.w3.org/2000/svg">
          <polyline
            points="4,2 20,8 36,2"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Menu Panel */}
      <div id="menu-panel">
        <div className="main-row">

          {/* Brush Size Column */}
          <div className="brush-column">
            <div className="section-label">Size</div>
            <button className="menu-btn" data-action="increaseBrushSize" title="Increase brush size ([)">
              <span className="icon">∧</span>
            </button>
            <div className="brush-size-display" title="Drag to adjust brush size">
              <div className="drag-chevrons up">
                <span>›</span>
                <span>›</span>
              </div>
              <div className="brush-size-display-inner">
                <div className="brush-preview" />
                <span className="brush-size-label">1</span>
              </div>
              <div className="drag-chevrons down">
                <span>›</span>
                <span>›</span>
              </div>
            </div>
            <button className="menu-btn" data-action="decreaseBrushSize" title="Decrease brush size (])">
              <span className="icon">∨</span>
            </button>
          </div>

          {/* Movement Section */}
          <div className="movement-section">
            {/* Global Buttons Row */}
            <div className="global-row">
              <button className="menu-btn" id="btn-manual-mode" data-action="toggleManualMode" title="Toggle Manual Mode (X)">
                <span className="icon">✎</span>
              </button>
              <button className="menu-btn" id="btn-global-reset" data-action="globalReset" title="Global Reset">
                <span className="icon">⟲</span>
              </button>
              <button className="menu-btn" id="btn-app-menu" data-action="openAppMenu" title="Menu">
                <span className="icon">☰</span>
              </button>
            </div>

            <div className="section-label">Movement</div>
            <div className="cross-container">
              {/* Row 1 */}
              <button className="menu-btn" data-action="trickle" title="Trickle (T)">
                <span className="icon" style={{ display: 'inline-block', transform: 'rotate(90deg)' }}>≈</span>
              </button>
              <button className="menu-btn arrow-btn" data-action="waterfallUp" title="Waterfall Up (↑)">
                <span className="icon">⤊</span>
              </button>
              <button className="menu-btn" data-action="shuffle" title="Shuffle (S)">
                <span className="icon">≈</span>
              </button>
              {/* Row 2 */}
              <button className="menu-btn arrow-btn" data-action="moveLeft" title="Move Left (←)">
                <span className="icon">←</span>
              </button>
              <button className="menu-btn" id="btn-pause" data-action="toggleGlobalFreeze" title="Pause (Space)">
                <span className="icon">⏸︎</span>
              </button>
              <button className="menu-btn arrow-btn" data-action="moveRight" title="Move Right (→)">
                <span className="icon">→</span>
              </button>
              {/* Row 3 */}
              <button className="menu-btn" data-action="eraseMovement" title="Erase Movement (E cycles erase)">
                <span className="icon">⌫</span>
              </button>
              <button className="menu-btn arrow-btn" data-action="waterfallDown" title="Waterfall Down (↓)">
                <span className="icon">⤋</span>
              </button>
              <button className="menu-btn" data-action="freezeBrush" title="Freeze Movement (F)">
                <span className="icon">❄︎</span>
              </button>
            </div>
          </div>

          {/* Paint Section */}
          <div className="paint-section">
            <div className="section-label">Paint</div>
            <div className="paint-column">
              <button className="menu-btn" data-action="drawSpace" title="Space (O)">
                <span className="icon">○</span>
              </button>
              <button className="menu-btn" data-action="drawGem" title="Gem (G)">
                <span className="icon">◆</span>
              </button>
              <button className="menu-btn" data-action="drawStatic" title="Static (D)">
                <span className="icon">⁘</span>
              </button>
              <button className="menu-btn" data-action="resetInitialMovement" title="Erase Paint (E cycles erase)">
                <span className="icon">↺</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
