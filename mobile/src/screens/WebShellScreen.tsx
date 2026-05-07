import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebAppWebView from '../shell/WebAppWebView';

/**
 * 앱의 단일 진입 — 풀스크린 WebView에 Vite 클라이언트를 로드합니다.
 *
 * SafeAreaView 로 감싸 안드로이드 status bar / iOS 노치·홈 인디케이터 영역을
 * 침범하지 않도록 한다. 웹쪽 #root 의 env(safe-area-inset-*) 패딩만으로는
 * 안드로이드 WebView 가 status bar 아래까지 콘텐츠를 그릴 때 헤더가
 * 시스템 UI 에 묻히는 문제가 있어, 네이티브 레이어에서 한번 더 보장한다.
 */
export default function WebShellScreen() {
  return (
    <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
      <WebAppWebView />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0A0A0A' },
});
