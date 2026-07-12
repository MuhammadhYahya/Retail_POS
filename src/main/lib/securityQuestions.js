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

export function normalizeAnswer(answer) {
  return String(answer || '').trim().toLowerCase();
}

export function hasSecurityQuestions(user) {
  return Boolean(user?.security_a1_hash && user?.security_a2_hash);
}

export function validateQuestionPair(q1, q2) {
  if (!SECURITY_QUESTIONS.includes(q1) || !SECURITY_QUESTIONS.includes(q2)) {
    return 'Please select valid security questions.';
  }
  if (q1 === q2) {
    return 'Choose two different security questions.';
  }
  return null;
}
