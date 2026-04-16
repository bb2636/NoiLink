import type { NativeToWebMessage } from '@noilink/shared';
import { NATIVE_BRIDGE_VERSION } from '@noilink/shared';

type InjectFn = (script: string) => void;

let inject: InjectFn | null = null;

export function registerWebViewInjector(fn: InjectFn | null): void {
  inject = fn;
}

/**
 * Native → Web: WebView.injectJavaScript로 `window.__NOILINK_NATIVE_RECEIVE__(msg)` 호출.
 */
export function postNativeToWeb(message: NativeToWebMessage): void {
  if (!inject) {
    console.warn('[NoiLink bridge] WebView injector not registered — drop', message.type);
    return;
  }
  if (message.v !== NATIVE_BRIDGE_VERSION) {
    console.warn('[NoiLink bridge] unsupported message version');
    return;
  }
  const embedded = JSON.stringify(JSON.stringify(message));
  const script = `
(function(){
  try {
    var msg = JSON.parse(${embedded});
    if (typeof window.__NOILINK_NATIVE_RECEIVE__ === 'function') {
      window.__NOILINK_NATIVE_RECEIVE__(msg);
    }
  } catch (e) {
    console.error('[NoiLink bridge inject]', e);
  }
})();
true;
`;
  inject(script);
}
