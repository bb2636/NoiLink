import { NATIVE_BRIDGE_VERSION } from '@noilink/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { getStoredToken, getStoredUserDisplay } from '../auth/storage';
import { dispatchWebMessage, ensureAppLifecycleHandlerBound } from '../bridge/NativeBridgeDispatcher';
import { postNativeToWeb, registerWebViewInjector } from '../bridge/injectToWeb';
import { startNetworkRecoveryBridge } from '../network/networkRecoveryBridge';
import { buildBootstrapBeforeContentScript } from './bootstrapBeforeContent';
import { getWebClientOrigin } from './webUrls';

export default function WebAppWebView() {
  const webRef = useRef<WebView>(null);
  const [sessionSeed, setSessionSeed] = useState<{
    token: string | null;
    userId: string | null;
    displayName: string | null;
  } | null>(null);
  // Android 하드웨어 백 키 처리에 필요. WebView 의 내부 history 깊이를 추적해
  // 화면 안에서 뒤로 갈 곳이 있으면 앱 종료 대신 WebView 를 한 단계 되돌린다.
  // SPA(react-router)도 history.pushState 를 쓰기 때문에 안드로이드 WebView 의
  // canGoBack 이 정상적으로 갱신된다.
  const canGoBackRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getStoredToken();
      const { userId, name } = await getStoredUserDisplay();
      if (!cancelled) {
        setSessionSeed({ token, userId, displayName: name });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const injectedBeforeContentLoaded = useMemo(() => {
    if (!sessionSeed) return undefined;
    return buildBootstrapBeforeContentScript(sessionSeed);
  }, [sessionSeed]);

  useEffect(() => {
    registerWebViewInjector((script) => {
      webRef.current?.injectJavaScript(script);
    });
    // 앱이 백그라운드로 들어가면 NoiPod에 즉시 STOP을 송신 (네이티브 측 안전망).
    // WebView 안의 visibilitychange 핸들러와 별개로, JS 정지 직전에 한 번 더 보낸다.
    ensureAppLifecycleHandlerBound();
    // OS 단의 네트워크 복구 신호를 받아 WebView 에 `network.online` 을 보낸다.
    // 짧은 시간 내 깜빡임은 네이티브 측에서 throttle/dedupe 한다 (브리지 트래픽
    // 자체를 줄이는 목적; 웹 측에는 별도 throttle 이 최종 보호선).
    const stopNetworkBridge = startNetworkRecoveryBridge();
    return () => {
      stopNetworkBridge();
      registerWebViewInjector(null);
    };
  }, []);

  // Android 하드웨어 뒤로가기 — 화면 안에서 뒤로 갈 곳이 있으면 앱 종료를
  // 막고 WebView 한 단계 뒤로. 루트(첫 화면)에서는 기본 동작(앱 종료 또는
  // OS 처리)을 그대로 따른다. iOS 는 하드웨어 백 키가 없어 noop.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBackRef.current && webRef.current) {
        webRef.current.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    canGoBackRef.current = state.canGoBack;
  }, []);

  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    void dispatchWebMessage(event.nativeEvent.data);
  }, []);

  const pushFreshSessionToWeb = useCallback(async () => {
    const token = await getStoredToken();
    const { userId, name } = await getStoredUserDisplay();
    postNativeToWeb({
      v: NATIVE_BRIDGE_VERSION,
      type: 'session.update',
      payload: { token, userId, displayName: name },
    });
  }, []);

  const uri = `${getWebClientOrigin()}/`;

  if (!sessionSeed) {
    return <View style={styles.fill} />;
  }

  return (
    <WebView
      ref={webRef}
      source={{ uri }}
      style={styles.fill}
      injectedJavaScriptBeforeContentLoaded={injectedBeforeContentLoaded}
      onMessage={onMessage}
      javaScriptEnabled
      domStorageEnabled
      originWhitelist={['*']}
      onLoadEnd={() => {
        void pushFreshSessionToWeb();
      }}
      onNavigationStateChange={onNavigationStateChange}
      setSupportMultipleWindows={false}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      // iOS 좌측 가장자리 스와이프 → 뒤로가기 / 우측 → 앞으로 (안드로이드 하드웨어
      // 백 키 처리와 짝을 이뤄, 모든 화면에서 직전 페이지로 자연스럽게 복귀).
      allowsBackForwardNavigationGestures
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0A0A0A' },
});
