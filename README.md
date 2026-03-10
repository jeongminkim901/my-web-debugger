# web-debugger-pw-runner

Playwright 기반 자동화 러너. Excel(또는 CSV)로 작성한 자연어 테스트 케이스를 실행하고, Chrome에서 `my-web-debugger` 확장을 로드해 함께 동작합니다.

## 빠른 시작

1. (필수) 확장 빌드
   - 기존 repo `my-web-debugger`에서 `npm run build`
2. 의존성 설치
   - `npm install`
3. 크롬 설치(Playwright)
   - `npm run pw:install`
4. 실행
   - `npm run run`

기본 테스트케이스 파일은 `samples/testcases.csv` 입니다.

## 환경 변수

- `CASE_FILE` : 테스트케이스 파일 경로 (`.xlsx` 또는 `.csv`)
  - 기본값: `samples/testcases.csv`
- `EXT_PATH` : 확장 빌드 디렉터리
  - 기본값: `../my-web-debugger/dist`
- `HEADLESS` : 헤드리스 실행 여부 (`true/false`)
  - 기본값: `false` (확장 동작 때문에 headed 권장)
- `OUT_DIR` : 리포트 출력 폴더
  - 기본값: `reports`

예시:
```bash
set CASE_FILE=C:\path\to\cases.xlsx
set EXT_PATH=C:\path\to\my-web-debugger\dist
set HEADLESS=false
set OUT_DIR=reports
npm run run
```

## Excel/CSV 포맷

필수 컬럼:
- `case_id`
- `title`
- `steps`

선택 컬럼:
- `expected`
- `base_url`
- `enabled` (y/n)
- `tags` (comma-separated)

### steps 문법
한 줄에 한 스텝:
- `goto https://example.com`
- `click css=#login`
- `fill css=#email | test@example.com`
- `press css=#email | Enter`
- `wait 1000`
- `assert text=Welcome`
- `assert selector=css=.toast`
- `screenshot`

## 리포트
`reports/report.html`, `reports/report.json` 생성됩니다.

## 실행 방식 추천
- 로컬: **headed** 권장 (확장 로드가 안정적)
- CI: **headed + xvfb** 권장

## 주의
확장 로드는 Chromium channel `chrome` 사용을 기본으로 합니다.
