import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError, getJson } from "./api";
import { useSession } from "./session";

export type Load<T> = { data: T | null; error: ApiError | null; loading: boolean; reload: () => Promise<void> };

/** Loads one screen's JSON; reloads when the screen comes back into focus. Keeps old data while reloading. */
export function useApi<T>(path: string | null): Load<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);
  const { refresh } = useSession();
  const router = useRouter();
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await getJson<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n !== seq.current) return;
      const err = e instanceof ApiError ? e : new ApiError("Couldn't reach Everyday.", 0, "offline");
      setError(err);
      if (err.code === "signin") {
        await refresh();
        router.replace("/sign-in");
      }
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
  }, [load]);
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void load();
    }, [load]),
  );
  return { data, error, loading, reload: load };
}
