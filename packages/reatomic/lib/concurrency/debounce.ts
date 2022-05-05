import { Effect } from "../main";

const debounce = (ms = 0): Effect<void> => ({
  effect: ({ refs, onCancel }) => ({
    call() {
      onCancel(() => clearTimeout(refs.__debounceTimer));
      return new Promise((resolve) => {
        refs.__debounceTimer = setTimeout(resolve, ms);
      });
    },
  }),
});

export default debounce;
