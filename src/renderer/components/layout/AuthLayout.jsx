import * as React from 'react';
import { cn } from '../../lib/utils';

export function AuthLayout({ children, title, subtitle }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black text-primary tracking-tight">POSLY</h1>
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
