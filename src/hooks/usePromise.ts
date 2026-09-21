import { useEffect, useState } from "react";
export function usePromise<T>(p: Promise<T>): { value?: T; error?: Error } {
  const [r, setR] = useState<{ value?: T; error?: Error }>({});
  useEffect(() => {
    let live = true;
    p.then(
      (value) => live && setR({ value }),
      (e: unknown) => live && setR({ error: e as Error }),
    );
    return () => {
      live = false;
    };
  }, [p]);
  return r;
}
