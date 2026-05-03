/**
 * Omezí čekání na asynchronní operaci (např. zápis do Firestore).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = "Operace překročila časový limit"
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${message} (${Math.round(ms / 1000)} s).`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}
