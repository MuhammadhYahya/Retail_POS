import React from 'react';
import AppShell from '../../components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { ShoppingCart, Receipt, Clock } from 'lucide-react';

export default function CashierDashboard() {
  return (
    <AppShell title="POS Terminal" description="Ready to process sales.">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="opacity-60">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/15">
                <ShoppingCart className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">New Sale</CardTitle>
            </div>
            <CardDescription>Start a new transaction at the register.</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-xs text-muted-foreground">Coming soon</span>
          </CardContent>
        </Card>

        <Card className="opacity-60">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/15">
                <Receipt className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Recent Orders</CardTitle>
            </div>
            <CardDescription>View your recent transactions.</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-xs text-muted-foreground">Coming soon</span>
          </CardContent>
        </Card>

        <Card className="opacity-60">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/15">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Shift Summary</CardTitle>
            </div>
            <CardDescription>Track your current shift activity.</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-xs text-muted-foreground">Coming soon</span>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
