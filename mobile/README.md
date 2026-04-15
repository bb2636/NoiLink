# NoiLink Mobile (React Native)

WebView 없이 **네이티브 BLE**(`react-native-ble-plx`)와 트레이닝 플로우 뼈대만 담은 앱입니다.

## 사전 준비

- Node 18+
- **Android**: Android Studio, SDK, 기기 또는 에뮬레이터 (BLE는 **실기기** 권장)
- 공유 타입 패키지 빌드: 저장소 루트에서 `cd shared && npm install && node ../node_modules/typescript/bin/tsc` (또는 루트에 TypeScript 설치된 환경에서 `shared`의 `npm run build`)

## 설치

```bash
cd mobile
npm install
```

## 실행 (BLE 포함 개발 빌드)

Expo Go에는 `react-native-ble-plx`가 없으므로 **prebuild 후 네이티브 실행**이 필요합니다.

```bash
cd mobile
npx expo prebuild --platform android
npm run android
```

APK를 직접 빌드하려면 Android Studio에서 `android` 폴더를 연 뒤 **Build > Build Bundle(s) / APK(s)** 를 사용합니다 (`prebuild` 후 `android` 생성).

## 코드 구조

- `src/ble/noiPodBle.ts` — 권한, 스캔, 연결. 반응 notify는 `subscribeReactionSignal`에 UUID 확정 후 구현.
- `src/training/trainingConfig.ts` — `@noilink/shared` 카탈로그와 동일, `apiMode`는 `POST /sessions`용.
- `src/api/trainingSubmit.ts` — 세션 저장 후 `POST /metrics/calculate`(점수 모드). `EXPO_PUBLIC_*` 필요.
- `src/config.ts` — API URL·개발용 사용자 ID.
- `src/screens/*` — 목록 → 설정 → (스캔) → 진행 → 결과.

## 서버 연동 (세션·지표)

`.env` 또는 EAS 환경에 다음을 설정합니다.

- `EXPO_PUBLIC_API_URL` — 예: `http://10.0.2.2:5000/api` (Android 에뮬레이터에서 PC의 API)

API URL이 설정되어 있으면 **트레이닝 목록 상단의「로그인」**에서 이메일·비밀번호로 로그인합니다. 서버는 `POST /sessions`, `POST /metrics/calculate`에 **JWT(Bearer)** 가 필요합니다. 로컬 서버에 시드된 관리자 계정이 있다면 예: `admin@admin.com` / `admin1234`(개발용, `server/utils/seed-admin.ts` 참고).

미설정 시(API URL 없음) 트레이닝은 로컬만 동작하고 서버 동기화는 건너뜁니다.

## 다음 작업 제안

- 펌웨어 GATT 서비스/notify UUID 반영 후 `subscribeReactionSignal` 구현.
- 토큰 만료 시 자동 로그아웃·재로그인 UX.
- 필요 시 기기 이름 필터(`NoiPod`)로 스캔 노이즈 축소.
