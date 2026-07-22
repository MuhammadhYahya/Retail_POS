import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, UserPlus, Shield, LockOpen, KeyRound } from 'lucide-react';
import AppShell from '../../components/layout/AppShell';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { invokeWithAuth } from '../../lib/ipc';
import { useAuthStore } from '../../store/authStore';
import {
  SecurityQuestionsFields,
  ContactFields,
  EMPTY_SECURITY_FORM,
  CUSTOM_QUESTION_VALUE,
} from '../../components/auth/SecurityQuestionsFields';

const PIN_REGEX = /^[0-9]{4}$/;

function resolveQuestion(choice, customQuestion) {
  return choice === CUSTOM_QUESTION_VALUE ? customQuestion.trim() : choice;
}

const EMPTY_FORM = {
  username: '',
  displayName: '',
  pin: '',
  confirmPin: '',
  role: 'cashier',
  ...EMPTY_SECURITY_FORM,
};

const EMPTY_RESET = {
  newPin: '',
  confirmPin: '',
};

export default function StaffManagement() {
  const currentUser = useAuthStore((state) => state.user);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [resetForm, setResetForm] = useState(EMPTY_RESET);
  const [formError, setFormError] = useState('');
  const [resetError, setResetError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [securityQuestions, setSecurityQuestions] = useState([]);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    setError('');
    const response = await invokeWithAuth('user:getAll');
    if (response.success) {
      setStaff(response.data);
    } else {
      setError(response.error || 'Failed to load staff');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  useEffect(() => {
    const loadQuestions = async () => {
      const response = await window.electronAPI.invoke('auth:getSecurityQuestions');
      if (response.success) {
        setSecurityQuestions(response.data);
      }
    };
    loadQuestions();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!form.username.trim()) {
      setFormError('Username is required');
      return;
    }

    if (!PIN_REGEX.test(form.pin)) {
      setFormError('PIN must be exactly 4 numeric digits');
      return;
    }

    if (form.pin !== form.confirmPin) {
      setFormError('PINs do not match');
      return;
    }

    if (form.role === 'admin') {
      const resolvedQ1 = resolveQuestion(form.securityQ1Choice, form.securityQ1Custom);
      const resolvedQ2 = resolveQuestion(form.securityQ2Choice, form.securityQ2Custom);

      if (!resolvedQ1 || !resolvedQ2 || !form.securityA1.trim() || !form.securityA2.trim()) {
        setFormError('Please complete both security questions and answers for admin accounts.');
        return;
      }
      if (resolvedQ1.trim().toLowerCase() === resolvedQ2.trim().toLowerCase()) {
        setFormError('Choose two different security questions.');
        return;
      }
    }

    setSubmitting(true);
    const payload = {
      username: form.username.trim(),
      displayName: form.displayName.trim() || form.username.trim(),
      pin: form.pin,
      role: form.role,
    };

    if (form.role === 'admin') {
      const resolvedQ1 = resolveQuestion(form.securityQ1Choice, form.securityQ1Custom);
      const resolvedQ2 = resolveQuestion(form.securityQ2Choice, form.securityQ2Custom);

      Object.assign(payload, {
        securityQ1: resolvedQ1,
        securityA1: form.securityA1,
        securityQ2: resolvedQ2,
        securityA2: form.securityA2,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
      });
    }

    const response = await invokeWithAuth('user:create', payload);
    setSubmitting(false);

    if (response.success) {
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      fetchStaff();
    } else {
      setFormError(response.error || 'Failed to create user');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    const response = await invokeWithAuth('user:delete', { userId: deleteTarget.id });
    setSubmitting(false);

    if (response.success) {
      setDeleteTarget(null);
      fetchStaff();
    } else {
      setError(response.error || 'Failed to delete user');
      setDeleteTarget(null);
    }
  };

  const handleUnlock = async (userId) => {
    setError('');
    const response = await invokeWithAuth('user:unlock', { userId });
    if (response.success) {
      fetchStaff();
    } else {
      setError(response.error || 'Failed to unlock account');
    }
  };

  const handleResetPin = async (e) => {
    e.preventDefault();
    setResetError('');

    if (!PIN_REGEX.test(resetForm.newPin)) {
      setResetError('PIN must be exactly 4 numeric digits');
      return;
    }

    if (resetForm.newPin !== resetForm.confirmPin) {
      setResetError('PINs do not match');
      return;
    }

    setSubmitting(true);
    const response = await invokeWithAuth('user:resetPin', {
      userId: resetTarget.id,
      newPin: resetForm.newPin,
    });
    setSubmitting(false);

    if (response.success) {
      setResetTarget(null);
      setResetForm(EMPTY_RESET);
      fetchStaff();
    } else {
      setResetError(response.error || 'Failed to reset PIN');
    }
  };

  const handlePinChange = (field, value) => {
    const digitsOnly = value.replace(/\D/g, '').slice(0, 4);
    setForm((prev) => ({ ...prev, [field]: digitsOnly }));
  };

  const handleResetPinChange = (field, value) => {
    const digitsOnly = value.replace(/\D/g, '').slice(0, 4);
    setResetForm((prev) => ({ ...prev, [field]: digitsOnly }));
  };

  return (
    <AppShell title="Staff Management" description="Create and manage staff accounts.">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">
            {staff.length} staff member{staff.length !== 1 ? 's' : ''}
          </p>
          <Button onClick={() => { setForm(EMPTY_FORM); setFormError(''); setCreateOpen(true); }}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add Staff Member
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="border border-border rounded-xl bg-card overflow-hidden">
          {loading ? (
            <p className="p-8 text-center text-muted-foreground text-sm">Loading staff...</p>
          ) : staff.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground text-sm">
              No staff members yet. Add your first team member to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((user) => {
                  const isLocked = user.failed_attempts >= 5;
                  const isSelf = user.id === currentUser?.id;

                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.display_name || user.username}
                      </TableCell>
                      <TableCell>{user.username}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                            user.role === 'admin'
                              ? 'bg-primary/15 text-primary'
                              : user.role === 'manager'
                                ? 'bg-amber-500/15 text-amber-600'
                                : 'bg-blue-500/15 text-blue-400'
                          }`}
                        >
                          {(user.role === 'admin' || user.role === 'manager') && <Shield className="h-3 w-3" />}
                          {user.role}
                        </span>
                      </TableCell>
                      <TableCell>
                        {isLocked ? (
                          <span className="text-destructive text-sm font-medium">Locked</span>
                        ) : (
                          <span className={user.is_active ? 'text-green-500' : 'text-muted-foreground'}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {(user.role === 'cashier' || user.role === 'manager') && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setResetTarget(user);
                                setResetForm(EMPTY_RESET);
                                setResetError('');
                              }}
                              title="Reset PIN"
                            >
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          )}
                          {isLocked && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleUnlock(user.id)}
                              title="Unlock account"
                            >
                              <LockOpen className="h-4 w-4" />
                            </Button>
                          )}
                          {!isSelf && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setDeleteTarget(user)}
                              title="Remove staff member"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Staff Member</DialogTitle>
            <DialogDescription>
              Create a new cashier or admin account.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div>
              <label htmlFor="create-username" className="block text-sm font-medium mb-2">
                Username
              </label>
              <input
                id="create-username"
                className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>

            <div>
              <label htmlFor="create-displayName" className="block text-sm font-medium mb-2">
                Display Name <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                id="create-displayName"
                className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>

            <div>
              <label htmlFor="create-pin" className="block text-sm font-medium mb-2">
                PIN (4 digits)
              </label>
              <input
                id="create-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring tracking-widest"
                value={form.pin}
                onChange={(e) => handlePinChange('pin', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="create-confirmPin" className="block text-sm font-medium mb-2">
                Confirm PIN
              </label>
              <input
                id="create-confirmPin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring tracking-widest"
                value={form.confirmPin}
                onChange={(e) => handlePinChange('confirmPin', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="create-role" className="block text-sm font-medium mb-2">
                Role
              </label>
              <select
                id="create-role"
                className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {form.role === 'admin' && (
              <>
                <div className="border-t border-border pt-4">
                  <p className="text-sm font-medium mb-3">Admin recovery</p>
                  <SecurityQuestionsFields
                    questions={securityQuestions}
                    values={form}
                    onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
                    idPrefix="create"
                  />
                </div>
                <ContactFields
                  values={form}
                  onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
                  idPrefix="create"
                />
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Account'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Cashier PIN</DialogTitle>
            <DialogDescription>
              Set a new PIN for{' '}
              <span className="font-medium text-foreground">
                {resetTarget?.display_name || resetTarget?.username}
              </span>
              .
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetPin} className="space-y-4">
            {resetError && (
              <Alert variant="destructive">
                <AlertDescription>{resetError}</AlertDescription>
              </Alert>
            )}

            <div>
              <label htmlFor="reset-new-pin" className="block text-sm font-medium mb-2">
                New PIN (4 digits)
              </label>
              <input
                id="reset-new-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring tracking-widest"
                value={resetForm.newPin}
                onChange={(e) => handleResetPinChange('newPin', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="reset-confirm-pin" className="block text-sm font-medium mb-2">
                Confirm PIN
              </label>
              <input
                id="reset-confirm-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                className="w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring tracking-widest"
                value={resetForm.confirmPin}
                onChange={(e) => handleResetPinChange('confirmPin', e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResetTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : 'Reset PIN'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Staff Member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{' '}
              <span className="font-medium text-foreground">
                {deleteTarget?.display_name || deleteTarget?.username}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
              {submitting ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
