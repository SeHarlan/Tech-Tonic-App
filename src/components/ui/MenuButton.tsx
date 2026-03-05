import { cn } from '../../utils/ui-helpers';

type MenuButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function MenuButton({ children, className, disabled, ...props }: MenuButtonProps) {
  return (
    <button
      disabled={disabled}
      className={cn(
        "flex shrink-0 items-center justify-center px-4 py-1",
        "border text-lg transition-all duration-100 ease-in-out",
        disabled
          ? "cursor-default border-[rgba(0,255,128,0.15)] bg-[rgba(0,8,4,0.75)] text-[rgba(0,255,128,0.5)] shadow-none"
          : "cursor-pointer border-[rgba(0,255,128,0.35)] bg-[rgba(0,8,4,0.9)] text-[rgba(0,255,128,0.9)] hover:border-[rgba(0,255,128,0.7)] hover:bg-[rgba(0,40,20,0.95)] active:scale-95 active:bg-[rgba(0,60,30,0.95)]",
        className,
      )}
      {...props}
      title={disabled ? "SKR payment is not available in demo mode" : undefined}
    >
      {children}
    </button>
  );
}
