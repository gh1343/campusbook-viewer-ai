// Web Worker for handling data merge operations
// Offloads timestamp-based merge logic from main thread

interface MergeItem {
  id: string;
  created_at: number;
  updated_at?: number;
  deleted?: boolean;
  [key: string]: any;
}

interface MergeRequest {
  type: "merge";
  serverData: MergeItem[];
  localData: MergeItem[];
}

interface MergeResponse {
  type: "merge-complete";
  merged: MergeItem[];
  stats: {
    total: number;
    serverOnly: number;
    localOnly: number;
    serverNewer: number;
    localNewer: number;
  };
}

self.onmessage = (e: MessageEvent<MergeRequest>) => {
  const { type, serverData, localData } = e.data;

  if (type === "merge") {
    const result = performMerge(serverData, localData);
    const response: MergeResponse = {
      type: "merge-complete",
      ...result,
    };
    self.postMessage(response);
  }
};

function performMerge(
  serverData: MergeItem[],
  localData: MergeItem[]
): Omit<MergeResponse, "type"> {
  const serverMap = new Map<string, MergeItem>();
  const localMap = new Map<string, MergeItem>();

  serverData.forEach((item) => serverMap.set(item.id, item));
  localData.forEach((item) => localMap.set(item.id, item));

  const allIds = new Set([...serverMap.keys(), ...localMap.keys()]);
  const merged: MergeItem[] = [];

  let serverOnlyCount = 0;
  let localOnlyCount = 0;
  let serverNewerCount = 0;
  let localNewerCount = 0;

  allIds.forEach((id) => {
    const serverItem = serverMap.get(id);
    const localItem = localMap.get(id);

    if (serverItem && localItem) {
      // Both exist - compare timestamps
      const serverTime = serverItem.updated_at || serverItem.created_at || 0;
      const localTime = localItem.updated_at || localItem.created_at || 0;

      if (localTime > serverTime) {
        merged.push(localItem);
        localNewerCount++;
      } else {
        merged.push(serverItem);
        serverNewerCount++;
      }
    } else if (localItem) {
      // Only in local
      merged.push(localItem);
      localOnlyCount++;
    } else if (serverItem) {
      // Only in server
      merged.push(serverItem);
      serverOnlyCount++;
    }
  });

  return {
    merged,
    stats: {
      total: merged.length,
      serverOnly: serverOnlyCount,
      localOnly: localOnlyCount,
      serverNewer: serverNewerCount,
      localNewer: localNewerCount,
    },
  };
}
