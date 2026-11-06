# SDStudio 소스 사용 내역

분석·빌드 기준 2026-10-31.

## GitHub 원본

https://github.com/sunho/SDStudio 의 후속 V5 지원 포크 https://github.com/Dd154663/SDStudio 에서 코드를 직접 가져왔다. 기준 커밋은 `45728589b9ffcb50dde5b8491c237afa2aae30fb`다.

`source/vendor/SDStudio`의 13개 파일은 git show의 원본 바이트와 비교하여 일치함을 확인했다. 파일 목록/해시는 source/UPSTREAM.json에 있다. 원본 MIT 라이선스를 함께 배포한다.

## 실행에 쓰는 원본

- `backends/genVendors/nai.ts`의 NovelAiImageGenService.generateImage: 모델 선택, 프롬프트/UC 병합, 전용 인페인트 요청 생성, SDStudio Fetcher 호출, JSZip에서 PNG 추출.
- 같은 클래스의 upscaleImage: 업스케일 파라미터, 가격/해상도 범위 검사, ZIP에서 PNG 선택/추출.
- naiQualityPresets.ts: 품질/UC 태그와 힌트.
- naiModelCapabilities.ts: V5/V4.5 모델별 기능·모델 ID·샘플러 처리.
- naiUpscale.ts: 업스케일 모델 및 해상도/비용 기준.
- imageGen.ts, generationSettings.ts: 원본 열거형과 생성 설정 해석.
- promptWeightSpacing.ts, promptWeightSyntax.ts: 프롬프트 가중치 경계 보정.
- requestTiming.ts: 원본 서비스가 참조하는 시간/캐시 유틸리티. 원본 작업 큐 전체를 가져온 것은 아니며 이 호스트에는 자동 재시도가 없다.
- focusedInpaint.ts의 snapMaskToGrid: 원본 모듈을 수정 없이 포함하고 8픽셀 마스크 정렬에 사용한다.
- BrushTool.tsx의 8픽셀 getChunksInBrush/getChunksBetween과 base64ToDataUri, getImageDimensions, maskToBase64: React 화면 부분을 제외하고 함수 텍스트를 **그대로 추출**해 빌드한다. 원본 전체 파일도 보관한다. 8픽셀 원형 브러시/정렬/PNG 변환은 원본 함수를 사용한다. 사각형 브러시와 입력 ImageData 연결은 호스트 코드다.

## 호스트 어댑터

원본 nai.ts를 수정하지 않고, 빌드 단계에서 세 의존성을 독립형 호스트에 연결한다.

1. `../../models`: 전체 SDStudio 앱 상태 대신 호스트 어댑터. 생성에는 명시적인 generationSettings 스냅샷을 넘기므로 원본의 전체 전역 설정 저장소가 필요 없다.
2. `../../componenets/BrushTool`: 위 원본에서 그대로 추출한 이미지/마스크 함수.
3. `libsodium-wrappers-sumo`: 이 도구에 노출하지 않는 이메일/비밀번호 로그인용 부분만 토큰 전용 어댑터로 대체한다. 이미지 생성/업스케일 암호화나 마스크 처리에는 이 라이브러리가 사용되지 않는다.

생성과 업스케일을 호출할 때는 원본 NovelAiImageGenService 인스턴스를 만든다. 별도의 Python payload builder는 없다.

## 실제 HTTP 경로

편집 화면 → source/sdstudio-host.ts → 원본 SDStudio 서비스 → LocalZipBridge Fetcher → localhost `/api/relay` → NAI 공식 Image API.

원본 서비스가 만든 JSON.stringify 결과를 하나의 문자열로 로컬 서버에 전달한다. 로컬 서버는 작업·모델·해상도·PNG 크기를 검사하고, **같은 UTF-8 바이트를 그대로** NAI에 전송한다. 인증 헤더의 실제 토큰만 서버 메모리에서 붙인다. 이미지·마스크 재인코딩, 필드 추가/삭제, 프롬프트 수정, JSON 재직렬화를 하지 않는다.

서버는 ZIP을 그대로 반환하고 원본 SDStudio 서비스가 읽는다. 요청 문자열의 SHA-256을 응답 헤더로 돌려주며 클라이언트에서도 비교한다. 이후 편집기에서 필요한 메인 crop만 만든다.

## 기존 프로그램과 구분

Electron 전용 창과 내부 서버 수명 관리, 레이어 배치·브러시 입력 UI·프로젝트 저장·crop·PNG 메타데이터 읽기는 이 작업에서 만든 독립형 편집기 코드다. 전체 SDStudio Electron 앱의 화면을 그대로 옮긴 것은 아니다. **요청 생성, 마스크 PNG 변환, 업스케일, 응답 ZIP 읽기는 위에 명시한 실제 SDStudio 코드를 실행한다.**

실제 NAI 호출은 미검증이며 이 코드 사용만으로 출력 품질 일치나 버그 해소를 보장하지 않는다.

## 1.1 마스크 입력 전처리

1.0은 PNG 변환만 가져와 8픽셀 칸 정렬이 누락됐다. 1.1은 SDStudio의 원본 snapMaskToGrid와 원형 브러시 칸 계산을 사용한다. 예전 씬/프로젝트도 새 마스크로 정렬한다. 이는 원본 이미지가 아니라 mask PNG를 바꾸는 처리다. 원본 서비스 호출 이후의 Python 중계는 여전히 받은 본문 바이트를 수정하지 않는다.
