import { Effect } from "../main";

const forever = new Promise(() => {});

const throttle = (ms: number): Effect => ({
  effect({ refs, id, use }) {
    use([id], () => {
      const now = Date.now();
      const lastTime: number = refs.__throttleLastExecution;
      if (lastTime && lastTime + ms > now) return forever;
      refs.__throttleLastExecution = now;
      return;
    });
  },
});

export default throttle;
