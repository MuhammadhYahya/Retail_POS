export const SECURITY_QUESTIONS = [
  'What was the name of your first pet?',
  'What city were you born in?',
  'What is your mother\'s maiden name?',
  'What was the name of your first school?',
  'What is your favorite food?',
  'What was the make of your first car?',
  'What is the name of the street you grew up on?',
  'What is your favorite movie?',
];

export const CUSTOM_QUESTION_VALUE = '__custom__';

export function normalizeAnswer(answer) {
  return String(answer || '').trim().toLowerCase();
}

export function normalizeQuestion(question) {
  return String(question || '').trim().toLowerCase();
}

export function hasSecurityQuestions(user) {
  return Boolean(user?.security_a1_hash && user?.security_a2_hash);
}

export function validateQuestionPair(q1, q2) {
  if (!normalizeQuestion(q1) || !normalizeQuestion(q2)) {
    return 'Please enter two security questions.';
  }
  if (normalizeQuestion(q1) === normalizeQuestion(q2)) {
    return 'Choose two different security questions.';
  }
  return null;
}

export function resolveSecurityQuestion(choice, customQuestion) {
  return String(choice || '') === CUSTOM_QUESTION_VALUE
    ? String(customQuestion || '').trim()
    : String(choice || '').trim();
}

export function validateQuestionSelection(choice, customQuestion) {
  if (String(choice || '') === CUSTOM_QUESTION_VALUE) {
    return String(customQuestion || '').trim()
      ? null
      : 'Please enter a custom security question.';
  }

  if (!SECURITY_QUESTIONS.includes(choice)) {
    return 'Please select a valid security question.';
  }

  return null;
}
