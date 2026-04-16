/**
 * WebView 문서 로드 전 실행 — localStorage 시드 + 네이티브 수신 큐.
 * 웹 번들의 initNativeBridge가 __NOILINK_NATIVEBridge_ON_MESSAGE__만 연결하면 됨.
 */
export function buildBootstrapBeforeContentScript(session: {
  token: string | null;
  userId: string | null;
  displayName: string | null;
}): string {
  const TOKEN = 'noilink_token';
  const USER_ID = 'noilink_user_id';
  const USERNAME = 'noilink_username';

  const sessionLiteral = JSON.stringify(JSON.stringify(session));

  return `
(function(){
  try {
    var s = JSON.parse(${sessionLiteral});
    if (s.token) { localStorage.setItem('${TOKEN}', s.token); } else { localStorage.removeItem('${TOKEN}'); }
    if (s.userId) { localStorage.setItem('${USER_ID}', s.userId); } else { localStorage.removeItem('${USER_ID}'); }
    if (s.displayName) { localStorage.setItem('${USERNAME}', s.displayName); } else { localStorage.removeItem('${USERNAME}'); }
  } catch (e) {}

  window.__NOILINK_NATIVE_MESSAGE_QUEUE__ = window.__NOILINK_NATIVE_MESSAGE_QUEUE__ || [];
  window.__NOILINK_NATIVE_RECEIVE__ = function(msg) {
    var fn = window.__NOILINK_NATIVEBridge_ON_MESSAGE__;
    if (typeof fn === 'function') { fn(msg); }
    else { window.__NOILINK_NATIVE_MESSAGE_QUEUE__.push(msg); }
  };
})();
true;
`;
}
