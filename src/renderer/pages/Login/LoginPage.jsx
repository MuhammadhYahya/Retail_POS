import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Shield, UserCircle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { getDashboardPath } from '../../lib/ipc';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import ForgotPinDialog from '../../components/auth/ForgotPinDialog';

const KEYPAD_NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

function KeypadButton({ value, onClick, variant = 'default', disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`
        h-20 rounded-xl text-xl font-bold
        flex items-center justify-center transition-all
        active:scale-95 select-none disabled:opacity-50
        ${variant === 'primary'
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-muted text-foreground hover:bg-muted/80'
        }
      `}
    >
      {value}
    </button>
  );
}

function RoleIcon({ role }) {
  if (role === 'admin') return <Shield className="h-5 w-5 text-primary" />;
  return <User className="h-5 w-5 text-muted-foreground" />;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const setLogin = useAuthStore((state) => state.setLogin);

  const [selectedUser, setSelectedUser] = useState(null);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [registrationContext, setRegistrationContext] = useState(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [forgotOpen, setForgotOpen] = useState(false);

  const selectedUserRecord = useMemo(
    () => users.find((u) => u.username === selectedUser) || null,
    [users, selectedUser]
  );

  const submitTimer = useRef(null);
  const selectedUserRef = useRef(null);
  const pinRef = useRef('');

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  useEffect(() => {
    pinRef.current = pin;
  }, [pin]);

  useEffect(() => {
    const loadUsers = async () => {
      setLoadingUsers(true);
      const [usersResult, contextResult] = await Promise.all([
        window.electronAPI.invoke('auth:getUsers'),
        window.electronAPI.invoke('auth:getRegistrationContext'),
      ]);

      if (usersResult.success) {
        setUsers(usersResult.data);
      } else {
        setError(usersResult.error || usersResult.message || 'Failed to load users');
      }

      if (contextResult.success) {
        setRegistrationContext(contextResult.data);
      }
      setLoadingUsers(false);
    };
    loadUsers();
  }, []);

  const handleLogin = useCallback(async () => {
    const currentPin = pinRef.current;
    const currentUser = selectedUserRef.current;

    if (loading || forgotOpen) return;

    if (!currentUser) {
      setError('Please select a user');
      return;
    }

    if (currentPin.length !== 4) {
      setError('Enter 4 digit PIN');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await window.electronAPI.invoke('auth:login', {
        username: currentUser,
        pin: currentPin,
      });

      if (response.success) {
        setLogin(response.user, response.token);
        setPin('');
        navigate(getDashboardPath(response.user.role));
      } else {
        setError(response.error || response.message || 'Invalid PIN');
        setPin('');
      }
    } catch (err) {
      console.error('IPC Login Error:', err);
      setError('Authentication failed');
      setPin('');
    } finally {
      setLoading(false);
    }
  }, [loading, forgotOpen, navigate, setLogin]);

  const addDigit = useCallback((digit) => {
    if (loading) return;
    setPin((previous) => {
      if (previous.length >= 4) return previous;
      return previous + digit;
    });
    setError('');
  }, [loading]);

  const clearPin = useCallback(() => {
    if (loading) return;
    setPin('');
  }, [loading]);

  const deleteDigit = useCallback(() => {
    if (loading) return;
    setPin((previous) => previous.slice(0, -1));
  }, [loading]);

  useEffect(() => {
    if (pin.length === 4) {
      clearTimeout(submitTimer.current);
      submitTimer.current = setTimeout(() => {
        handleLogin();
      }, 100);
    }
    return () => clearTimeout(submitTimer.current);
  }, [pin, handleLogin]);

  useEffect(() => {
    if (forgotOpen) {
      clearTimeout(submitTimer.current);
      clearPin();
    }
  }, [forgotOpen, clearPin]);

  useEffect(() => {
    const keyboardHandler = (event) => {
      if (loading || forgotOpen) return;

      if (event.key >= '0' && event.key <= '9') {
        addDigit(event.key);
        return;
      }

      if (event.code.startsWith('Numpad') && event.key) {
        addDigit(event.key);
        return;
      }

      if (event.key === 'Backspace') {
        deleteDigit();
        return;
      }

      if (event.key === 'Escape' || event.key === 'Delete') {
        clearPin();
        return;
      }

      if (event.key === 'Enter') {
        handleLogin();
      }
    };

    window.addEventListener('keydown', keyboardHandler);
    return () => window.removeEventListener('keydown', keyboardHandler);
  }, [loading, forgotOpen, addDigit, deleteDigit, clearPin, handleLogin]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid md:grid-cols-2 gap-8">
        <div>
          <h1 className="text-5xl font-black text-primary mb-2">POSLY</h1>
          <p className="text-muted-foreground mb-4">Select User & Enter PIN</p>

          <div className="mb-8">
            {registrationContext?.mode === 'recovery' ? (
              <Button
                type="button"
                variant="ghost"
                className="text-primary hover:text-primary/80 p-0 h-auto font-medium"
                onClick={() => navigate('/register')}
              >
                Recover admin access
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="text-primary hover:text-primary/80 p-0 h-auto font-medium"
                onClick={() => navigate('/register')}
              >
                + Create New Account
              </Button>
            )}
          </div>

          {registrationContext?.mode === 'recovery' && (
            <Alert className="mb-4">
              <AlertDescription>
                No administrator account is active on this device. Use admin recovery to restore management access.
              </AlertDescription>
            </Alert>
          )}

          {loadingUsers ? (
            <p className="text-muted-foreground text-sm">Loading users...</p>
          ) : users.length === 0 ? (
            <Alert>
              <AlertDescription>
                No accounts found.{' '}
                <button
                  type="button"
                  onClick={() => navigate('/register')}
                  className="text-primary hover:underline font-medium"
                >
                  Set up your first admin account
                </button>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setSelectedUser(user.username);
                    setError('');
                  }}
                  className={`w-full p-5 rounded-xl border-2 text-left transition-all flex items-center gap-4 ${
                    selectedUser === user.username
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card hover:border-muted-foreground/30'
                  }`}
                >
                  <div className="p-2 rounded-lg bg-muted">
                    <RoleIcon role={user.role} />
                  </div>
                  <div>
                    <div className="text-lg font-semibold">
                      {user.display_name || user.username}
                    </div>
                    <div className="text-sm text-muted-foreground capitalize">{user.role}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl p-8">
          <div className="flex items-center justify-center gap-2 mb-6 text-muted-foreground">
            <UserCircle className="h-5 w-5" />
            <span className="text-sm">
              {selectedUser ? `Signing in as ${selectedUser}` : 'Select a user to continue'}
            </span>
          </div>

          <div className="flex justify-center gap-5 mb-8">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`w-5 h-5 rounded-full border-2 transition-all ${
                  pin.length > i
                    ? 'bg-primary border-primary'
                    : 'border-muted-foreground/40'
                }`}
              />
            ))}
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-3 gap-4">
            {KEYPAD_NUMBERS.map((num) => (
              <KeypadButton
                key={num}
                value={num}
                disabled={loading}
                onClick={() => addDigit(num)}
              />
            ))}

            <KeypadButton value="Clear" disabled={loading} onClick={clearPin} />
            <KeypadButton value="0" disabled={loading} onClick={() => addDigit('0')} />
            <KeypadButton
              value={loading ? '...' : 'Enter'}
              variant="primary"
              disabled={loading}
              onClick={handleLogin}
            />
          </div>

          {selectedUserRecord?.role === 'admin' && (
            <div className="mt-6 text-center">
              <Button
                type="button"
                variant="ghost"
                className="text-primary hover:text-primary/80"
                onClick={() => setForgotOpen(true)}
              >
                Forgot PIN?
              </Button>
            </div>
          )}

          {selectedUserRecord?.role === 'cashier' && (
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Forgot your PIN? Ask an admin to reset it in Staff Management.
            </p>
          )}
        </div>
      </div>

      <ForgotPinDialog
        open={forgotOpen}
        onOpenChange={setForgotOpen}
        username={selectedUser}
      />
    </div>
  );
}
