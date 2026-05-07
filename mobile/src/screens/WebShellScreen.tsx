import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebAppWebView from '../shell/WebAppWebView';

/**
 * 앱의 단일 진입 — 풀스크린 WebView에 Vite 클라이언트를 로드합니다.
 *
 * SafeAreaView 의 edges 는 ['left','right'] 만 사용 — top/bottom 인셋은
 * 웹쪽 #root / 페이지별 `env(safe-area-inset-*)` CSS 가 처리한다.
 * 과거 ['top','bottom','left','right'] 는 안드로이드/iOS 모두에서 네이티브
 * 인셋 + 웹 env() 인셋이 동시에 적용되어 상단 로고 위·하단 탭바 위 여백이
 * 두 배로 부풀어 보이는 회귀(2026-05-07 사용자 보고) 의 직접 원인이었다.
 */
export default function WebShellScreen() {
  return (
    <SafeAreaView style={styles.fill} edges={['left', 'right']}>
      <WebAppWebView />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0A0A0A' },
});
