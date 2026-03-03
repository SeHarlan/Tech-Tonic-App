import { cn } from '../../utils/ui-helpers';
import '../../engine/ui/menu.css';

interface MenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function MenuButton({ active, children, className, ...props }: MenuButtonProps) {
  return (
    <button
      className={cn('menu-btn', active && 'active', className)}
      style={{ width: 'auto', padding: '0 24px' }}
      {...props}
    >
      <span className="icon">{children}</span>
    </button>
  );
}
