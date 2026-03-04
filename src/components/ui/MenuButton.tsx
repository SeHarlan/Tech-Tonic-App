import { cn } from '../../utils/ui-helpers';

type MenuButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function MenuButton({ children, className, ...props }: MenuButtonProps) {
  return (
    <button
      className={cn(
        'flex shrink-0 items-center justify-center px-4 py-1',
        'cursor-pointer border text-lg transition-all duration-100 ease-in-out',
        'border-[rgba(0,255,128,0.35)] bg-[rgba(0,8,4,0.9)] text-[rgba(0,255,128,0.9)]',
        'hover:border-[rgba(0,255,128,0.7)] hover:bg-[rgba(0,40,20,0.95)]',
        'active:scale-95 active:bg-[rgba(0,60,30,0.95)]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
