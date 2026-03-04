// import { useState, useRef, useCallback } from 'react';
// import { createPortal } from 'react-dom';
import { MenuButton } from '../../components/ui/MenuButton';
import { WalletButton } from '../../components/ui/WalletButton';
import { useNavigate } from 'react-router';
import { cn } from '../../utils/ui-helpers';
import type { Engine } from '../../engine/renderer';
import './canvas-overlay.css';
// import { ImageSquareIcon } from '@phosphor-icons/react';

interface CanvasOverlayProps {
  canvasBottom: number;
  onClose: () => void;
  engine: Engine | null;
}

// const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// function ImportImageModal({ onClose, engine }: { onClose: () => void; engine: Engine }) {
//   const [dragging, setDragging] = useState(false);
//   const inputRef = useRef<HTMLInputElement>(null);

//   const loadFile = useCallback((file: File) => {
//     if (!ACCEPTED_TYPES.includes(file.type)) return;
//     const url = URL.createObjectURL(file);
//     const img = new Image();
//     img.onload = () => {
//       engine.loadMovementBuffer(img);
//       URL.revokeObjectURL(url);
//       onClose();
//     };
//     img.onerror = () => URL.revokeObjectURL(url);
//     img.src = url;
//   }, [engine, onClose]);

//   const onDrop = useCallback((e: React.DragEvent) => {
//     e.preventDefault();
//     setDragging(false);
//     const file = e.dataTransfer.files[0];
//     if (file) loadFile(file);
//   }, [loadFile]);

//   const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
//     const file = e.target.files?.[0];
//     if (file) loadFile(file);
//   }, [loadFile]);

//   return createPortal(
//     <div
//       className="fixed inset-0 z-200 flex items-center justify-center p-6 bg-black/60 box-border"
//       onClick={onClose}
//     >
//       <div
//         className={cn('wallet-picker', 'relative max-h-[80vh] max-w-full min-w-[280px] w-[320px] overflow-hidden')}
//         onClick={(e) => e.stopPropagation()}
//       >
//         <span className={cn('wallet-picker-scanlines', 'absolute inset-0 overflow-hidden pointer-events-none z-2')} />
//         <div className="relative z-1 flex flex-col gap-5 items-center py-9 px-4">
//           <h2 className={cn('wallet-picker-title', 'text-[1.1em] tracking-[0.12em] uppercase m-0')}>
//             Import Image
//           </h2>
//           <div
//             className={cn(
//               'import-dropzone',
//               'w-full h-40 flex items-center justify-center cursor-pointer transition-colors',
//               dragging && 'import-dropzone-active',
//             )}
//             onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
//             onDragLeave={() => setDragging(false)}
//             onDrop={onDrop}
//             onClick={() => inputRef.current?.click()}
//           >
//             <span className="import-dropzone-text text-sm uppercase tracking-wide pointer-events-none">
//               {dragging ? 'Drop image' : 'Drop image or click to browse'}
//             </span>
//             <input
//               ref={inputRef}
//               type="file"
//               accept={ACCEPTED_TYPES.join(',')}
//               className="hidden"
//               onChange={onFileChange}
//             />
//           </div>
//           <MenuButton onClick={onClose}>Cancel</MenuButton>
//         </div>
//       </div>
//     </div>,
//     document.body,
//   );
// }

export function CanvasOverlay({ canvasBottom, onClose }: CanvasOverlayProps) {
  const navigate = useNavigate();
  // const [showImport, setShowImport] = useState(false);

  return (
    <div
      className={cn(
        "canvas-overlay",
        "fixed inset-0 z-50 flex items-end justify-center overflow-hidden",
      )}
      onClick={onClose}
    >
      <span className="canvas-overlay-glitch canvas-overlay-glitch-a" />
      <span className="canvas-overlay-glitch canvas-overlay-glitch-b" />
      <span className="canvas-overlay-glitch canvas-overlay-glitch-c" />

      {/* {engine && (
        <MenuButton
          className="absolute top-4 left-4 z-10 p-2 "
          onClick={(e) => {
            e.stopPropagation();
            setShowImport(true);
          }}
        >
          <ImageSquareIcon size={24} weight="bold" />
        </MenuButton>
      )} */}

      <div
        className={cn(
          "canvas-overlay-menu",
          "absolute inset-x-0 flex flex-row items-center justify-center gap-6 z-1",
        )}
        style={{ top: canvasBottom, bottom: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuButton onClick={onClose}>Close</MenuButton>
        <WalletButton />
        <MenuButton onClick={() => navigate("/mint")}>Mint</MenuButton>
      </div>

      {/* {showImport && engine && (
        <ImportImageModal
          onClose={() => setShowImport(false)}
          engine={engine}
        />
      )} */}
    </div>
  );
}
