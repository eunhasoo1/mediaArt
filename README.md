# Media Art Collection

이 프로젝트는 Three.js를 활용한 웹 기반 미디어 아트 컬렉션입니다.

## 프로젝트 소개

### Dimension Prism (Mystic Diamond 3D Art)
'Dimension Prism'은 Three.js를 사용하여 구현된 인터랙티브 3D 시각화 작품입니다. 
- **시각 효과**: 회전하는 다이아몬드 형태의 구조체와 주변을 부유하는 파티클 시스템, 그리고 몽환적인 Bloom(빛 번짐) 효과가 특징입니다.
- **오디오 인터랙션**: 클릭 시 피아노 음색의 코드가 연주되며, 시각적 펄스 효과와 함께 공감각적인 경험을 제공합니다.
- **기술 스택**: HTML5, Three.js (WebGL), Shader (GLSL) 커스터마이징

## 실행 방법 (Localhost)

이 프로젝트는 정적 웹사이트이므로, 로컬 서버를 통해 실행해야 Three.js 모듈 및 텍스처 로딩 등이 정상적으로 작동합니다. 다음 중 편한 방법을 선택하세요.

### 방법 1: Python 사용 (추천)
대부분의 macOS 및 Linux 환경에는 Python이 기본 설치되어 있습니다.

1. 터미널을 열고 프로젝트 루트 디렉토리로 이동합니다.
2. 다음 명령어를 실행합니다:
   ```bash
   python3 -m http.server
   ```
3. 브라우저에서 `http://localhost:8000`으로 접속합니다.

### 방법 2: Node.js (npx) 사용
Node.js가 설치되어 있다면 간편하게 실행할 수 있습니다.

1. 터미널을 열고 프로젝트 루트 디렉토리로 이동합니다.
2. 다음 명령어를 실행합니다:
   ```bash
   npx serve
   ```
3. 터미널에 표시된 주소(예: `http://localhost:3000`)로 접속합니다.

### 방법 3: VS Code Live Server
VS Code를 사용 중이라면 'Live Server' 확장 프로그램을 설치하여 우측 하단의 'Go Live' 버튼을 클릭하면 됩니다.
