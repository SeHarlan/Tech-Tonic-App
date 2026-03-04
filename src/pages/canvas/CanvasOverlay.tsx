import { MenuButton } from '../../components/ui/MenuButton';
import { WalletButton } from '../../components/ui/WalletButton';
import { useNavigate } from 'react-router';
import { cn } from '../../utils/ui-helpers';
import './canvas-overlay.css';

interface CanvasOverlayProps {
  canvasBottom: number;
  onClose: () => void;
}

export function CanvasOverlay({ canvasBottom, onClose }: CanvasOverlayProps) {
  const navigate = useNavigate();

  return (
    <div className={cn('canvas-overlay', 'fixed inset-0 z-[600] flex items-end justify-center overflow-hidden')} onClick={onClose}>
      <span className="canvas-overlay-glitch canvas-overlay-glitch-a" />
      <span className="canvas-overlay-glitch canvas-overlay-glitch-b" />
      <span className="canvas-overlay-glitch canvas-overlay-glitch-c" />
      <div
        className={cn('canvas-overlay-menu', 'absolute inset-x-0 flex flex-row items-center justify-center gap-6 z-[1]')}
        style={{ top: canvasBottom, bottom: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuButton onClick={onClose}>Close</MenuButton>
        <WalletButton />
        <MenuButton onClick={() => navigate('/mint')}>Mint</MenuButton>
      </div>
    </div>
  );
}
