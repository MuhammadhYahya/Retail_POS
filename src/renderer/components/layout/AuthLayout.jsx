import * as React from 'react';
import { cn } from '../../lib/utils';

export function AuthLayout({ children, title, subtitle }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="ZEN" className="mx-auto h-16 w-auto object-contain" />
          {title && <p className="text-xl font-semibold mt-4">{title}</p>}
          {subtitle && <p className="text-muted-foreground text-sm mt-2">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthCard({ children, className }) {
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-8 shadow-lg', className)}>
      {children}
    </div>
  );
}
