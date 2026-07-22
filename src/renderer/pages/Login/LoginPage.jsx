import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Shield, UserCircle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { getDashboardPath } from '../../lib/ipc';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import ForgotPinDialog from '../../components/auth/ForgotPinDialog';

const KEYPAD_NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

const nameToAvatar = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

function KeypadButton({ value, onClick, variant = 'default', disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`
        h-20 rounded-2xl text-2xl font-bold
        flex items-center justify-center transition-all duration-100
        active:scale-95 select-none disabled:opacity-50
        cursor-pointer border border-transparent shadow-sm
        ${variant === 'primary'
          ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 shadow-orange-500/20 active:from-orange-600 active:to-orange-700'
          : 'bg-muted text-foreground hover:bg-muted/80 hover:border-border hover:shadow-md'
        }
      `}
    >
      {value}
    </button>
  );
}

function RoleIcon({ role }) {
  if (role === 'admin') return <Shield className="h-3.5 w-3.5 text-primary shrink-0" />;
  if (role === 'manager') return <Shield className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  return <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
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
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-6xl grid md:grid-cols-[1.1fr_1fr] gap-8 bg-card/25 border border-border/50 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
        
        {/* Left column: branding & user list */}
        <div className="flex flex-col justify-between pr-0 md:pr-4">
          <div>
            {/* Logo and Brand */}
            <div className="flex items-center gap-3 mb-6">
              <span className="p-3 bg-gradient-to-tr from-amber-500 to-orange-600 rounded-2xl shadow-lg shadow-orange-500/20 text-white font-extrabold text-2xl tracking-wider select-none">
                P
              </span>
              <div>
                <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                  POSLY
                </h1>
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-widest mt-0.5">Point of Sale</p>
              </div>
            </div>

            <h2 className="text-2xl font-bold text-foreground tracking-tight mb-2">Welcome Back</h2>
            <p className="text-muted-foreground text-sm mb-6">Select your user profile to sign in to the register.</p>

            {/* Registration/Recovery CTA */}
            <div className="mb-6">
              {registrationContext?.mode === 'recovery' ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary/80 transition-colors cursor-pointer"
                  onClick={() => navigate('/register')}
                >
                  Recover Admin Access &rarr;
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/85 transition-colors cursor-pointer"
                  onClick={() => navigate('/register')}
                >
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-xs font-bold text-primary">+</span>
                  Create New Account
                </button>
              )}
            </div>

            {registrationContext?.mode === 'recovery' && (
              <Alert className="mb-6 border-amber-500/20 bg-amber-500/5">
                <AlertDescription className="text-amber-400 text-xs">
                  No administrator account is active on this device. Use admin recovery to restore management access.
                </AlertDescription>
              </Alert>
            )}

            {/* User List */}
            {loadingUsers ? (
              <div className="space-y-3">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-20 rounded-2xl bg-muted/30 animate-pulse border border-border/20" />
                ))}
              </div>
            ) : users.length === 0 ? (
              <Alert className="border-border">
                <AlertDescription className="text-sm">
                  No accounts found.{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/register')}
                    className="text-primary hover:underline font-bold"
                  >
                    Set up your first admin account
                  </button>
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                {users.map((user) => {
                  const isSelected = selectedUser === user.username;
                  const initials = nameToAvatar(user.display_name || user.username);
                  const isUserAdmin = user.role === 'admin';
                  return (
                    <button
                      key={user.id}
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setSelectedUser(user.username);
                        setError('');
                      }}
                      className={`w-full p-4 rounded-2xl border-2 text-left transition-all duration-200 flex items-center gap-4 cursor-pointer hover:shadow-md ${
                        isSelected
                          ? 'border-primary bg-primary/15 shadow-lg shadow-primary/5 ring-1 ring-primary/30'
                          : 'border-border/60 bg-card hover:border-muted-foreground/30'
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg shadow-sm shrink-0 ${
                        isUserAdmin
                          ? 'bg-gradient-to-tr from-rose-500 to-orange-500 text-white'
                          : 'bg-gradient-to-tr from-sky-500 to-blue-600 text-white'
                      }`}>
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-lg font-bold truncate">
                          {user.display_name || user.username}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <RoleIcon role={user.role} />
                          <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">{user.role}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground/60 mt-6 pt-4 border-t border-border/40">
            POSLY Terminal v1.0.0 &bull; Secure offline database
          </div>
        </div>

        {/* Right column: PIN Pad */}
        <div className="bg-card border border-border rounded-3xl p-6 sm:p-8 flex flex-col justify-between shadow-lg relative overflow-hidden">
          {/* Subtle decoration background glow */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
          
          <div>
            <div className="flex flex-col items-center mb-6">
              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
                <UserCircle className="h-8 w-8 text-muted-foreground/80" />
              </div>
              <span className="text-sm font-semibold text-muted-foreground uppercase tracking-widest text-center">
                {selectedUser ? `Signing in as ${selectedUser}` : 'Please select profile'}
              </span>
            </div>

            {/* PIN Mask Dots */}
            <div className="flex justify-center gap-6 mb-8 mt-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-6 h-6 rounded-full border-2 transition-all duration-200 transform ${
                    pin.length > i
                      ? 'bg-primary border-primary scale-110 shadow-[0_0_12px_rgba(245,158,11,0.5)]'
                      : 'border-muted-foreground/30 bg-background/50 scale-100'
                  }`}
                />
              ))}
            </div>

            {error && (
              <Alert variant="destructive" className="mb-6 rounded-xl border-destructive/20 bg-destructive/10">
                <AlertDescription className="text-destructive font-semibold text-center py-1">
                  {error === 'Invalid PIN' ? 'Wrong PIN' : error}
                </AlertDescription>
              </Alert>
            )}

            {/* Tactile Keypad */}
            <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto">
              {KEYPAD_NUMBERS.map((num) => (
                <KeypadButton
                  key={num}
                  value={num}
                  disabled={loading || !selectedUser}
                  onClick={() => addDigit(num)}
                />
              ))}

              <KeypadButton 
                value="Clear" 
                disabled={loading || !selectedUser} 
                onClick={clearPin} 
              />
              <KeypadButton 
                value="0" 
                disabled={loading || !selectedUser} 
                onClick={() => addDigit('0')} 
              />
              <KeypadButton
                value={loading ? '...' : 'Enter'}
                variant="primary"
                disabled={loading || !selectedUser}
                onClick={handleLogin}
              />
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-border/40 text-center font-medium">
            {selectedUserRecord?.role === 'admin' && (
              <button
                type="button"
                className="text-sm font-semibold text-primary hover:underline hover:text-primary/90 cursor-pointer"
                onClick={() => setForgotOpen(true)}
              >
                Forgot PIN?
              </button>
            )}

            {selectedUserRecord?.role === 'cashier' && (
              <p className="text-xs text-muted-foreground/80 leading-relaxed max-w-xs mx-auto">
                Forgot your PIN? Ask an administrator to reset it in Staff Management.
              </p>
            )}
            
            {!selectedUser && (
              <p className="text-xs text-muted-foreground/80 leading-relaxed max-w-xs mx-auto">
                Choose a profile on the left to activate the keypad.
              </p>
            )}
          </div>
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
