# GitHub 업로드 가이드

## 📋 사전 준비

1. GitHub 계정이 있어야 합니다
2. Git이 설치되어 있어야 합니다 (`git --version`으로 확인)

## 🚀 업로드 순서

### 1단계: Git 초기화 (아직 안 했다면)

```bash
cd C:\Users\dyd97\NoiLink
git init
```

### 2단계: .gitignore 확인

`.gitignore` 파일이 이미 설정되어 있습니다. 다음 항목들이 제외됩니다:
- `node_modules/`
- `.env` 파일들
- `dist/`, `build/`
- `data/` (로컬 DB 파일)

### 3단계: 모든 파일 추가

```bash
git add .
```

### 4단계: 첫 커밋

```bash
git commit -m "Initial commit: NoiLink 뇌지컬 트레이닝 프로젝트"
```

### 5단계: GitHub에서 리포지토리 생성

1. [GitHub](https://github.com)에 로그인
2. 우측 상단의 **+** 버튼 클릭 → **New repository**
3. Repository name 입력 (예: `NoiLink`)
4. Description 입력 (선택사항)
5. **Public** 또는 **Private** 선택
6. **Initialize this repository with a README** 체크 해제 (이미 README가 있으므로)
7. **Create repository** 클릭

### 6단계: 원격 저장소 연결

GitHub에서 생성한 리포지토리의 URL을 복사한 후:

```bash
# HTTPS 방식 (권장)
git remote add origin https://github.com/YOUR_USERNAME/NoiLink.git

# 또는 SSH 방식
git remote add origin git@github.com:YOUR_USERNAME/NoiLink.git
```

**YOUR_USERNAME**을 본인의 GitHub 사용자명으로 변경하세요.

### 7단계: GitHub에 푸시

```bash
git branch -M main
git push -u origin main
```

첫 푸시 시 GitHub 로그인을 요청할 수 있습니다.

## ✅ 완료!

이제 GitHub에서 프로젝트를 확인할 수 있습니다.

## 🔄 이후 업데이트 방법

코드를 수정한 후:

```bash
# 변경사항 확인
git status

# 변경된 파일 추가
git add .

# 커밋
git commit -m "변경 내용 설명"

# GitHub에 푸시
git push
```

## ⚠️ 주의사항

### .env 파일은 절대 커밋하지 마세요!

`.gitignore`에 이미 포함되어 있지만, 확인:

```bash
# .env 파일이 추적되고 있는지 확인
git ls-files | grep .env

# 만약 추적되고 있다면 제거
git rm --cached .env
git commit -m "Remove .env from tracking"
```

### 민감한 정보 확인

다음 파일들이 제외되었는지 확인:
- `.env`
- `server/.env`
- `data/db.json` (로컬 DB 데이터)

## 🐛 문제 해결

### 이미 Git이 초기화되어 있는 경우

```bash
# 원격 저장소 확인
git remote -v

# 기존 원격 저장소 제거 (필요시)
git remote remove origin

# 새 원격 저장소 추가
git remote add origin https://github.com/YOUR_USERNAME/NoiLink.git
```

### 커밋 이력이 있는 경우

```bash
# 현재 브랜치 확인
git branch

# main 브랜치로 전환 (필요시)
git branch -M main

# 강제 푸시 (주의: 기존 이력 덮어씀)
git push -u origin main --force
```

### 인증 문제

HTTPS 사용 시 Personal Access Token이 필요할 수 있습니다:
1. GitHub Settings → Developer settings → Personal access tokens
2. Generate new token 생성
3. 토큰을 비밀번호 대신 사용

## 📝 추천: README 업데이트

GitHub에 올리기 전에 `README.md`를 확인하고 필요한 정보를 추가하세요.
