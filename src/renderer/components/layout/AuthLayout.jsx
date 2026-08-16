import * as React from 'react';
import { cn } from '../../lib/utils';

export function AuthLayout({ children, title, subtitle }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-lg">
        <div className="text-center mb-7">
          <img src="./logo.png" alt="ZEN" className="mx-auto h-14 w-14 rounded-2xl object-contain shadow-sm" />
          {title && <p className="text-2xl font-bold mt-4 tracking-tight">{title}</p>}
          {subtitle && <p className="text-muted-foreground text-sm mt-2">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthCard({ children, className }) {
  return (
    <div className={cn('rounded-3xl border border-border/80 bg-card p-6 sm:p-8 shadow-[0_16px_48px_rgba(37,55,65,0.10)]', className)}>
      {children}
    </div>
  );
}
