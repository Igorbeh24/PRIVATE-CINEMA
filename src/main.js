import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { supabase } from './lib/supabase.js';
import './style.css';

// ======================================================
// CONFIGURAÇÕES GERAIS
// ======================================================

const MODEL_PATH = '/models/Cine.glb';

const CAMERA_START = new THREE.Vector3(6.55, 2.65, 0);
const LOOK_AT_START = new THREE.Vector3(-4.42, 3.88, 0);

const SCREEN_NAME = 'Screen';
const SCREEN_CENTER = new THREE.Vector3(-4.415, 3.8777, 0);
const SCREEN_WIDTH = 12.65;
const SCREEN_HEIGHT = 7.0;

// ======================================================
// CONFIGURAÇÃO DAS CADEIRAS
// ======================================================

const SEAT_CONFIG = {
  total: 13,
  columns: 13,
  startX: 6.6,
  startY: 2.65,
  startZ: -3.15,
  columnSpacing: 0.525,
  showNumbers: true,
  markerHeight: 0.8,
  markerSize: 0.38
};

const MAX_SEATS = SEAT_CONFIG.total;

const SEAT_POSITIONS = Array.from({ length: MAX_SEATS }, (_, i) => {
  return new THREE.Vector3(
    SEAT_CONFIG.startX,
    SEAT_CONFIG.startY,
    SEAT_CONFIG.startZ + i * SEAT_CONFIG.columnSpacing
  );
});

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' }
];

const $ = (s) => document.querySelector(s);

const app = $('#app');
const sceneHost = $('#scene');
const cssHost = $('#css3d');

const loading = $('#loading');
const welcome = $('#welcome');
const hint = $('#hint');

const panel = $('#playerPanel');
const message = $('#formMessage');
const nowPlaying = $('#nowPlaying');

const toast = $('#toast');

// ======================================================
// CENA THREE.JS
// ======================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08090b);

const camera = new THREE.PerspectiveCamera(
  62,
  innerWidth / innerHeight,
  0.05,
  300
);

camera.position.copy(CAMERA_START);
camera.rotation.order = 'YXZ';
camera.lookAt(LOOK_AT_START);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false
});

renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.id = 'cinemaCanvas';
renderer.domElement.setAttribute('aria-label', 'Sala de cinema 3D');

sceneHost.appendChild(renderer.domElement);

const cssRenderer = new CSS3DRenderer();

cssRenderer.setSize(innerWidth, innerHeight);
cssRenderer.domElement.style.position = 'absolute';
cssRenderer.domElement.style.inset = '0';
cssRenderer.domElement.style.pointerEvents = 'none';

cssHost.appendChild(cssRenderer.domElement);

scene.add(new THREE.HemisphereLight(0xb9c8df, 0x171014, 1.05));

const softLight = new THREE.DirectionalLight(0xffe3c2, 1.05);
softLight.position.set(1, 8, 4);
scene.add(softLight);

// ======================================================
// MARCAÇÕES VISUAIS DAS CADEIRAS
// ======================================================

const seatMarkers = new THREE.Group();
seatMarkers.name = 'SeatMarkers';
scene.add(seatMarkers);

function createSeatLabel(number, position) {
  const canvas = document.createElement('canvas');

  canvas.width = 512;
  canvas.height = 160;

  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(8, 9, 11, 0.92)';

  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 144, 24);
  ctx.fill();

  ctx.strokeStyle = '#b8d8d8';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 75px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillText(String(number).padStart(2, '0'), 256, 80);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });

  const sprite = new THREE.Sprite(material);

  sprite.position.copy(position);
  sprite.position.y += SEAT_CONFIG.markerHeight;

  sprite.scale.set(
    SEAT_CONFIG.markerSize * 2.5,
    SEAT_CONFIG.markerSize * 0.8,
    1
  );

  sprite.renderOrder = 999;
  seatMarkers.add(sprite);

  console.log(
    `CADEIRA ${String(number).padStart(2, '0')}`,
    `X: ${position.x.toFixed(3)}`,
    `Y: ${position.y.toFixed(3)}`,
    `Z: ${position.z.toFixed(3)}`
  );
}

function updateSeatMarkers() {
  seatMarkers.clear();

  if (!SEAT_CONFIG.showNumbers) return;

  SEAT_POSITIONS.forEach((position, index) => {
    createSeatLabel(index + 1, position);
  });

  console.log('================================');
  console.log('POSIÇÕES DE TODAS AS CADEIRAS');
  console.log('================================');
}

// ======================================================
// ESTADO DO SISTEMA
// ======================================================

let screenMesh = null;
let originalScreenMaterial = null;

let videoElement = null;
let videoTexture = null;
let embeddedObject = null;
let localObjectUrl = null;

// YouTube IFrame Player API
let youtubePlayer = null;
let youtubeReady = false;
let youtubeVideoId = null;
let youtubeApiPromise = null;

let yaw = Math.PI / 2;

