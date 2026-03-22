import * as React from 'react';

import {cn} from '@/lib/utils';
import { LIGHT_FORM_CONTROL_CLASS } from '@/lib/light-form-control-classes';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({className, ...props}, ref) => {
    return (
      <textarea
        className={cn(
          LIGHT_FORM_CONTROL_CLASS,
          'min-h-[80px] resize-y',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export {Textarea};
