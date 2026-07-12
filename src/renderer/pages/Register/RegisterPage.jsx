import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AuthLayout, AuthCard } from '../../components/layout/AuthLayout';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  SecurityQuestionsFields,
  ContactFields,
  EMPTY_SECURITY_FORM,
} from '../../components/auth/SecurityQuestionsFields';

const PIN_REGEX = /^[0-9]{4}$/;

export default function RegisterPage() {
  const navigate = useNavigate();
  const [context, setContext] = useState(null);
  const [form, setForm] = useState({
    username: '',
    pin: '',
    confirmPin: '',
    ...EMPTY_SECURITY_FORM,
  });
  const [loading, setLoading] = useState(false);
  const [loadingContext, setLoadingContext] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadContext = async () => {
      setLoadingContext(true);
      try {
        const response = await window.electronAPI.invoke('auth:getRegistrationContext');
        if (response.success) {
          setContext(response.data);
        } else {
          setError(response.error || 'Failed to load registration settings');
        }
      } catch (err) {
        console.error(err);
        setError('Failed to load registration settings');
      } finally {
        setLoadingContext(false);
      }
    };
    loadContext();
  }, []);

  const isBootstrap = context?.mode === 'bootstrap';
  const role = isBootstrap ? 'admin' : 'cashier';
  const title = isBootstrap ? 'Set Up Admin Account' : 'Create Cashier Account';
  const subtitle = isBootstrap
    ? 'Create the first administrator account to get started.'
    : 'Register as a cashier with limited system access.';
  const securityQuestions = context?.securityQuestions || [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.username.trim()) {
      setError('Username is required');
      return;
    }

    if (!PIN_REGEX.test(form.pin)) {
      setError('PIN must be exactly 4 numeric digits');
      return;
    }

    if (form.pin !== form.confirmPin) {
      setError('PINs do not match');
      return;
    }

    if (isBootstrap) {
      if (!form.securityQ1 || !form.securityQ2 || !form.securityA1.trim() || !form.securityA2.trim()) {
        setError('Please complete both security questions and answers.');
        return;
      }
      if (form.securityQ1 === form.securityQ2) {
        setError('Choose two different security questions.');
        return;
      }
    }

    setLoading(true);

    try {
      const payload = {
        username: form.username.trim(),
        pin: form.pin,
        role,
      };

      if (isBootstrap) {
        Object.assign(payload, {
          securityQ1: form.securityQ1,
          securityA1: form.securityA1,
          securityQ2: form.securityQ2,
          securityA2: form.securityA2,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
        });
      }

      const response = await window.electronAPI.invoke('auth:register', payload);

      if (response.success) {
        navigate('/login');
      } else {
        setError(response.message || 'Registration failed');
      }
    } catch (err) {
      console.error(err);
      setError('Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePinChange = (field, value) => {
    const digitsOnly = value.replace(/\D/g, '').slice(0, 4);
    setForm((prev) => ({ ...prev, [field]: digitsOnly }));
  };

  if (loadingContext) {
    return (
      <AuthLayout title="Loading..." subtitle="Preparing registration">
        <AuthCard>
          <p className="text-muted-foreground text-sm text-center">Please wait...</p>
        </AuthCard>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      <AuthCard>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <label htmlFor="username" className="block text-sm font-medium mb-2">
              Username
            </label>
            <input
              id="username"
              className="w-full p-3 rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Enter username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              autoComplete="username"
            />
          </div>

          <div>
            <label htmlFor="pin" className="block text-sm font-medium mb-2">
              PIN (4 digits)
            </label>
            <input
              id="pin"
              className="w-full p-3 rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring tracking-widest"
              placeholder="••••"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={form.pin}
              onChange={(e) => handlePinChange('pin', e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label htmlFor="confirmPin" className="block text-sm font-medium mb-2">
              Confirm PIN
            </label>
            <input
              id="confirmPin"
              className="w-full p-3 rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring tracking-widest"
              placeholder="••••"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={form.confirmPin}
              onChange={(e) => handlePinChange('confirmPin', e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {isBootstrap && (
            <>
              <div className="border-t border-border pt-4">
                <p className="text-sm font-medium mb-3">Account recovery</p>
                <SecurityQuestionsFields
                  questions={securityQuestions}
                  values={form}
                  onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
                  idPrefix="register"
                />
              </div>
              <ContactFields
                values={form}
                onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
                idPrefix="register"
              />
            </>
          )}

          <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            Account type: <span className="font-medium text-foreground capitalize">{role}</span>
            {!isBootstrap && (
              <p className="mt-1 text-xs">
                Admin accounts can only be created by an existing administrator.
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? 'Creating...' : isBootstrap ? 'Create Admin Account' : 'Register as Cashier'}
          </Button>

          <p className="text-sm text-muted-foreground text-center">
            Already have an account?{' '}
            <Link to="/login" className="text-primary hover:underline font-medium">
              Back to login
            </Link>
          </p>
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