let pitch = Math.atan2(
  LOOK_AT_START.y - CAMERA_START.y,
  Math.hypot(
    LOOK_AT_START.x - CAMERA_START.x,
    LOOK_AT_START.z - CAMERA_START.z
  )
);

let entered = false;

let currentRoom = null;
let currentMember = null;
let roomChannel = null;

let roomMembers = [];
let isApplyingRemotePlayback = false;
let lastPlaybackWrite = 0;
let lastLoadedRemoteMedia = null;
let pendingSharedMediaUrl = null;
let isSeeking = false;
let playbackSyncTimer = null;
let lastRemotePlaybackSyncAt = 0;

let localStream = null;

const peers = new Map();
const remoteAudio = new Map();

let heartbeatTimer = null;

// ======================================================
// NOTIFICAÇÕES
// ======================================================

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

// ======================================================
// CÂMERA
// ======================================================

function updateCamera() {
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

function setCameraToSeat(seatNumber) {
  const pos = SEAT_POSITIONS[seatNumber - 1] || CAMERA_START;

  camera.position.copy(pos);

  const dir = SCREEN_CENTER.clone().sub(pos).normalize();

  yaw = Math.atan2(-dir.x, -dir.z);

  pitch = Math.atan2(
    dir.y,
    Math.hypot(dir.x, dir.z)
  );

  updateCamera();
}

// ======================================================
// VÍDEO
// ======================================================

function disposeCurrentVideo() {
  if (youtubePlayer) {
    try {
      youtubePlayer.destroy();
    } catch (error) {
      console.warn('Erro ao fechar player do YouTube:', error);
    }
  }

  youtubePlayer = null;
  youtubeReady = false;
  youtubeVideoId = null;

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

  if (embeddedObject) {
    scene.remove(embeddedObject);
    embeddedObject.element.remove();
    embeddedObject = null;
  }

  if (screenMesh && originalScreenMaterial) {
    screenMesh.material = originalScreenMaterial;
  }
}

function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousCallback === 'function') {
        previousCallback();
      }

      resolve();
    };

    let script = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]'
    );

    if (!script) {
      script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';

      script.onerror = () => {
        reject(new Error('Não foi possível carregar a API do YouTube.'));
      };

      document.head.appendChild(script);
    }
  });

  return youtubeApiPromise;
}

