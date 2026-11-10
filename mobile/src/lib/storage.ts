import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Where the device key lives: the Keychain / Keystore on a phone (expo-secure-store), localStorage in the browser
 * build used for testing. The server keeps only the key's hash.
 */
const web = Platform.OS === "web";

export async function getItem(key: string): Promise<string | null> {
  if (web) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string | null): Promise<void> {
  if (web) {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch {
      /* private mode: the sign-in lasts until the tab closes */
    }
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}
