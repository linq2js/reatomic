import { Effect } from "../main";

const debounce = (ms = 0): Effect => ({
  effect({ refs, use, id, onCancel }) {
    onCancel(() => clearTimeout(refs.__debounceTimer));
    use([id], () => {
      return new Promise((resolve) => {
        refs.__debounceTimer = setTimeout(resolve, ms);
      });
    });
  },
});

export default debounce;
