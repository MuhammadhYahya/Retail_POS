import auditService from '../services/auditService.js';

export function writeAuditLog(action, userId = null, details = null) {
  return auditService.write({
    action: String(action || 'unknown'),
    actorUserId: userId,
    details,
  });
}

export function writeAuditLogWithoutUserRef(action, details = null) {
  return auditService.write({
    action: String(action || 'unknown'),
    actorUserId: null,
    details,
  });
}

export function writeAuditEvent(event) {
  return auditService.write(event);
}

export function addAuditWarning(response, audit) {
  return audit?.success ? response : { ...response, auditWarning: audit?.warning };
}
