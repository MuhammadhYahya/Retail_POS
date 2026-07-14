import React from 'react';

const inputClass =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
export const CUSTOM_QUESTION_VALUE = '__custom__';

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
          value={values.securityQ1Choice}
          onChange={(e) =>
            onChange({
              ...values,
              securityQ1Choice: e.target.value,
              securityQ1Custom: e.target.value === CUSTOM_QUESTION_VALUE ? values.securityQ1Custom : '',
            })
          }
        >
          <option value="">Select a question</option>
          {questions.map((q) => (
            <option key={q} value={q} disabled={q === values.securityQ2Choice}>
              {q}
            </option>
          ))}
          <option value={CUSTOM_QUESTION_VALUE}>Custom question</option>
        </select>
      </div>

      {values.securityQ1Choice === CUSTOM_QUESTION_VALUE && (
        <div>
          <label htmlFor={`${idPrefix}-q1-custom`} className="block text-sm font-medium mb-2">
            Custom question
          </label>
          <input
            id={`${idPrefix}-q1-custom`}
            className={inputClass}
            value={values.securityQ1Custom}
            onChange={(e) => onChange({ ...values, securityQ1Custom: e.target.value })}
            placeholder="Enter your own recovery question"
            autoComplete="off"
          />
        </div>
      )}

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
          value={values.securityQ2Choice}
          onChange={(e) =>
            onChange({
              ...values,
              securityQ2Choice: e.target.value,
              securityQ2Custom: e.target.value === CUSTOM_QUESTION_VALUE ? values.securityQ2Custom : '',
            })
          }
        >
          <option value="">Select a question</option>
          {questions.map((q) => (
            <option key={q} value={q} disabled={q === values.securityQ1Choice}>
              {q}
            </option>
          ))}
          <option value={CUSTOM_QUESTION_VALUE}>Custom question</option>
        </select>
      </div>

      {values.securityQ2Choice === CUSTOM_QUESTION_VALUE && (
        <div>
          <label htmlFor={`${idPrefix}-q2-custom`} className="block text-sm font-medium mb-2">
            Custom question
          </label>
          <input
            id={`${idPrefix}-q2-custom`}
            className={inputClass}
            value={values.securityQ2Custom}
            onChange={(e) => onChange({ ...values, securityQ2Custom: e.target.value })}
            placeholder="Enter your own recovery question"
            autoComplete="off"
          />
        </div>
      )}

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
  securityQ1Choice: '',
  securityQ1Custom: '',
  securityA1: '',
  securityQ2Choice: '',
  securityQ2Custom: '',
  securityA2: '',
  email: '',
  phone: '',
};
