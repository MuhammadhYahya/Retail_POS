import { useEffect, useState } from 'react';
import { invokeWithAuth } from './ipc';
import {
  colomboDateString,
  colomboMinutesSinceMidnight,
  isStaleOpenSession,
} from './colomboTime.js';

/** Colombo time (minutes) when the close-day reminder starts showing. */
export const CLOSE_DAY_REMINDER_FROM_MINUTES = 23 * 60 + 45; // 23:45


/**
 * True when a same-calendar-day cash session is open and Colombo time >= reminder threshold.
 */
export function useCloseDayReminder() {
  const [openSession, setOpenSession] = useState(null);
  const [showCloseReminder, setShowCloseReminder] = useState(false);

  useEffect(() => {
    let active = true;
    const refreshOpenSession = async () => {
      try {
        const response = await invokeWithAuth('cashSession:getOpen');
        if (active && response.success) setOpenSession(response.data || null);
      } catch {
        if (active) setOpenSession(null);
      }
    };

    refreshOpenSession();
    const onFocus = () => refreshOpenSession();
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const sameDayOpen =
        openSession &&
        !isStaleOpenSession(openSession) &&
        colomboDateString(openSession.openedAt) === colomboDateString(now);
      setShowCloseReminder(
        Boolean(sameDayOpen && colomboMinutesSinceMidnight(now) >= CLOSE_DAY_REMINDER_FROM_MINUTES)
      );
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [openSession]);

  return showCloseReminder;
}
