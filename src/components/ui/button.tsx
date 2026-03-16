import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-70 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/95 active:text-primary-foreground focus-visible:ring-primary/80 disabled:text-primary-foreground/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground active:bg-destructive/95 active:text-destructive-foreground focus-visible:ring-destructive/80 disabled:text-destructive-foreground/90",
        outline:
          "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent/90 active:text-accent-foreground focus-visible:ring-ring disabled:text-muted-foreground",
        outlineLight:
          "border border-slate-200 bg-white text-slate-800 hover:bg-slate-100 hover:text-slate-900 hover:border-slate-300 active:bg-slate-200 active:text-slate-900 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:text-slate-500 disabled:opacity-70",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/90 hover:text-secondary-foreground active:bg-secondary/95 active:text-secondary-foreground focus-visible:ring-secondary/80 disabled:text-secondary-foreground/90",
        ghost:
          "text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent/90 active:text-accent-foreground focus-visible:ring-ring disabled:text-muted-foreground",
        link:
          "text-primary underline-offset-4 hover:underline hover:text-primary/90 focus-visible:ring-primary/50 disabled:text-muted-foreground",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3",
        lg: "h-11 rounded-lg px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
