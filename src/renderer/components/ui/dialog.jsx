import * as React from 'react';
import { cn } from '../../lib/utils';

function Dialog({ open, onOpenChange, children, dismissible = true }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/60"
        onClick={() => {
          if (dismissible) onOpenChange?.(false);
        }}
      />
      <div className="relative z-50 w-full max-w-md mx-4">{children}</div>
    </div>
  );
}

function DialogContent({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-xl p-6',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function DialogHeader({ className, ...props }) {
  return <div className={cn('mb-4', className)} {...props} />;
}

function DialogTitle({ className, ...props }) {
  return <h2 className={cn('text-lg font-semibold', className)} {...props} />;
}

function DialogDescription({ className, ...props }) {
  return <p className={cn('text-sm text-muted-foreground mt-1', className)} {...props} />;
}

function DialogFooter({ className, ...props }) {
  return <div className={cn('flex justify-end gap-3 mt-6', className)} {...props} />;
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
