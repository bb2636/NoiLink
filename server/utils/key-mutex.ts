/**
 * 키 단위 in-process 뮤텍스.
 *
 * 동일 key에 대한 동시 실행을 직렬화하여 KV(`db.get → modify → db.set`)의
 * read-modify-write race condition을 방지합니다.
 *
 * WARNING: 멀티 인스턴스 환경에서는 인스턴스마다 별도 뮤텍스가 동작하므로
 * 같은 key에 동시 접근이 발생할 수 있습니다. 단일 인스턴스(Replit Reserved VM) 가정.
 * 멀티 인스턴스로 확장 시 PostgreSQL `SELECT ... FOR UPDATE` 또는
 * Redis(Redlock) 기반으로 교체 필요.
 */

const locks = new Map<string, Promise<unknown>>();

/**
 * key별 직렬 실행 보장.
 */
export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  // chain: 다음 task는 이전 task가 끝나야 시작 (성공/실패 무관)
  const next = previous.catch(() => undefined).then(fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    // 우리가 마지막이면 정리 (이후 누군가 set 했으면 그대로 둠)
    if (locks.get(key) === next) {
      locks.delete(key);
    }
  }
}
