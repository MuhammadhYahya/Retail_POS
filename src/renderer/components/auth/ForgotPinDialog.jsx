import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';

const PIN_REGEX = /^[0-9]{4}$/;
const inputClass =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

const EMPTY = {
  answer1: '',
  answer2: '',
  code: '',
  newPin: '',
  confirmPin: '',
};

export default function ForgotPinDialog({ open, onOpenChange, username }) {
  const [mode, setMode] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [filePath, setFilePath] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeRequested, setCodeRequested] = useState(false);

  useEffect(() => {
    if (!open || !username) return;

    let cancelled = false;

    const load = async () => {
      setError('');
      setSuccess('');
      setForm(EMPTY);
      setMode(null);
      setCodeRequested(false);
      setLoading(true);

      const response = await window.electronAPI.invoke('auth:getRecoveryInfo', { username });
      if (cancelled) return;

      setLoading(false);

      if (!response.success) {
        setError(response.error || 'Recovery unavailable.');
        return;
      }

      setMode(response.data.mode);
      if (response.data.mode === 'questions') {
        setQuestions(response.data.questions || []);
      } else {
        setFilePath(response.data.filePath || '');
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [open, username]);

  const handlePinChange = (field, value) => {
    const digitsOnly = value.replace(/\D/g, '').slice(0, 4);
    setForm((prev) => ({ ...prev, [field]: digitsOnly }));
  };

  const requestCode = async () => {
    setError('');
    setSuccess('');
    setLoading(true);
    const response = await window.electronAPI.invoke('auth:requestEmergencyReset', { username });
    setLoading(false);

    if (response.success) {
      setCodeRequested(true);
      setFilePath(response.data.filePath);
      setSuccess('Recovery code written to the file on this PC. Open it and enter the code below.');
    } else {
      setError(response.error || 'Failed to create recovery code.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!PIN_REGEX.test(form.newPin)) {
      setError('PIN must be exactly 4 numeric digits.');
      return;
    }

    if (form.newPin !== form.confirmPin) {
      setError('PINs do not match.');
      return;
    }

    setLoading(true);

    let response;
    if (mode === 'questions') {
      response = await window.electronAPI.invoke('auth:resetAdminPin', {
        username,
        answer1: form.answer1,
        answer2: form.answer2,
        newPin: form.newPin,
        confirmPin: form.confirmPin,
      });
    } else {
      response = await window.electronAPI.invoke('auth:confirmEmergencyReset', {
        username,
        code: form.code,
        newPin: form.newPin,
        confirmPin: form.confirmPin,
      });
    }

    setLoading(false);

    if (response.success) {
      setSuccess('PIN updated. You can sign in with your new PIN.');
      setTimeout(() => onOpenChange(false), 1200);
    } else {
      setError(response.error || 'Failed to reset PIN.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Forgot PIN</DialogTitle>
          <DialogDescription>
            Reset the admin PIN for <span className="font-medium text-foreground">{username}</span>.
          </DialogDescription>
        </DialogHeader>

        {loading && !mode ? (
          <p className="text-sm text-muted-foreground">Loading recovery options...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert>
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            {mode === 'questions' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2">{questions[0]}</label>
                  <input
                    className={inputClass}
                    value={form.answer1}
                    onChange={(e) => setForm({ ...form, answer1: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">{questions[1]}</label>
                  <input
                    className={inputClass}
                    value={form.answer2}
                    onChange={(e) => setForm({ ...form, answer2: e.target.value })}
                    autoComplete="off"
                  />
                </div>
              </>
            )}

            {mode === 'emergency' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  No security questions are set yet. A one-time code will be written to a file on this computer.
                </p>
                {filePath && (
                  <p className="text-xs break-all rounded-lg bg-muted/50 p-3 font-mono">{filePath}</p>
                )}
                <Button type="button" variant="outline" onClick={requestCode} disabled={loading}>
                  {codeRequested ? 'Request new code' : 'Generate recovery code'}
                </Button>
                <div>
                  <label htmlFor="emergency-code" className="block text-sm font-medium mb-2">
                    6-digit code from file
                  </label>
                  <input
                    id="emergency-code"
                    className={inputClass}
                    inputMode="numeric"
                    maxLength={6}
                    value={form.code}
                    onChange={(e) =>
                      setForm({ ...form, code: e.target.value.replace(/\D/g, '').slice(0, 6) })
                    }
                  />
                </div>
              </div>
            )}

            {mode && (
              <>
                <div>
                  <label htmlFor="forgot-new-pin" className="block text-sm font-medium mb-2">
                    New PIN (4 digits)
                  </label>
                  <input
                    id="forgot-new-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    className={`${inputClass} tracking-widest`}
                    value={form.newPin}
                    onChange={(e) => handlePinChange('newPin', e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="forgot-confirm-pin" className="block text-sm font-medium mb-2">
                    Confirm new PIN
                  </label>
                  <input
                    id="forgot-confirm-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    className={`${inputClass} tracking-widest`}
                    value={form.confirmPin}
                    onChange={(e) => handlePinChange('confirmPin', e.target.value)}
                  />
                </div>
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading || !mode}>
                {loading ? 'Saving...' : 'Reset PIN'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
