import React from 'react';

const inputClass =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

export function SecurityQuestionsFields({
  questions = [],
  values,
  onChange,
  idPrefix = 'sec',
}) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-q1`} className="block text-sm font-medium mb-2">
          Security question 1
        </label>
        <select
          id={`${idPrefix}-q1`}
          className={inputClass}
          value={values.securityQ1}
          onChange={(e) => onChange({ ...values, securityQ1: e.target.value })}
        >
          <option value="">Select a question</option>
          {questions.map((q) => (
            <option key={q} value={q} disabled={q === values.securityQ2}>
              {q}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-a1`} className="block text-sm font-medium mb-2">
          Answer 1
        </label>
        <input
          id={`${idPrefix}-a1`}
          className={inputClass}
          value={values.securityA1}
          onChange={(e) => onChange({ ...values, securityA1: e.target.value })}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-q2`} className="block text-sm font-medium mb-2">
          Security question 2
        </label>
        <select
          id={`${idPrefix}-q2`}
          className={inputClass}
          value={values.securityQ2}
          onChange={(e) => onChange({ ...values, securityQ2: e.target.value })}
        >
          <option value="">Select a question</option>
          {questions.map((q) => (
            <option key={q} value={q} disabled={q === values.securityQ1}>
              {q}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-a2`} className="block text-sm font-medium mb-2">
          Answer 2
        </label>
        <input
          id={`${idPrefix}-a2`}
          className={inputClass}
          value={values.securityA2}
          onChange={(e) => onChange({ ...values, securityA2: e.target.value })}
          autoComplete="off"
        />
      </div>
    </div>
  );
}

export function ContactFields({ values, onChange, idPrefix = 'contact' }) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-email`} className="block text-sm font-medium mb-2">
          Email <span className="text-muted-foreground font-normal">(optional, for future recovery)</span>
        </label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          className={inputClass}
          value={values.email || ''}
          onChange={(e) => onChange({ ...values, email: e.target.value })}
          autoComplete="email"
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-phone`} className="block text-sm font-medium mb-2">
          Phone <span className="text-muted-foreground font-normal">(optional, for future recovery)</span>
        </label>
        <input
          id={`${idPrefix}-phone`}
          type="tel"
          className={inputClass}
          value={values.phone || ''}
          onChange={(e) => onChange({ ...values, phone: e.target.value })}
          autoComplete="tel"
        />
      </div>
    </div>
  );
}

export const EMPTY_SECURITY_FORM = {
  securityQ1: '',
  securityA1: '',
  securityQ2: '',
  securityA2: '',
  email: '',
  phone: '',
};
