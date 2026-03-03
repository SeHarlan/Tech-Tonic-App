import '../engine/ui/menu.css';

interface MenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function MenuButton({ active, children, className, ...props }: MenuButtonProps) {
  return (
    <button
      className={`menu-btn${active ? ' active' : ''}${className ? ' ' + className : ''}`}
      style={{ width: 'auto', padding: '0 24px' }}
      {...props}
    >
      <span className="icon">{children}</span>
    </button>
  );
}
