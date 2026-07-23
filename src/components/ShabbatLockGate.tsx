import { useEffect, useState, type ReactNode } from 'react';
import { getConsoleLock, type ConsoleLockState } from '../utils/shabbatLock';
import ShabbatLockScreen from './ShabbatLockScreen';

/**
 * Wraps the entire app (outside the router, above auth) so Shabbat/Yom Tov
 * locks everything — including /login itself — regardless of role or
 * whether anyone is signed in.
 */
export default function ShabbatLockGate({ children }: { children: ReactNode }) {
  const [lock, setLock] = useState<ConsoleLockState>(() => getConsoleLock());
  const [devBypass, setDevBypass] = useState(false);

  useEffect(() => {
    const tick = () => setLock(getConsoleLock());
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  if (lock.locked && !devBypass) {
    return (
      <ShabbatLockScreen
        title={lock.title}
        reopenAt={lock.reopenAt}
        onDevBypass={import.meta.env.DEV ? () => setDevBypass(true) : undefined}
      />
    );
  }

  return <>{children}</>;
}
