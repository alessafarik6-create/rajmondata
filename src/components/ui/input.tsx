import * as React from "react"

import { cn } from "@/lib/utils"
import { LIGHT_FORM_CONTROL_CLASS } from "@/lib/light-form-control-classes"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(LIGHT_FORM_CONTROL_CLASS, className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
