/** One request at a time; stopping aborts and suppresses late results. */
export function startPolling<T>(load: (signal: AbortSignal) => Promise<T>, onValue: (value: T) => void, onError: (error: unknown) => void, interval: number, visible: () => boolean = () => true) {
  let stopped = false;
  let pending = false;
  let controller: AbortController | undefined;
  const refresh = () => {
    if (stopped || pending || !visible()) return;
    pending = true;
    controller = new AbortController();
    void load(controller.signal).then(value => { if (!stopped) onValue(value); })
      .catch(error => { if (!stopped) onError(error); })
      .finally(() => { pending = false; });
  };
  const timer = setInterval(refresh, interval);
  refresh();
  return { refresh, stop: () => { stopped = true; clearInterval(timer); controller?.abort(); } };
}
