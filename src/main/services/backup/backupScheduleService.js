import backupService from './index.js';

function parseTimeToMinutes(hhmm) {
  const [h, m] = String(hhmm || '02:00').split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 2 * 60;
  return h * 60 + m;
}

function daysBetween(a, b) {
  const ms = Math.abs(b.getTime() - a.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

function frequencyDays(frequency) {
  switch (frequency) {
    case 'every_3_days':
      return 3;
    case 'weekly':
      return 7;
    case 'monthly':
      return 30;
    case 'daily':
    default:
      return 1;
  }
}

function shouldRunMissed(settings, now = new Date()) {
  if (!settings.enabled) return false;

  const last = settings.lastAutoBackupAt ? new Date(settings.lastAutoBackupAt) : null;
  const intervalDays = frequencyDays(settings.frequency);
  const scheduledMinutes = parseTimeToMinutes(settings.time);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (!last) {
    // First enable: if we are past today's scheduled time, run on startup
    return nowMinutes >= scheduledMinutes;
  }

  const elapsed = daysBetween(last, now);
  if (elapsed >= intervalDays) {
    return true;
  }

  // Same calendar day after schedule and never ran today
  const lastDay = last.toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  if (lastDay !== today && nowMinutes >= scheduledMinutes && elapsed >= intervalDays - 0.001) {
    return true;
  }

  return Boolean(settings.missedPending);
}

function msUntilNextSchedule(settings, now = new Date()) {
  const [hh, mm] = String(settings.time || '02:00').split(':').map(Number);
  const next = new Date(now);
  next.setHours(hh || 0, mm || 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(1000, next.getTime() - now.getTime());
}

let timerHandle = null;
let running = false;

const backupScheduleService = {
  async checkMissedAndRun({ themePreference = null } = {}) {
    if (running) return { ran: false, reason: 'busy' };
    const settings = backupService.getBackupSettings();
    if (!shouldRunMissed(settings)) {
      return { ran: false, reason: 'not_due' };
    }

    running = true;
    try {
      const location = settings.location || backupService.getDefaultBackupDir();
      const result = await backupService.createBackup({
        destinationDir: location,
        type: 'automatic',
        themePreference,
      });
      backupService.markAutoBackupDone();
      backupService.pruneAutomaticBackups({ location, keep: settings.keep });
      return { ran: true, result };
    } finally {
      running = false;
    }
  },

  async runScheduledNow({ themePreference = null } = {}) {
    if (running) return { ran: false, reason: 'busy' };
    const settings = backupService.getBackupSettings();
    if (!settings.enabled) return { ran: false, reason: 'disabled' };

    running = true;
    try {
      const location = settings.location || backupService.getDefaultBackupDir();
      const result = await backupService.createBackup({
        destinationDir: location,
        type: 'automatic',
        themePreference,
      });
      backupService.markAutoBackupDone();
      backupService.pruneAutomaticBackups({ location, keep: settings.keep });
      return { ran: true, result };
    } finally {
      running = false;
    }
  },

  startScheduler({ getThemePreference } = {}) {
    this.stopScheduler();

    const tick = async () => {
      try {
        const settings = backupService.getBackupSettings();
        if (!settings.enabled) {
          timerHandle = setTimeout(tick, 60 * 1000);
          return;
        }

        const now = new Date();
        const [hh, mm] = String(settings.time || '02:00').split(':').map(Number);
        const atMinute = now.getHours() === (hh || 0) && now.getMinutes() === (mm || 0);

        if (atMinute || shouldRunMissed(settings, now)) {
          const themePreference = typeof getThemePreference === 'function' ? getThemePreference() : null;
          await this.runScheduledNow({ themePreference });
        }

        timerHandle = setTimeout(tick, 60 * 1000);
      } catch (error) {
        console.error('[backupSchedule]', error.message);
        timerHandle = setTimeout(tick, 60 * 1000);
      }
    };

    // Initial delay: check soon after startup for missed backups
    timerHandle = setTimeout(tick, 5 * 1000);
  },

  stopScheduler() {
    if (timerHandle) {
      clearTimeout(timerHandle);
      timerHandle = null;
    }
  },

  msUntilNextSchedule,
};

export default backupScheduleService;
