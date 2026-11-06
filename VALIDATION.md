# Refit Canvas 1.1 검증 — 2026-10-31

> 이 기록은 이름을 바꾸기 전(SDStudio Inpaint Desk 1.1) 빌드를 기준으로 작성되었습니다. 이름 변경 후 코드 동작은 같습니다.

## 마스크 회귀 검사

- 사용자가 제공한 실제 실패 씬의 마스크를 읽음: 부분적으로 칠해진 8×8 칸 121개.
- 원본 SDStudio snapMaskToGrid를 적용한 마스크: 부분 칸 0개. 기존 선택 픽셀은 전부 포함.
- 두 번 정렬해도 픽셀 변화 없음. 흑/백 RGB와 alpha 255만 전송.
- 원형/사각형 붓질, 지우개, 전체 채우기, 캔버스 모서리, 예전 입력 씬에 대해 격자 검사.
- 편집기를 우회해 원본 실패 씬으로 SDStudioCore.generate를 직접 호출해도 최종 요청 전에 정렬됨.
- source 이미지의 SHA256은 실패 씬 원본과 동일, mask SHA256만 정렬 결과로 변경됨.
- 새 버전 2 입력 씬 및 .nairef 프로젝트 왕복 확인.
- 순수 계산 단위 검사 3개: 곡선 경계/선택 보존/멱등성, 비움/전체/모서리/극성, 잘린 가장자리 칸.

## 실제 Electron 실행

동일 main.cjs를 Electron 45.2.0 Linux 실행 환경에서 구동했다. Windows 실행 파일은 같은 코드와 공식 win32-x64 런타임으로 빌드했다.

- Windows 배포에 넣는 동일한 app.asar와 backend를 실제 Electron 패키지 구조로 로딩. app.isPackaged=true 확인.
- 실제 BrowserWindow에서 내부 Python 엔진 자동 시작 및 편집기 로딩.
- nodeIntegration false, contextIsolation true, sandbox true와 renderer require 미노출 확인.
- 파일 입력으로 이미지 불러오기. 실제 다운로드 경로로 프로젝트 파일을 저장하고 JSON 확인.
- 종료 확인 취소 시 편집기 유지, 종료 확인 시 앱 종료 및 localhost 엔진 연결 종료.
- Windows PE GUI 실행 파일, resources/app.asar, 내장 Python/편집 파일 포함 확인.

## API 및 편집기

- Python 검사 8개: 본문 UTF8 바이트 그대로 중계, 잘못된 요청/크기 차이 거부, 업스케일 본문 유지, 자동 재시도 없음, 사용량 미제공, vendor 해시, 실제 HTTP 응답 ZIP/요청 해시/인증 헤더 검사.
- 실제 SDStudio generateImage/upscaleImage가 요청을 만들고 모의 ZIP을 읽음.
- 성공 PNG에서 읽은 프롬프트/UC와 프리셋 병합 결과 일치.
- 원본 서버 PNG 바이트 유지. 추가 결과 합성 없음. 메인 569×832 자르기 확인.
- 전체 캔버스 브러시, 참조 이미지 비율 유지, 취소/복원, 프로젝트 왕복.
- 1366×768 가로 넘침 없음, JavaScript 오류 없음.
- 원본 vendor 파일 13개와 고정 커밋의 git show 바이트/해시 비교.

## 한계

NAI 토큰이 없어 로그인/생성/업스케일 네트워크는 모의 응답으로 검증했다. 실제 초록 띠 해소와 의상 반영 품질을 입증한 것은 아니다. Windows EXE 실행 및 DPAPI는 Windows 환경에서 직접 검사하지 못했다. Linux 전용 창 검사는 Windows 동작을 완전히 대신하지 않는다.
