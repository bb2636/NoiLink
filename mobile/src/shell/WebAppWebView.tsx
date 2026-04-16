import { NATIVE_BRIDGE_VERSION } from '@noilink/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import { getStoredToken, getStoredUserDisplay } from '../auth/storage';
import { dispatchWebMessage } from '../bridge/NativeBridgeDispatcher';
import { postNativeToWeb, registerWebViewInjector } from '../bridge/injectToWeb';
import { buildBootstrapBeforeContentScript } from './bootstrapBeforeContent';
import { getWebClientOrigin } from './webUrls';

export default function WebAppWebView() {
  const webRef = useRef<WebView>(null);
  const [sessionSeed, setSessionSeed] = useState<{
    token: string | null;
    userId: string | null;
    displayName: string | null;
  } | null>(null);

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
    return () => registerWebViewInjector(null);
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
      setSupportMultipleWindows={false}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0A0A0A' },
});
