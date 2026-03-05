# GitHub 업로드 스크립트
# 사용법: PowerShell에서 실행

Write-Host "🚀 GitHub 업로드 시작..." -ForegroundColor Green

# 1. Git 초기화
Write-Host "`n1️⃣  Git 초기화 중..." -ForegroundColor Yellow
if (Test-Path .git) {
    Write-Host "   ⚠️  이미 Git이 초기화되어 있습니다." -ForegroundColor Yellow
} else {
    git init
    Write-Host "   ✅ Git 초기화 완료" -ForegroundColor Green
}

# 2. 파일 추가
Write-Host "`n2️⃣  파일 추가 중..." -ForegroundColor Yellow
git add .
Write-Host "   ✅ 파일 추가 완료" -ForegroundColor Green

# 3. 커밋
Write-Host "`n3️⃣  커밋 중..." -ForegroundColor Yellow
$commitMessage = "Initial commit: NoiLink 뇌지컬 트레이닝 프로젝트"
git commit -m $commitMessage
Write-Host "   ✅ 커밋 완료" -ForegroundColor Green

# 4. 원격 저장소 확인
Write-Host "`n4️⃣  원격 저장소 확인 중..." -ForegroundColor Yellow
$remote = git remote -v
if ($remote) {
    Write-Host "   현재 원격 저장소:" -ForegroundColor Cyan
    Write-Host $remote
    $change = Read-Host "   원격 저장소를 변경하시겠습니까? (y/n)"
    if ($change -eq "y") {
        git remote remove origin
    } else {
        Write-Host "   ⏭️  기존 원격 저장소 사용" -ForegroundColor Yellow
        Write-Host "`n✅ 준비 완료! 다음 명령어로 푸시하세요:" -ForegroundColor Green
        Write-Host "   git push -u origin main" -ForegroundColor Cyan
        exit
    }
}

# 5. 원격 저장소 URL 입력
Write-Host "`n5️⃣  원격 저장소 URL을 입력하세요:" -ForegroundColor Yellow
Write-Host "   예: https://github.com/YOUR_USERNAME/NoiLink.git" -ForegroundColor Gray
$repoUrl = Read-Host "   GitHub 리포지토리 URL"

if ($repoUrl) {
    git remote add origin $repoUrl
    Write-Host "   ✅ 원격 저장소 연결 완료" -ForegroundColor Green
    
    # 6. 브랜치 이름 변경 및 푸시
    Write-Host "`n6️⃣  GitHub에 푸시 중..." -ForegroundColor Yellow
    git branch -M main
    
    Write-Host "`n⚠️  다음 명령어를 실행하세요:" -ForegroundColor Yellow
    Write-Host "   git push -u origin main" -ForegroundColor Cyan
    Write-Host "`n   또는 이 스크립트에서 자동으로 푸시할까요?" -ForegroundColor Gray
    $autoPush = Read-Host "   자동 푸시? (y/n)"
    
    if ($autoPush -eq "y") {
        git push -u origin main
        Write-Host "`n✅ GitHub 업로드 완료!" -ForegroundColor Green
    } else {
        Write-Host "`n✅ 준비 완료! 다음 명령어로 푸시하세요:" -ForegroundColor Green
        Write-Host "   git push -u origin main" -ForegroundColor Cyan
    }
} else {
    Write-Host "   ❌ URL이 입력되지 않았습니다." -ForegroundColor Red
    Write-Host "`n수동으로 다음 명령어를 실행하세요:" -ForegroundColor Yellow
    Write-Host "   git remote add origin https://github.com/YOUR_USERNAME/NoiLink.git" -ForegroundColor Cyan
    Write-Host "   git branch -M main" -ForegroundColor Cyan
    Write-Host "   git push -u origin main" -ForegroundColor Cyan
}

Write-Host "`n📝 참고: GITHUB_SETUP.md 파일을 확인하세요." -ForegroundColor Gray
