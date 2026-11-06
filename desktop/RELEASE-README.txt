Refit Canvas (이전 이름: SDStudio Inpaint Desk)
==========================================

실행: 압축을 모두 푼 뒤 Refit-Canvas.exe 를 더블클릭하세요.
- Windows 10/11 64비트용 포터블 앱입니다. Python·Node 설치가 필요 없습니다.
- EXE와 옆의 resources 폴더·DLL 파일들을 같은 폴더에 그대로 두세요.
- 코드 서명이 없어서 처음 실행할 때 Windows SmartScreen 경고가 뜰 수 있습니다.
  "추가 정보" → "실행"을 누르면 됩니다.

사용 순서
1. 토큰 연결에서 NovelAI API 토큰을 입력합니다.
2. 캔버스를 지정합니다 (기본 1216×832, 64픽셀 배수).
   레퍼런스 없이 메인 이미지만 고치려면 "메인 이미지만 수정 (빈 캔버스 없이)"를 켭니다.
3. 메인 이미지를 불러오고, 필요하면 레퍼런스를 여러 장 추가합니다.
   메인 이미지가 NAI 원본 PNG면 프롬프트·네거티브가 자동으로 들어갑니다.
   넣은 이미지는 ✂ 버튼(자르기·지우기)으로 앱 안에서 자르거나 일부를 지울 수 있습니다.
4. 이미지/모서리를 드래그해 배치·크기를 조절합니다.
5. 다시 그릴 부분(의상 등)을 마스크로 칠합니다. 레퍼런스 위에는 칠하지 않습니다.
6. 프롬프트·네거티브와 출력 개수를 정하고 생성합니다.
   여러 장이면 한 장씩 차례로 만들고, 생성 중 버튼을 누르면 그 장까지만 만들고 멈춥니다.
   프리셋·Steps·CFG·샘플러·시드·강도 등은 "세부 설정"에 접혀 있습니다.
7. 결과 창에서 ← → 방향키로 결과를 넘겨보고, "모아보기"에서 한눈에 볼 수 있습니다.
   저장할 때 기본 파일 이름은 메인 이미지 이름을 따릅니다. (예: 내그림-시드.png)
   왼쪽 아래 "저장 위치"에서 폴더를 정하면 저장 창 없이 그 폴더에 바로 저장됩니다.

저장 창은 마지막으로 저장한 폴더에서, 열기 창은 마지막으로 연 폴더에서 열립니다. (따로 기억)
설정은 자동으로 기억됩니다 (%LOCALAPPDATA%\RefitCanvas\settings.json).
새 버전이 나오면 위쪽에 알림 버튼이 뜹니다.

생성/업스케일은 실제 NAI 사용량(할당량 또는 Anlas)을 소모하며 자동 재시도하지 않습니다.

단축키: V 배치, B 마스크, E 지우개, Ctrl+S 프로젝트 저장, [ / ] 브러시 크기,
        Space+드래그 이동, Ctrl+휠 확대/축소, 결과 창 ← →

토큰 저장: '이 PC에 저장'을 켜면 Windows DPAPI로 암호화해
%LOCALAPPDATA%\RefitCanvas\token.bin 에 저장합니다.
예전 SDStudio Inpaint Desk에 저장한 토큰이 있으면 그대로 읽어옵니다.

이전 .nairef 프로젝트와 입력 씬 JSON도 그대로 열 수 있습니다.

소스·문서: https://github.com/gadleChat/refit-canvas
이 프로그램은 SDStudio와 NovelAI의 비공식 독립 도구입니다.
라이선스: LICENSE-REFIT-CANVAS.txt (MIT), LICENSE-SDSTUDIO.txt (MIT), third-party-licenses/ (번들 라이브러리),
          LICENSE (Electron), LICENSES.chromium.html, resources/backend/runtime/LICENSE.txt (Python)
