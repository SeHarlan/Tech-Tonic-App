import { MenuButton } from '../../components/ui/MenuButton';
import { useNavigate } from 'react-router';
import './canvas-overlay.css';

interface CanvasOverlayProps {
  canvasBottom: number;
  onClose: () => void;
}

export function CanvasOverlay({ canvasBottom, onClose }: CanvasOverlayProps) {
  const navigate = useNavigate();

  return (
    <div className="canvas-overlay" onClick={onClose}>
      <span className="canvas-overlay-glitch canvas-overlay-glitch-a" />
      <span className="canvas-overlay-glitch canvas-overlay-glitch-b" />
      <span className="canvas-overlay-glitch canvas-overlay-glitch-c" />
      <div
        className="canvas-overlay-menu"
        style={{ top: canvasBottom, bottom: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuButton onClick={onClose}>Close</MenuButton>
        <MenuButton onClick={() => navigate('/mint')}>Mint</MenuButton>
      </div>
    </div>
  );
}
