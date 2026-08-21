import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';

const inputClassName =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

export default function ShopSettingsPanel({ form, setForm }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Shop Details</CardTitle>
        <CardDescription>Shown on receipts and invoices.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium mb-2">Shop name</label>
            <input
              className={inputClassName}
              value={form.shopName}
              onChange={(e) => setForm({ ...form, shopName: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Phone</label>
            <input
              className={inputClassName}
              value={form.shopPhone}
              onChange={(e) => setForm({ ...form, shopPhone: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Address</label>
          <input
            className={inputClassName}
            value={form.shopAddress}
            onChange={(e) => setForm({ ...form, shopAddress: e.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium mb-2">Invoice prefix</label>
            <input
              className={inputClassName}
              value={form.invoicePrefix}
              onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Currency</label>
            <input
              className={inputClassName}
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium mb-2">Receipt header</label>
            <input
              className={inputClassName}
              value={form.receiptHeader}
              onChange={(e) => setForm({ ...form, receiptHeader: e.target.value })}
              placeholder="Optional header line"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Receipt footer</label>
            <input
              className={inputClassName}
              value={form.receiptFooter}
              onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
              placeholder="Thank you for shopping"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium mb-2">Return within (days)</label>
            <input
              type="number"
              min="1"
              step="1"
              className={inputClassName}
              value={form.returnWithinDays}
              onChange={(e) => setForm({ ...form, returnWithinDays: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Returns accepted within {form.returnWithinDays || 7} days.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
