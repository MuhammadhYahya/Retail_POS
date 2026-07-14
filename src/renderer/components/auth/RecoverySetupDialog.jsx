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
import { invokeWithAuth } from '../../lib/ipc';
import { useAuthStore } from '../../store/authStore';
import {
  SecurityQuestionsFields,
  ContactFields,
  EMPTY_SECURITY_FORM,
  CUSTOM_QUESTION_VALUE,
} from './SecurityQuestionsFields';

function resolveQuestion(choice, customQuestion) {
  return choice === CUSTOM_QUESTION_VALUE ? customQuestion.trim() : choice;
}

export default function RecoverySetupDialog() {
  const user = useAuthStore((state) => state.user);
  const setNeedsRecoverySetup = useAuthStore((state) => state.setNeedsRecoverySetup);
  const needsRecoverySetup = useAuthStore((state) => state.needsRecoverySetup);

  const [questions, setQuestions] = useState([]);
  const [form, setForm] = useState(EMPTY_SECURITY_FORM);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      setChecked(true);
      return;
    }

    let cancelled = false;

    const load = async () => {
      const response = await invokeWithAuth('auth:getRecoveryStatus');
      if (cancelled) return;

      if (response.success) {
        setQuestions(response.data.securityQuestions || []);
        setNeedsRecoverySetup(response.data.needsRecoverySetup);
        setForm((prev) => ({
          ...prev,
          email: response.data.email || '',
          phone: response.data.phone || '',
        }));
      }
      setChecked(true);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user, setNeedsRecoverySetup]);

  if (!checked || !user || user.role !== 'admin' || !needsRecoverySetup) {
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const resolvedQ1 = resolveQuestion(form.securityQ1Choice, form.securityQ1Custom);
    const resolvedQ2 = resolveQuestion(form.securityQ2Choice, form.securityQ2Custom);

    if (!resolvedQ1 || !resolvedQ2 || !form.securityA1.trim() || !form.securityA2.trim()) {
      setError('Please complete both security questions and answers.');
      return;
    }

    if (resolvedQ1.trim().toLowerCase() === resolvedQ2.trim().toLowerCase()) {
      setError('Choose two different security questions.');
      return;
    }

    setSubmitting(true);
    const response = await invokeWithAuth('auth:setSecurityQuestions', {
      ...form,
      securityQ1: resolvedQ1,
      securityQ2: resolvedQ2,
    });
    setSubmitting(false);

    if (response.success) {
      setNeedsRecoverySetup(false);
    } else {
      setError(response.error || 'Failed to save recovery settings.');
    }
  };

  return (
    <Dialog open dismissible={false} onOpenChange={() => {}}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Set up account recovery</DialogTitle>
          <DialogDescription>
            You must set security questions before continuing. These let you reset your admin PIN if you forget it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <SecurityQuestionsFields
            questions={questions}
            values={form}
            onChange={setForm}
            idPrefix="setup"
          />

          <ContactFields values={form} onChange={setForm} idPrefix="setup" />

          <DialogFooter>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Saving...' : 'Save recovery settings'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
