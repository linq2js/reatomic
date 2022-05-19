export interface HydrateOptions {
  data?: [any, any];
  onLoad?: (key: any) => void;
  onSave?: (key: any, data: any) => void;
}

export const hydrate = ({ data, onLoad, onSave }: HydrateOptions = {}) => {
  let hydratedData = new Map<any, any>(data ?? []);
  let allDataReady: Promise<void> | undefined;
  let dataReadyResolve: VoidFunction | undefined;
  const pendingAtoms = new Set<unknown>();

  const dehydrate = async () => {
    await allDataReady;
    return Array.from(hydratedData.entries());
  };

  return Object.assign(
    (key: unknown) => {
      pendingAtoms.add(key);
      allDataReady = new Promise((resolve) => {
        dataReadyResolve = resolve;
      });
      return {
        load() {
          onLoad?.(key);
          return hydratedData.get(key);
        },
        save(data: any) {
          pendingAtoms.delete(key);
          hydratedData.set(key, { data });
          if (!pendingAtoms.size) {
            dataReadyResolve?.();
          }
          onSave?.(key, data);
        },
      };
    },
    { dehydrate }
  );
};
