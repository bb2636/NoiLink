# 본인 GitHub 계정으로 설정하는 스크립트

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Git 작성자 정보 설정" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 현재 설정 확인
Write-Host "현재 Git 설정:" -ForegroundColor Yellow
$currentName = git config user.name
$currentEmail = git config user.email
Write-Host "  이름: $currentName" -ForegroundColor Gray
Write-Host "  이메일: $currentEmail" -ForegroundColor Gray
Write-Host ""

# 원격 저장소 확인
Write-Host "현재 원격 저장소:" -ForegroundColor Yellow
git remote -v | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
Write-Host ""

# 사용자 정보 입력
Write-Host "본인의 GitHub 정보를 입력하세요:" -ForegroundColor Green
$newName = Read-Host "GitHub 사용자명"
$newEmail = Read-Host "GitHub 이메일 (또는 GitHub noreply 이메일)"

if ([string]::IsNullOrWhiteSpace($newName) -or [string]::IsNullOrWhiteSpace($newEmail)) {
    Write-Host "❌ 사용자명과 이메일은 필수입니다." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "변경할 정보:" -ForegroundColor Yellow
Write-Host "  이름: $newName" -ForegroundColor Cyan
Write-Host "  이메일: $newEmail" -ForegroundColor Cyan
Write-Host ""

$confirm = Read-Host "이 정보로 변경하시겠습니까? (y/n)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "취소되었습니다." -ForegroundColor Red
    exit
}

Write-Host ""
Write-Host "1️⃣  Git 설정 변경 중..." -ForegroundColor Yellow
git config user.name $newName
git config user.email $newEmail
Write-Host "   ✅ 설정 변경 완료" -ForegroundColor Green

# 원격 저장소 변경 여부 확인
Write-Host ""
Write-Host "2️⃣  원격 저장소를 본인 계정으로 변경하시겠습니까?" -ForegroundColor Yellow
Write-Host "   현재: https://github.com/bb2636/NoiLink.git" -ForegroundColor Gray
$changeRemote = Read-Host "   변경? (y/n)"

if ($changeRemote -eq "y" -or $changeRemote -eq "Y") {
    Write-Host ""
    $newRepoUrl = Read-Host "새 리포지토리 URL (예: https://github.com/$newName/NoiLink.git)"
    
    if (-not [string]::IsNullOrWhiteSpace($newRepoUrl)) {
        Write-Host "   원격 저장소 변경 중..." -ForegroundColor Yellow
        git remote set-url origin $newRepoUrl
        Write-Host "   ✅ 원격 저장소 변경 완료" -ForegroundColor Green
    }
}

# 이전 커밋 수정 여부
Write-Host ""
Write-Host "3️⃣  이전 커밋의 작성자 정보도 변경하시겠습니까?" -ForegroundColor Yellow
Write-Host "   ⚠️  주의: 히스토리를 재작성하므로 강제 푸시가 필요합니다" -ForegroundColor Red
$changeHistory = Read-Host "   변경? (y/n)"

if ($changeHistory -eq "y" -or $changeHistory -eq "Y") {
    Write-Host ""
    Write-Host "   모든 커밋의 작성자 정보 변경 중..." -ForegroundColor Yellow
    Write-Host "   ⚠️  이 작업은 시간이 걸릴 수 있습니다" -ForegroundColor Yellow
    
    # filter-branch 실행
    $env:GIT_AUTHOR_NAME = $newName
    $env:GIT_AUTHOR_EMAIL = $newEmail
    $env:GIT_COMMITTER_NAME = $newName
    $env:GIT_COMMITTER_EMAIL = $newEmail
    
    git filter-branch -f --env-filter "
        export GIT_AUTHOR_NAME='$newName'
        export GIT_AUTHOR_EMAIL='$newEmail'
        export GIT_COMMITTER_NAME='$newName'
        export GIT_COMMITTER_EMAIL='$newEmail'
    " --tag-name-filter cat -- --branches --tags
    
    Write-Host "   ✅ 히스토리 재작성 완료" -ForegroundColor Green
    Write-Host ""
    Write-Host "   ⚠️  다음 명령어로 강제 푸시가 필요합니다:" -ForegroundColor Yellow
    Write-Host "   git push --force-with-lease origin main" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "   최근 커밋만 변경 중..." -ForegroundColor Yellow
    git commit --amend --author="$newName <$newEmail>" --no-edit 2>$null
    Write-Host "   ✅ 최근 커밋 수정 완료" -ForegroundColor Green
    Write-Host ""
    Write-Host "   ⚠️  다음 명령어로 강제 푸시가 필요합니다:" -ForegroundColor Yellow
    Write-Host "   git push --force-with-lease origin main" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ 설정 완료!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "확인 명령어:" -ForegroundColor Yellow
Write-Host "  git config user.name" -ForegroundColor Gray
Write-Host "  git config user.email" -ForegroundColor Gray
Write-Host "  git log --format='%an <%ae>' -5" -ForegroundColor Gray
Write-Host "  git remote -v" -ForegroundColor Gray
Write-Host ""
