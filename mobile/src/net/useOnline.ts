import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

/**
 * Online status hook (C3). Returns true when the device has internet.
 * Listens for connectivity changes so the app can auto-sync when the
 * device comes back online.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let mounted = true;
    NetInfo.fetch().then((state) => {
      if (mounted) setOnline(state.isConnected === true && state.isInternetReachable !== false);
    });
    const unsub = NetInfo.addEventListener((state) => {
      setOnline(state.isConnected === true && state.isInternetReachable !== false);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return online;
}
