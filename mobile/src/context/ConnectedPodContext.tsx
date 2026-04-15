import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface ConnectedPod {
  id: string;
  name: string;
}

interface ConnectedPodContextValue {
  pod: ConnectedPod | null;
  setPod: (p: ConnectedPod | null) => void;
  clearPod: () => void;
}

const ConnectedPodContext = createContext<ConnectedPodContextValue | null>(null);

export function ConnectedPodProvider({ children }: { children: React.ReactNode }) {
  const [pod, setPod] = useState<ConnectedPod | null>(null);
  const clearPod = useCallback(() => setPod(null), []);

  const value = useMemo(
    () => ({ pod, setPod, clearPod }),
    [pod, clearPod]
  );

  return (
    <ConnectedPodContext.Provider value={value}>{children}</ConnectedPodContext.Provider>
  );
}

export function useConnectedPod() {
  const ctx = useContext(ConnectedPodContext);
  if (!ctx) {
    throw new Error('useConnectedPod must be used within ConnectedPodProvider');
  }
  return ctx;
}
