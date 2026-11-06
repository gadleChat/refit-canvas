# Refit Canvas

메인 이미지와 레퍼런스 이미지를 한 캔버스에 배치하고, 바꾸고 싶은 부분(의상 등)만 마스크로 칠해서 **NovelAI 인페인트**로 다시 그리는 Windows 데스크톱 편집기입니다.

요청 생성·마스크 변환·업스케일·응답 처리는 [SDStudio](https://github.com/sunho/SDStudio)의 실제 TypeScript 코드를 그대로 실행합니다. 이 프로젝트는 SDStudio 및 NovelAI와 관계없는 비공식 독립 도구입니다.

> 이전 이름: **SDStudio Inpaint Desk** (1.0 ~ 1.1)

## 기능

- 캔버스 지정(기본 1216×832, 64픽셀 배수), 메인 1장 + 레퍼런스 여러 장 배치·크기 조절
- SDStudio와 같은 **8×8 픽셀 칸 단위 마스크** — 원형/사각형 브러시, 지우개, 취소/복원
- 예전 프로젝트·씬의 마스크도 전송 전에 8픽셀 격자로 자동 정렬 (SDStudio 원본 `snapMaskToGrid` 사용)
- NAI V5 Full / V4.5 Full / V4.5 Curated 인페인트 모델, 품질·네거티브 프리셋, PNG에서 생성 설정 불러오기
- 메인 이미지를 넣으면 그 PNG에 저장된 **프롬프트·네거티브를 자동으로 입력** (기본 켜짐, 프롬프트 아래 체크로 끄기). 선택한 품질·네거티브 프리셋 태그는 중복되지 않게 뺍니다.
- **메인 이미지만 수정** 모드: 레퍼런스용 빈 캔버스 없이 메인 이미지만 인페인트합니다. 캔버스를 메인 비율에 맞춰 약 1MP·64px 단위로 자동 지정하고, 메인을 꽉 채웁니다(비율이 64px 단위와 딱 안 맞으면 가장자리가 최대 2% 정도 잘림).
- **출력 개수** 지정 — 여러 장이면 한 장씩 차례로 생성, 생성 중 버튼으로 중지 (고정 시드면 1씩 올려가며 생성)
- 수정된 메인 영역만 잘라 저장, 선택적 AI 업스케일
- 결과 창에서 **← → 방향키**로 이전·다음 결과 넘기기, **결과 모아보기** 창에서 크기 슬라이더(또는 Ctrl+휠)로 썸네일 크기 조절
- 넣은 이미지(메인·레퍼런스)를 앱 안에서 **자르기·지우기** — 레이어의 ✂ 버튼 또는 '자르기·지우기'. 잘라도 캔버스 위 위치는 그대로 유지
- **설정 기억**: 프롬프트·세부 설정·출력 개수·캔버스 크기·브러시 등을 `%LOCALAPPDATA%\RefitCanvas\settings.json`에 저장해 다음 실행 때 복원
- **저장 폴더 지정**(데스크톱 앱): 폴더를 정하면 저장 창 없이 바로 저장, 같은 이름이면 `(1)`을 붙임
- **마지막 위치 기억**(데스크톱 앱): 저장 창은 마지막으로 저장한 폴더에서, 열기 창은 마지막으로 연 폴더에서 열림 (둘은 따로 기억)
- **새 버전 알림**(데스크톱 앱): GitHub 최신 릴리스가 더 새로우면 상단에 알림 버튼 표시
- 메인 PNG / 전체 PNG / 서버 원본 PNG / 생성 설정 / 입력 씬 / `.nairef` 프로젝트 저장
- 저장할 때 기본 파일 이름은 메인 이미지 이름을 따릅니다 (예: `내그림.png` → `내그림-시드.png`, `내그림.nairef`, `내그림-mask.png`)
- V5 할당량·Anlas 표시, 토큰은 기본적으로 메모리에만 보관 (선택 시 Windows DPAPI로 암호화 저장)

단축키: `V` 배치, `B` 마스크, `E` 지우개, `Ctrl+S` 프로젝트 저장, `[` / `]` 브러시 크기, `Space`+드래그 이동, `Ctrl`+휠 확대/축소

## 사용 순서

1. **토큰 연결**에서 NovelAI API 토큰을 입력합니다.
2. 캔버스 크기를 정합니다. 레퍼런스 없이 메인만 고칠 거면 **메인 이미지만 수정**을 켭니다.
3. 메인 이미지를 불러오면 비율을 유지해 왼쪽에 맞춥니다. 레퍼런스는 여러 장 추가할 수 있습니다.
4. 이미지나 모서리를 드래그해 배치/크기를 조절합니다(숫자 입력도 가능).
5. 다시 그릴 부분을 마스크로 칠합니다. 레퍼런스 위에는 칠하지 않습니다.
6. 프롬프트·네거티브와 출력 개수를 정하고 생성합니다. 프리셋·Steps·CFG·샘플러·시드·강도 등은 **세부 설정**에 접혀 있습니다.
7. 수정된 메인 영역을 저장하거나 업스케일합니다.

생성/업스케일은 실제 NAI 사용량(할당량 또는 Anlas)을 소모하며, 자동 재시도는 하지 않습니다.

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `server.py`, `api.py` | 로컬(127.0.0.1) 엔진. 요청 검사 후 SDStudio가 만든 본문을 바이트 그대로 NAI에 중계 |
| `static/` | 편집기 화면 (`sdstudio-core.js`는 `source/`에서 빌드된 결과물) |
| `source/` | SDStudio 원본 코드(`vendor/SDStudio`)와 독립 실행용 어댑터, 빌드 스크립트 |
| `desktop/` | Electron 데스크톱 셸과 Windows 패키징 스크립트 |
| `tests/` | 중계·마스크 정렬 검사 |
| `third-party/` | 번들 라이브러리 라이선스 |

## 소스에서 실행

브라우저 모드 (Python 3.10+ 필요):

```sh
python server.py
```

데스크톱 창 (Node 22.12+ 필요):

```sh
cd desktop
npm ci --ignore-scripts
npm start
```

## 빌드

```sh
# 1) SDStudio 코어 번들 다시 만들기
cd source
npm ci --ignore-scripts
npm run build
npm run test:mask

# 2) Windows 실행 파일 패키징
cd ../desktop
npm ci --ignore-scripts
npm run package:win
```

Windows 패키징에는 Python embeddable 런타임이 저장소 최상위 `runtime/` 폴더에 있어야 합니다(git에는 포함하지 않음). 자세한 내용은 [`desktop/BUILDING.md`](desktop/BUILDING.md), [`source/BUILDING.md`](source/BUILDING.md)를 보세요.

## 검사

```sh
python -m unittest discover -s tests -v
```

검증 범위와 한계는 [`VALIDATION.md`](VALIDATION.md)에 있습니다. 실제 NAI 생성 품질과 Windows에서의 DPAPI 동작은 개발 환경에서 직접 검증하지 못했습니다.

## 토큰 저장 위치

`이 PC에 저장`을 켜면 `%LOCALAPPDATA%\RefitCanvas\token.bin`에 저장합니다. 예전 이름(SDStudio Inpaint Desk)으로 저장한 `%LOCALAPPDATA%\SDStudioInpaintDesk\token.bin`이 있으면 그대로 읽어옵니다. 인증 토큰은 프로젝트/씬 파일에 포함되지 않습니다.

## 출처와 라이선스

- 이 프로젝트의 코드: [MIT](LICENSE)
- SDStudio 원본 코드 (`source/vendor/SDStudio`): MIT — Copyright (c) 2024 sunho, (c) 2026 Dd154663 · [`LICENSE-SDSTUDIO.txt`](LICENSE-SDSTUDIO.txt)
  - 기준: [Dd154663/SDStudio](https://github.com/Dd154663/SDStudio) 커밋 `45728589b9ffcb50dde5b8491c237afa2aae30fb` — 파일별 해시는 [`source/UPSTREAM.json`](source/UPSTREAM.json), 사용 내역은 [`SOURCE_PROVENANCE.md`](SOURCE_PROVENANCE.md)
- 글꼴: [`static/FONT-LICENSE.txt`](static/FONT-LICENSE.txt)
- 번들 라이브러리: [`third-party/`](third-party)
