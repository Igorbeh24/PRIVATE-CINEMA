import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import './style.css';

// AJUSTES DA SALA: se quiser mudar a poltrona depois, altere estes valores.
const MODEL_PATH = '/models/Cine.glb';
const CAMERA_START = new THREE.Vector3(6.55, 2.65, 0);
const LOOK_AT_START = new THREE.Vector3(-4.42, 3.88, 0);
const SCREEN_NAME = 'Screen';
const SCREEN_CENTER = new THREE.Vector3(-4.415, 3.8777, 0);
const SCREEN_WIDTH = 12.65;
const SCREEN_HEIGHT = 7.0;

const app = document.querySelector('#app');
const sceneHost = document.querySelector('#scene');
const cssHost = document.querySelector('#css3d');
const loading = document.querySelector('#loading');
const welcome = document.querySelector('#welcome');
const hint = document.querySelector('#hint');
const panel = document.querySelector('#playerPanel');
const message = document.querySelector('#formMessage');
const nowPlaying = document.querySelector('#nowPlaying');
const toast = document.querySelector('#toast');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08090b);

const camera = new THREE.PerspectiveCamera( sixty(), window.innerWidth / window.innerHeight, 0.05, 300);
camera.position.copy(CAMERA_START);
camera.rotation.order = 'YXZ';
camera.lookAt(LOOK_AT_START);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.id = 'cinemaCanvas';
renderer.domElement.setAttribute('aria-label', 'Sala de cinema 3D');
sceneHost.appendChild(renderer.domElement);

const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(window.innerWidth, window.innerHeight);
cssRenderer.domElement.style.position = 'absolute';
cssRenderer.domElement.style.inset = '0';
cssRenderer.domElement.style.pointerEvents = 'none';
cssHost.appendChild(cssRenderer.domElement);

scene.add(new THREE.HemisphereLight(0xb9c8df, 0x171014, 1.05));
const softLight = new THREE.DirectionalLight(0xffe3c2, 1.05);
softLight.position.set(1, 8, 4);
scene.add(softLight);

let screenMesh = null;
let originalScreenMaterial = null;
let videoElement = null;
let videoTexture = null;
let youtubeObject = null;
let vimeoObject = null;
let localObjectUrl = null;
let yaw = Math.PI / 2;
let pitch = Math.atan2(LOOK_AT_START.y - CAMERA_START.y, Math.hypot(LOOK_AT_START.x - CAMERA_START.x, LOOK_AT_START.z - CAMERA_START.z));
const initialYaw = yaw;
const yawLimit = 1.12;
const pitchLimit = 1;
const sensitivity = 0.0022;
let entered = false;

function sixty() { return 62; }

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3000);
}

