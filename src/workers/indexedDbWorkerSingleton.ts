/**
 * IndexedDB Worker 싱글턴
 * BookContext와 AnnotationContext가 동일한 Worker 인스턴스를 공유하여
 * 메모리 및 스레드 오버헤드를 절감합니다.
 */

let sharedWorker: Worker | null = null;

export const getSharedIndexedDbWorker = (): Worker | null => {
  if (typeof window === "undefined") return null;
  if (sharedWorker) return sharedWorker;
  sharedWorker = new Worker(
    new URL("./indexedDbWorker.ts", import.meta.url),
    { type: "module" }
  );
  return sharedWorker;
};