async function loadYouTubeVideo(videoId, remote = false) {
  await loadYouTubeAPI();

  if (youtubePlayer && youtubeVideoId === videoId && youtubeReady) {
    return;
  }

  disposeCurrentVideo();
  youtubeVideoId = videoId;

  const container = document.createElement('div');
  container.style.cssText = 'width:1920px;height:1080px;background:#000';

  embeddedObject = new CSS3DObject(container);
  embeddedObject.position.copy(SCREEN_CENTER);
  embeddedObject.position.x += 0.012;
  embeddedObject.rotation.y = Math.PI / 2;

  embeddedObject.scale.set(
    SCREEN_WIDTH / 1920,
    SCREEN_HEIGHT / 1080,
    1
  );

  scene.add(embeddedObject);

  if (screenMesh) {
    screenMesh.material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide
    });
  }

  await new Promise((resolve, reject) => {
    try {
      youtubePlayer = new YT.Player(container, {
        width: '1920',
        height: '1080',
        videoId,

        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          rel: 0,
          enablejsapi: 1,
          origin: window.location.origin
        },

        events: {
          onReady: () => {
            youtubeReady = true;
            nowPlaying.textContent = 'YOUTUBE NO TELÃO';
            updatePlaybackUI();

            if (!remote) {
              showToast('YouTube carregado no telão.');
            }

            resolve();
          },

          onStateChange: event => {
            updatePlaybackUI();

            if (!currentRoom || !isHost() || isApplyingRemotePlayback) {
              return;
            }

            if (event.data === YT.PlayerState.PLAYING) {
              publishPlayback('playing', undefined, true);
            } else if (
              event.data === YT.PlayerState.PAUSED ||
              event.data === YT.PlayerState.ENDED
            ) {
              publishPlayback('paused', undefined, true);
            }
          },

          onError: event => {
            console.error('Erro do YouTube:', event.data);

            showToast(
              'Este vídeo não permite reprodução incorporada ou está indisponível.'
            );
          }
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

function makeEmbeddedScreen(url) {
  const frame = document.createElement('iframe');

  frame.width = '1920';
  frame.height = '1080';

  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';

  frame.title = 'Vídeo no telão do cinema';
  frame.src = url;

  frame.style.cssText =
    'width:1920px;height:1080px;border:0;background:#000';

  embeddedObject = new CSS3DObject(frame);

  embeddedObject.position.copy(SCREEN_CENTER);
  embeddedObject.position.x += 0.012;
  embeddedObject.rotation.y = Math.PI / 2;

  embeddedObject.scale.set(
    SCREEN_WIDTH / 1920,
    SCREEN_HEIGHT / 1080,
    1
  );

  scene.add(embeddedObject);

  if (screenMesh) {
    screenMesh.material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide
    });
  }
}

function parseVideoLink(raw) {
  let url;

  try {
    url = new URL(raw);
  } catch {
    throw new Error('Cole um endereço válido.');
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (
    host === 'youtu.be' ||
    host.endsWith('youtube.com') ||
    host.endsWith('youtube-nocookie.com')
  ) {
    let id = '';

    if (host === 'youtu.be') {
      id = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (url.pathname === '/watch') {
      id = url.searchParams.get('v') || '';
    } else if (url.pathname.startsWith('/embed/')) {
      id = url.pathname.split('/')[2] || '';
    } else if (url.pathname.startsWith('/shorts/')) {
      id = url.pathname.split('/')[2] || '';
    }

    if (!/^[\w-]{6,}$/.test(id)) {
      throw new Error('Não consegui identificar esse vídeo do YouTube.');
    }

    return {
      provider: 'youtube',
      id,
      src: `https://www.youtube-nocookie.com/embed/${id}`
    };
  }

  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
    const match = url.pathname.match(/(\d+)/);

    if (!match) {
      throw new Error('Não consegui identificar esse vídeo do Vimeo.');
    }

    return {
      provider: 'vimeo',
      src: `https://player.vimeo.com/video/${match[1]}?autoplay=1&title=0&byline=0&portrait=0`
    };
  }

  if (/\.(mp4|webm|ogg)(?:$|[?#])/i.test(url.href)) {
    return {
      provider: 'file',
      src: url.href
    };
  }

  throw new Error(
    'Use YouTube, Vimeo ou um link direto .mp4, .webm ou .ogg.'
  );
}

function playDirectVideo(src, title = 'VÍDEO EXTERNO', remote = false) {
  disposeCurrentVideo();

  const video = document.createElement('video');

  video.src = src;
  video.crossOrigin = 'anonymous';
  video.loop = false;
  video.muted = false;
  video.playsInline = true;
  video.preload = 'auto';

  video.addEventListener('error', () => {
    showToast(
      'Não foi possível carregar o vídeo. Verifique se o link é público e permite reprodução externa.'
    );
  }, { once: true });

  videoElement = video;

  videoTexture = new THREE.VideoTexture(videoTextureSource(video));
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

  video.addEventListener('play', updatePlaybackUI);
  video.addEventListener('pause', updatePlaybackUI);
  video.addEventListener('seeked', updatePlaybackUI);
  video.addEventListener('loadedmetadata', updatePlaybackUI);
  video.addEventListener('timeupdate', updatePlaybackUI);

  video.play()
    .then(() => {
      if (!remote) showToast('Vídeo carregado no telão.');
    })
    .catch(() => {
      if (remote) {
        showToast('Clique em reproduzir para liberar o áudio neste navegador.');
      } else {
        showToast('Clique em reproduzir para iniciar o vídeo.');
      }
    });

  nowPlaying.textContent = title.toUpperCase();
}

function videoTextureSource(video) {
  return video;
}

async function loadVideoLink(raw, fromRemote = false) {
  try {
    const parsed = parseVideoLink(raw.trim());

    if (currentRoom && !isHost() && !fromRemote) {
      throw new Error('Somente o anfitrião pode escolher o vídeo.');
    }

    if (parsed.provider === 'file') {
      pendingSharedMediaUrl =
        currentRoom && !fromRemote ? parsed.src : null;

      playDirectVideo(parsed.src, raw, fromRemote);

      if (currentRoom && !fromRemote) {
        await publishPlayback('playing', parsed.src, true);
      }

      pendingSharedMediaUrl = null;

    } else if (parsed.provider === 'youtube') {
      await loadYouTubeVideo(parsed.id, fromRemote);

      if (currentRoom && !fromRemote) {
        await publishPlayback('paused', raw, true);
        showToast('YouTube compartilhado com a sala.');
      }

    } else {
      disposeCurrentVideo();
      makeEmbeddedScreen(parsed.src);

      nowPlaying.textContent = 'VIMEO NO TELÃO';

      if (currentRoom && !fromRemote) {
        await publishPlayback('paused', raw, true);
        showToast('Link do Vimeo enviado para a sala.');
      } else {
        showToast('Player carregado no telão.');
      }
    }

    panel.classList.remove('open');
    message.textContent = 'Vídeo carregado.';

  } catch (error) {
    pendingSharedMediaUrl = null;
    message.textContent = error.message;
    showToast(error.message);
  }
}

function loadLocalFile(file) {
  if (!file) return;

  if (currentRoom) {
    showToast(
      'Arquivos locais não podem ser compartilhados. Use um link público MP4/WebM.'
    );
    return;
  }

  if (!file.type.startsWith('video/')) {
    showToast('Escolha um arquivo de vídeo.');
    return;
  }

  if (localObjectUrl) {
    URL.revokeObjectURL(localObjectUrl);
  }

  localObjectUrl = URL.createObjectURL(file);

  playDirectVideo(localObjectUrl, file.name);

  panel.classList.remove('open');
  message.textContent = 'Arquivo local carregado nesta sessão.';
}

// ======================================================
// MULTIPLAYER / SUPABASE
// ======================================================