function updateCamera() {
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

function disposeCurrentVideo() {
  if (videoElement) {
    videoElement.pause();
    videoElement.removeAttribute('src');
    videoElement.load();
    videoElement = null;
  }
  if (videoTexture) {
    videoTexture.dispose();
    videoTexture = null;
  }
  if (youtubeObject) {
    scene.remove(youtubeObject);
    youtubeObject.element.remove();
    youtubeObject = null;
  }
  if (vimeoObject) {
    scene.remove(vimeoObject);
    vimeoObject.element.remove();
    vimeoObject = null;
  }
  if (screenMesh && originalScreenMaterial) screenMesh.material = originalScreenMaterial;
}

function makeEmbeddedScreen(url, provider) {
  const frame = document.createElement('iframe');
  frame.width = '1920';
  frame.height = '1080';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.title = 'Vídeo no telão do cinema';
  frame.src = url;
  frame.style.width = '1920px';
  frame.style.height = '1080px';
  frame.style.border = '0';
  frame.style.background = '#000';

  const object = new CSS3DObject(frame);
  object.position.copy(SCREEN_CENTER);
  object.position.x += 0.012;
  object.rotation.y = Math.PI / 2;
  object.scale.set(SCREEN_WIDTH / 1920, SCREEN_HEIGHT / 1080, 1);
  scene.add(object);

  if (provider === 'youtube') youtubeObject = object;
  else vimeoObject = object;

  if (screenMesh) screenMesh.material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
}

function parseVideoLink(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Cole um endereço válido.'); }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    let id = '';
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
    else if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
    else if (url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2] || '';
    else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2] || '';
    if (!/^[\w-]{6,}$/.test(id)) throw new Error('Não consegui identificar esse vídeo do YouTube.');
    return { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&controls=1&rel=0&modestbranding=1` };
  }

  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
    const match = url.pathname.match(/(\d+)/);
    if (!match) throw new Error('Não consegui identificar esse vídeo do Vimeo.');
    return { provider: 'vimeo', src: `https://player.vimeo.com/video/${match[1]}?autoplay=1&title=0&byline=0&portrait=0` };
  }

  if (/\.(mp4|webm|ogg)(?:$|[?#])/i.test(url.href)) return { provider: 'file', src: url.href };
  throw new Error('Use um link do YouTube, Vimeo ou um link direto .mp4, .webm ou .ogg.');
}

function playDirectVideo(src, title = 'VÍDEO EXTERNO') {
  disposeCurrentVideo();
  const video = document.createElement('video');
  video.src = src;
  video.crossOrigin = 'anonymous';
  video.loop = false;
  video.muted = false;
  video.playsInline = true;
  video.preload = 'auto';
  video.addEventListener('error', () => showToast('Não foi possível carregar o vídeo. Verifique o link ou o formato.'), { once: true });
  videoElement = video;

  videoTexture = new THREE.VideoTexture(video);
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.generateMipmaps = false;

  if (screenMesh) {
    screenMesh.material = new THREE.MeshBasicMaterial({
      map: videoTexture,
      side: THREE.DoubleSide,
      toneMapped: false
    });
  }

  video.play().then(() => showToast('Vídeo reproduzindo no telão.')).catch(() => {
    showToast('Clique em reproduzir no navegador para iniciar o vídeo.');
  });
  nowPlaying.textContent = title.toUpperCase();
}

async function loadVideoLink(raw) {
  try {
    const parsed = parseVideoLink(raw.trim());
    disposeCurrentVideo();
    if (parsed.provider === 'file') {
      playDirectVideo(parsed.src, raw);
    } else {
      makeEmbeddedScreen(parsed.src, parsed.provider);
      nowPlaying.textContent = parsed.provider === 'youtube' ? 'YOUTUBE NO TELÃO' : 'VIMEO NO TELÃO';
      showToast('Player carregado no telão.');
    }
    panel.classList.remove('open');
    message.textContent = 'Vídeo carregado. Você pode escolher outro a qualquer momento.';
  } catch (error) {
    message.textContent = error.message;
    showToast(error.message);
  }
}

function loadLocalFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) {
    showToast('Escolha um arquivo de vídeo.');
    return;
  }
  if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
  localObjectUrl = URL.createObjectURL(file);
  playDirectVideo(localObjectUrl, file.name);
  panel.classList.remove('open');
  message.textContent = 'Arquivo local carregado. Ele fica disponível enquanto esta página estiver aberta.';
}

const loader = new GLTFLoader();
loader.load(MODEL_PATH, (gltf) => {
  const model = gltf.scene;
  model.traverse((obj) => {
    if (obj.isMesh) {
      obj.frustumCulled = true;
      if (obj.name === SCREEN_NAME) {
        screenMesh = obj;
        originalScreenMaterial = Array.isArray(obj.material)
          ? obj.material.map(m => m.clone())
          : obj.material.clone();
      }
    }
  });

  model.traverse((obj) => {
  if (obj.isMesh) {
    console.log(
      'OBJETO:',
      obj.name,
      'POSIÇÃO:',
      obj.getWorldPosition(new THREE.Vector3()),
      'TAMANHO:',
      obj.geometry.boundingBox
    );
  }
});

  scene.add(model);

  if (!screenMesh) {
    console.warn(`Objeto "${SCREEN_NAME}" não encontrado. Confira o nome do telão no GLB.`);
    showToast('Modelo carregado; objeto Screen não encontrado.');
  }

  loading.classList.add('done');
  setTimeout(() => loading.remove(), 600);
  renderer.domElement.style.cursor = 'grab';
}, undefined, (error) => {
  console.error(error);
  loading.innerHTML = '<span>Não foi possível carregar Cine.glb.</span><span>Confira se o arquivo está em public/models/Cine.glb.</span>';
});

function enterCinema() {
  entered = true;
  welcome.classList.add('hidden');
  hint.classList.add('visible');
  renderer.domElement.requestPointerLock?.();
  setTimeout(() => hint.classList.remove('visible'), 5500);
}

renderer.domElement.addEventListener('click', () => {
  if (entered && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock?.();
  }
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  renderer.domElement.style.cursor = locked ? 'none' : 'grab';
  if (entered && !locked) {
    hint.classList.add('visible');
    setTimeout(() => hint.classList.remove('visible'), 3500);
  }
});
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= event.movementX * sensitivity;
  pitch -= event.movementY * sensitivity;
  yaw = THREE.MathUtils.clamp(yaw, initialYaw - yawLimit, initialYaw + yawLimit);
  pitch = THREE.MathUtils.clamp(pitch, -pitchLimit, pitchLimit);
  updateCamera();
});

document.querySelector('#enterBtn').addEventListener('click', enterCinema);
document.querySelector('#movieBtn').addEventListener('click', () => panel.classList.toggle('open'));
document.querySelector('#closePanel').addEventListener('click', () => panel.classList.remove('open'));
document.querySelector('#videoForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = document.querySelector('#videoUrl').value;
  if (value) loadVideoLink(value);
  else message.textContent = 'Cole primeiro o link do vídeo.';
});
document.querySelector('#videoFile').addEventListener('change', (event) => loadLocalFile(event.target.files?.[0]));
document.querySelector('#fullscreenBtn').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await app.requestFullscreen();
    else await document.exitFullscreen();
  } catch { showToast('O navegador não permitiu abrir a tela cheia.'); }
});

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
  cssRenderer.render(scene, camera);
}
animate();

// A posição da câmera e a direção inicial ficam fixas: só o mouse altera o olhar.
// O vídeo selecionado é temporário e não é enviado para nenhum servidor.
